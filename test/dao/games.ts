import * as _ from 'lodash';
import * as moment from 'moment';

import { load_config } from '../../lib/config';
import { GameDao } from '../../lib/dao/games';
import { LeaderboardRunEntry, RunDao } from '../../lib/dao/runs';
import { close_db, DB, load_db } from '../../lib/db';

import { expect } from 'chai';

import 'mocha';

describe('GameDao', () => {
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

    it('should index popular games', async () => {

        const game_dao = new GameDao(db, {
            game_score_time_now: moment('2018-05-10'),
            game_score_leaderboard_edge_cutoff: moment('2018-05-01'),
            game_score_leaderboard_updated_cutoff: moment('2018-05-01'),
        });

        const run_dao = new RunDao(db);

        await game_dao.save([
            {
                'id': 'a_game',
                'names': {international: 'A Game'},
                'abbreviation': 'agame',
                'weblink': 'https://speedrun.com/agame',
                'platforms': [],
                'regions': [],
                'genres': [],
                'released': 2019,
                'developers': [],
                'publishers': [],
                'created': '2019-01-01',
                'release-date': '2019-01-01',
                'assets': {},
                'categories': [{id: 'dummy', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}],
            },
            {
                'id': 'a_game_with_genre',
                'names': {international: 'A Game'},
                'abbreviation': 'agamewithg',
                'weblink': 'https://speedrun.com/agamewithg',
                'platforms': [],
                'regions': [],
                'genres': [{ id: 'my_genre', name: 'testing genre'}],
                'released': 2019,
                'developers': [],
                'publishers': [],
                'created': '2019-01-01',
                'release-date': '2019-01-01',
                'assets': {},
                'categories': [{id: 'dummy2', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}],
            },
        ]);

        const the_runs: LeaderboardRunEntry[] = [
            {
                place: 3,
                run: {
                    id: 'another_run',
                    date: '2018-04-30',
                    submitted: '2018-04-30',
                    status: {'verify-date': '2018-04-30'},
                    players: [{id: 'hello2'}],
                    times: { primary: '100', primary_t: 100 },
                    system: {},
                    values: {},
                    game: {id: 'a_game_with_genre'},
                },
            },
            {
                place: 1,
                run: {
                    id: 'one_run',
                    date: '2018-05-05',
                    submitted: '2018-05-05',
                    status: {'verify-date': '2018-05-05'},
                    players: [{id: 'hello'}],
                    times: { primary: '135', primary_t: 135 },
                    system: {},
                    values: {},
                    game: {id: 'a_game'},
                },
            },
            {
                place: 3,
                run: {
                    id: 'genre_another_run',
                    date: '2018-05-03',
                    submitted: '2018-05-03',
                    status: {'verify-date': '2018-05-03'},
                    players: [{id: 'hello'}],
                    times: { primary: '100', primary_t: 100 },
                    system: {},
                    values: {},
                    game: {id: 'a_game_with_genre'},
                },
            },
            {
                place: 1,
                run: {
                    id: 'one_run',
                    date: '2018-05-05',
                    submitted: '2018-05-05',
                    status: {'verify-date': '2018-05-05'},
                    players: [{id: 'world'}],
                    times: { primary: '135', primary_t: 135 },
                    system: {},
                    values: {},
                    game: {id: 'a_game'},
                },
            }
        ];

        await run_dao.save(the_runs);

        await db.redis.hmset('categories',
            'a_game', JSON.stringify([{id: 'dummy', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}]),
            'a_game_with_genre', JSON.stringify([{id: 'dummy2', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}]),
        );

        // make sure these two runs come back, and they are in the correct order
        let games = await game_dao.load_popular();

        expect(games[0]).to.have.property('id', 'a_game_with_genre');
        expect(games[1]).to.have.property('id', 'a_game');

        games = await game_dao.load_popular('popular', 0, 'my_genre');

        expect(games.length).to.eql(1);
        expect(games[0]).to.have.property('id', 'a_game_with_genre');

        // add another run to one of the leaderboards after the fact, should still be in new order
        the_runs.push(
            {
                place: 2,
                run: {
                    id: 'yet_another_run',
                    date: '2018-05-02',
                    submitted: '2018-05-02',
                    status: {'verify-date': '2018-05-02'},
                    players: [{id: 'special'}],
                    times: { primary: '135', primary_t: 135 },
                    system: {},
                    values: {},
                    game: {id: 'a_game'},
                },
            },
            {
                place: 3,
                run: {
                    id: 'yet_another_run',
                    date: '2018-05-08',
                    submitted: '2018-05-08',
                    status: {'verify-date': '2018-05-08'},
                    players: [{id: 'special2'}, {id: 'special3'}, {id: 'special4'}],
                    times: { primary: '135', primary_t: 135 },
                    system: {},
                    values: {},
                    game: {id: 'a_game'},
                },
            },
        );

        await run_dao.save(the_runs);

        await game_dao.rescore_games(['a_game', 'a_game_with_genre']);

        // order of the leaderboards should be switched now
        games = await game_dao.load_popular('popular', 1);

        expect(games[0]).to.have.property('id', 'a_game_with_genre');
    });
});
