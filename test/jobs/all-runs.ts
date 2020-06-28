import * as jobFuncs from '../../jobs/all-runs';

import { RunDao } from '../../lib/dao/runs';
import { GameDao, Game } from '../../lib/dao/games';
import { CategoryDao, Category } from '../../lib/dao/categories';

import { Sched } from '../../sched';
import { DB, load_db, close_db } from '../../lib/db';
import { SCHED_TEST_CONFIG } from '../sched';
import { load_config } from '../../lib/config';
import { expect } from 'chai';

describe('jobs/all-runs', () => {

  var db: DB;
  var sched: Sched;

  const sampleGame: Game = {
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
  };

  const sampleCategory: Category = {
      id: 'a_category',
      game: 'a_game',
      name: 'Testing',
      type: 'per-game',
      weblink: '',
      miscellaneous: false,
      variables: [],
  }

  // ripped loosely from speedrun.com output
  const sampleRun: jobFuncs.SRCRun = {
    "id": "the_run",
    "weblink": "https://www.speedrun.com/runs/the_run",
    "game": "a_game",
    "category": "a_category",
    "level": null,
    "videos": {
      "links": [
        {
          "uri": "https://www.youtube.com/watch?v=sChJqtildUY"
        }
      ]
    },
    "comment": "I think the ghost was a .28 or something. In any case, I couldn't even see him after the pillars and knew I was onto something great.",
    "status": {
      "status": "verified",
      "examiner": "zx7ewmy8",
      "verify-date": "2020-05-03T01:17:18Z"
    },
    "players": {
      "data": [
        {
          "id": "a_player",
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
          "role": "user",
          "signup": "2019-10-08T21:01:44Z",
          "location": null,
          "twitch": null,
          "hitbox": null,
          "youtube": null,
          "twitter": {
            "uri": "https://www.twitter.com/someone"
          },
          "speedrunslive": null,
          "links": [
            {
              "rel": "self",
              "uri": "https://www.speedrun.com/api/v1/users/someone"
            },
            {
              "rel": "runs",
              "uri": "https://www.speedrun.com/api/v1/runs?user=somenoe"
            },
            {
              "rel": "games",
              "uri": "https://www.speedrun.com/api/v1/games?moderator=someone"
            },
            {
              "rel": "personal-bests",
              "uri": "https://www.speedrun.com/api/v1/users/someone/personal-bests"
            }
          ]
        }
      ]
    },
    "date": "2020-05-02",
    "submitted": "2020-05-02T21:12:30Z",
    "times": {
      "primary": "PT1M7.020S",
      "primary_t": 67.02,
      "realtime": "PT1M7.020S",
      "realtime_t": 67.02,
      "realtime_noloads": null,
      "realtime_noloads_t": 0,
      "ingame": null,
      "ingame_t": 0
    },
    "system": {
      "platform": "w89rwelk",
      "emulated": false,
      "region": "pr184lqn"
    },
    "splits": null,
    "values": {
      "32lgeq8p": "2p12n41x",
      "6wl3jo81": "6mlnnjlp"
    },
    "links": [
      {
        "rel": "self",
        "uri": "https://www.speedrun.com/api/v1/runs/a_run"
      },
      {
        "rel": "game",
        "uri": "https://www.speedrun.com/api/v1/games/a_game"
      },
      {
        "rel": "category",
        "uri": "https://www.speedrun.com/api/v1/categories/a_category"
      },
      {
        "rel": "level",
        "uri": "https://www.speedrun.com/api/v1/levels/a_levle"
      },
      {
        "rel": "platform",
        "uri": "https://www.speedrun.com/api/v1/platforms/a_platform"
      },
      {
        "rel": "region",
        "uri": "https://www.speedrun.com/api/v1/regions/a_region"
      },
      {
        "rel": "examiner",
        "uri": "https://www.speedrun.com/api/v1/users/a_examiner"
      }
    ]
  };

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

  it('should apply and delete speedrun data', async () => {

    const game_dao = new GameDao(db);
    const category_dao = new CategoryDao(db);
    const run_dao = new RunDao(db);

    await game_dao.save(sampleGame);
    await category_dao.save(sampleCategory);

    await jobFuncs.apply_runs(sched, {
      items: [sampleRun],
      pos: null,
      asOf: 0,
      done: 0,
      total: 0,
      desc: 'dummy',
    }, []);

    const [lbr] = await run_dao.load('the_run');

    expect(lbr).to.exist;
  });
})