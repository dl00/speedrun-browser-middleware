import * as _ from 'lodash';

import { load_config } from '../../lib/config';
import { GameDao } from '../../lib/dao/games';
import { GameGroupDao } from '../../lib/dao/game-groups';
import { close_db, DB, load_db } from '../../lib/db';

import { expect } from 'chai';

import 'mocha';

describe('GameGroupDao', () => {
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

    it('should index popular game groups', async () => {
        const gg_dao = new GameGroupDao(db);
        const game_dao = new GameDao(db);

        await game_dao.save([
            {
                'id': 'a_game_genre',
                'names': {international: 'A Game'},
                'abbreviation': 'agame',
                'weblink': 'https://speedrun.com/agame',
                'platforms': [],
                'regions': [],
                'genres': [{ id: 'a_genre', name: 'A Genre' }],
                'released': 2019,
                'developers': [],
                'publishers': [],
                'created': '2019-01-01',
                'release-date': '2019-01-01',
                'assets': {},
                'categories': [{id: 'dummy', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}],
            },
            {
                'id': 'a_game_with_genre_2',
                'names': {international: 'A Game'},
                'abbreviation': 'agamewithg',
                'weblink': 'https://speedrun.com/agamewithg',
                'platforms': [],
                'regions': [],
                'genres': [{ id: 'a_genre_2', name: 'A Genre 2' }],
                'released': 2019,
                'developers': [],
                'publishers': [],
                'created': '2019-01-01',
                'release-date': '2019-01-01',
                'assets': {},
                'categories': [{id: 'dummy2', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}],
            },
            {
                'id': 'another_game_with_genre_2',
                'names': {international: 'A Game'},
                'abbreviation': 'agamewithg',
                'weblink': 'https://speedrun.com/agamewithg',
                'platforms': [],
                'regions': [],
                'genres': [{ id: 'a_genre_2', name: 'A Genre 2' }],
                'released': 2019,
                'developers': [],
                'publishers': [],
                'created': '2019-01-01',
                'release-date': '2019-01-01',
                'assets': {},
                'categories': [{id: 'dummy2', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}],
            },
        ]);

        await gg_dao.save([
            {
                id: 'a_genre',
                name: 'a genre',
                type: 'genre',
                game_count: 5,
            },
            {
                id: 'a_genre_2',
                name: 'a second genre',
                type: 'genre',
                game_count: 4,
            },
        ]);

        // make sure these two runs come back, and they are in the correct order
        let ggs = await gg_dao.load_popular();

        expect(ggs[0]).to.have.property('id', 'a_genre');
        expect(ggs[1]).to.have.property('id', 'a_genre_2');

        ggs = await gg_dao.load_popular(1);

        expect(ggs.length).to.eql(1);
        expect(ggs[0]).to.have.property('id', 'a_genre_2');

        await gg_dao.rescore_game_group(['a_genre', 'a_genre_2']);

        // order of the leaderboards should be switched now
        ggs = await gg_dao.load_popular();

        expect(ggs[0]).to.have.property('id', 'a_genre_2');
        expect(ggs[0]).to.have.property('game_count', 2);
    });
});
