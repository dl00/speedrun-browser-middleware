import * as jobFuncs from '../../jobs/gamelist';

import { GameDao } from '../../lib/dao/games';
import { CategoryDao } from '../../lib/dao/categories';
import { Sched } from '../../sched';
import { DB, load_db, close_db } from '../../lib/db';
import { SCHED_TEST_CONFIG } from '../sched';
import { load_config } from '../../lib/config';

import { expect } from 'chai';

describe('jobs/gamelist', () => {

  var db: DB;
  var sched: Sched;

  const testGame: jobFuncs.SRCGame = {
    'id': 'imported_game',
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
    'categories': {data: [{id: 'imported_category', name: 'test', weblink: '', miscellaneous: false, type: 'per-game'}]},
    'levels': {data: []}
  }

  beforeEach(async () => {
    db = await load_db(load_config().db);
    await db.mongo.dropDatabase();
    await db.mongo.setProfilingLevel('all');
    await db.redis.flushall();
    sched = new Sched(SCHED_TEST_CONFIG, db);
  });

  after(async () => {
    await close_db(db);
    sched.close();
  });

  it('should apply game data', async () => {
    const game_dao = new GameDao(db);
    const category_dao = new CategoryDao(db);

    await jobFuncs.apply_games(sched, {
      items: [testGame],
      pos: null,
      done: 0,
      total: 0,
      asOf: Date.now(),
      desc: 'dummy'
    });

    const [gd] = await game_dao.load('imported_game');

    expect(gd).to.exist;

    const [cd] = await category_dao.load('imported_category');

    expect(cd).to.exist;
  });
});