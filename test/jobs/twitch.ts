import * as jobFuncs from '../../jobs/twitch';

import { GameDao, Game } from '../../lib/dao/games';
import { StreamDao } from '../../lib/dao/streams';
import { UserDao, User } from '../../lib/dao/users';

import { Sched } from '../../sched';
import { SCHED_TEST_CONFIG } from '../sched';
import { load_db, DB, close_db } from '../../lib/db';
import { load_config } from '../../lib/config';

import { expect } from 'chai';

describe('jobs/twitch', () => {

  var db: DB;
  var sched: Sched;

  const testGame: Game = {
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
  }

  beforeEach(async () => {
    db = await load_db(load_config().db);
    await db.mongo.dropDatabase();
    await db.mongo.setProfilingLevel('all');
    await db.redis.flushall();
    sched = new Sched(SCHED_TEST_CONFIG, db);
  });

  afterEach(async () => {
    await close_db(db);
    sched.close();
  });

  it('should apply twitch game mapping', async () => {
    const game_dao = new GameDao(db);

    await game_dao.save(testGame);

    await jobFuncs.apply_twitch_games(sched, {
      items: [{
        id: 'twitch_game_id_thing',
        name: 'A Twitch Game Name'
      }],
      asOf: Date.now(),
      pos: null,
      done: 0,
      total: 0,
      desc: 'dummy'
    });

    const [newTestGame] = await game_dao.load(testGame.id);

    expect(newTestGame?.twitch_id).to.eql('twitch_game_id_thing');
  });

  it('should apply and delete twitch active streams', async () => {
    const user_dao = new UserDao(db);
    const stream_dao = new StreamDao(db);

    const testUser: User = {
      "id": "mytest",
      bests: {},
      "names": {
        "international": "Someone",
        "japanese": null
      },
      "weblink": "https://www.speedrun.com/user/Someone",
      "name-style": {
        "style": "gradient",
        "color-from": {
          "light": "#4646CE",
          "dark": "#6666EE"
        },
        "color-to": {
          "light": "#249BCE",
          "dark": "#44BBEE"
        }
      },
      "role": "user"
    }

    await user_dao.save(testUser);

    // test patching
    await jobFuncs.apply_twitch_streams(sched, {
      items: [{
        id: 'mytest',
        online: true,
        data: {
          user_name: 'whatever',
          user: testUser,
          game: testGame,
          gg_ids: [],
          title: 'some title',
          language: 'en',
          viewer_count: 1,
          started_at: new Date().toString(),
          thumbnail_url: ''
        }
      }],
      asOf: Date.now(),
      pos: null,
      done: 0,
      total: 0,
      desc: 'dummy'
    });

    const [strm] = await stream_dao.load('mytest');

    expect(strm).to.exist;

    // test deletion
    await jobFuncs.apply_twitch_streams(sched, {
      items: [{
        id: 'mytest',
        online: false,
        data: null
      }],
      asOf: Date.now(),
      pos: null,
      done: 0,
      total: 0,
      desc: 'dummy'
    });

    expect((await stream_dao.load('mytest'))[0]).to.not.exist;
  });
});