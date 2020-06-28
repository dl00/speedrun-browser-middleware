import * as _ from 'lodash';

import { load_config } from '../../lib/config';
import * as dao from '../../lib/dao';
import { RedisMapIndex } from '../../lib/dao/backing/redis';
import { close_db, DB, load_db } from '../../lib/db';

import { expect } from 'chai';

import 'mocha';

describe('Dao', () => {

    let db: DB;

    before(async () => {
        db = await load_db(load_config().db);
        await db.mongo.dropDatabase();
        await db.mongo.setProfilingLevel('all');
        await db.redis.flushall();
    });

    after(async () => {
        await close_db(db);
    });

    function saveLoad(backing_db: 'redis'|'mongo') {
        return async function() {
            const ao = new dao.Dao(db, 'tests');
            ao.backing = backing_db;
            ao.id_key = _.property('name');

            const objs = [
                {
                    test: '1',
                    name: 'something',
                },
                {
                    test: '2',
                    name: 'else',
                },
            ];

            await ao.save(objs);

            // test that returned documents are both there and preserve order
            let returned: any = await ao.load(['something', 'else']);
            expect(returned).to.eql(objs);
            returned = await ao.load(['else', 'something']);
            expect(returned).to.eql(objs.reverse());

            // update an object
            await ao.save({
                name: 'something',
                test: 'changed',
            });

            returned = await ao.load('something');
            expect(returned[0].test).to.eql('changed');

            await ao.remove('something');

            returned = await ao.load('something');
            expect(returned[0]).to.eql(null);
        };
    }

    it('should be able to save and load documents from redis', saveLoad('redis'));

    it('should be able to save and load documents from mongo', saveLoad('mongo'));

    it('should be able to set indexes', async () => {
        const ao = new dao.Dao(db, 'indexTests');
        ao.backing = 'mongo';
        ao.id_key = _.property('name');
        ao.indexes = [
            new RedisMapIndex('test-shorts', 'short'),
        ];

        const objs = [
            {
                test: '1',
                name: 'something',
                short: 'one',
                group: 'fiesta',
            },
            {
                test: '2',
                name: 'else',
                short: 'two',
                group: 'waffle',
            },
            {
                test: '2',
                name: 'another',
                short: 'three',
                group: 'fiesta',
            },
        ];

        await ao.save(objs);

        const res = await ao.load_by_index('test-shorts', 'two');
        expect(res[0]).to.eql(objs[1]);

        // check for error on adding duplicate index
    });

    it('should be able to update indexes', async () => {
        const ao = new dao.Dao(db, 'indexTests');
        ao.backing = 'mongo';
        ao.id_key = _.property('name');
        ao.indexes = [
            new RedisMapIndex('test-shorts', 'short'),
        ];

        await ao.save({
            test: 'changed2',
            name: 'another',
            short: 'foobar',
            group: 'fiesta',
        });

        let res = await ao.load_by_index('test-shorts', 'foobar') as any;
        expect(res[0].name).to.eql('another');
        res = await ao.load_by_index('test-shorts', 'three');
        expect(res[0]).to.not.exist;
    });
});

describe('IndexerIndex', () => {
    let db: DB;

    let ao: dao.Dao<{id: string, test: string, score: number}>;

    before(async () => {
        db = await load_db(load_config().db);
        await db.mongo.dropDatabase();
        await db.mongo.setProfilingLevel('all');
        await db.redis.flushall();

        ao = new dao.Dao<{id: string, test: string, score: number}>(db, 'indexerIndexTests');
        ao.backing = 'mongo';
        ao.indexes = [
            new dao.IndexerIndex('games', (v) => {
                return [{
                    score: v.score,
                    text: v.test,
                }];
            }),
        ];
    });

    after(async () => {
        await close_db(db);
    });

    it('should create indexes on an indexer database', async () => {

        await ao.save([
            {
                id: 'wohoo',
                test: 'super mario maker',
                score: 1,
            },
            {
                id: 'wawe',
                test: 'super mario galaxy',
                score: 2,
            },
            {
                id: 'weeboo',
                test: 'the legend of zelda wind waker galaxy',
                score: 1,
            },
        ]);

        let items = await ao.load_by_index('autocomplete', 'super');

        expect(items).to.have.length(2);
        expect(items.map(_.property('id')).sort()).to.eql(['wawe', 'wohoo']);

        items = await ao.load_by_index('autocomplete', 'galaxy super');

        expect(items).to.have.length(3);
        expect(items[0]).to.eql({id: 'wawe', score: 2, test: 'super mario galaxy'});
    });

    it('should recognize changes to any index field', async () => {
        await ao.save({
                id: 'weeboo',
                test: 'the legend of zelda wind waker galaxy',
                score: 10000,
        });

        const items = await ao.load_by_index('autocomplete', 'galaxy');

        expect(items[0]).to.have.property('id', 'weeboo');
        expect(items[0]).to.have.property('score', 10000);
    });

    it('should delete indexes on indexer databases', async () => {
        await ao.remove('wawe');

        const items = await ao.load_by_index('autocomplete', 'galaxy super');

        expect(items).to.have.length(2);
        expect(items[0]).to.have.property('id', 'weeboo');
    });
});
