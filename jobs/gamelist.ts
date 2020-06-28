// Generates an effective, searchable index of games to browse. Takes into account:
// * Game popularity (according to wikipedia data)
// * Autocomplete (indexer) indexing

import * as _ from 'lodash';

import * as puller from '../lib/puller';

import pTimeout from 'p-timeout';

import { Category, CategoryDao } from '../lib/dao/categories';
import { Game, GameDao, BulkGame } from '../lib/dao/games';
import { GameGroup, GameGroupDao } from '../lib/dao/game-groups';
import { Level, LevelDao } from '../lib/dao/levels';

import { CursorData, Sched } from '../sched/index';

const debug = require('debug')('jobs:gamelist');

const GAME_BATCH_COUNT = 50;

export interface SRCGame extends BulkGame {
    categories: { data: Category[] },
    levels: { data: Level[] },

    released: number,

    created: string
}

export async function generate_games(sched: Sched, cur: CursorData<SRCGame>|null): Promise<CursorData<SRCGame>|null> {
    let res: SRCGame[] = [];
    let pagination: any = null;
    try {
        const d = await pTimeout(puller.do_pull(
            sched.storedb, 
            `/games?embed=levels.variables,categories.variables,platforms,regions,developers,publishers,genres&max=${GAME_BATCH_COUNT}&offset=${cur?.pos || 0}`),
            30000);

        res = d.data.data;
        pagination = d.data.pagination;
    } catch(err) {
        // really naive way to tell if its a 500 error
        if(err.toString().indexOf('50') != -1 || err.toString().indexOf('timed out') != -1) {
            // possibly SRC issue, switch to one at a time
            debug(`src bug: ${err.toString()}, switch to one at a time mode...`);
            for(let i = 0;i < GAME_BATCH_COUNT;i++) {
                try {
                    const d = await puller.do_pull(sched.storedb, `/games?embed=levels.variables,categories.variables,platforms,regions,developers,publishers,genres&max=1&offset=${(cur?.pos || 0) + i}`);

                    if(d.data.data)
                        res.push(d.data.data);
                } catch(err) {
                    // ignore 
                }
            }

            pagination = {
                max: 1,
                size: 1
            }
        }
        else {
            throw new Error(`src call failed: ${err}`);
        }
    }

    const nextPos = cur ? parseInt(cur.pos!) : GAME_BATCH_COUNT;

    return {
        items: res,
        asOf: Date.now(),
        desc: `games ${nextPos}..${nextPos + GAME_BATCH_COUNT}`,
        done: (cur?.done || 0) + res.length,
        total: 0,
        pos: pagination.max == pagination.size ? (nextPos + GAME_BATCH_COUNT).toString() : null
    }
}

export async function apply_games(sched: Sched, cur: CursorData<SRCGame>) {
    const games: Game[] = [];
    const categories: Category[] = [];
    const levels: Level[] = [];
    const gameGroups: GameGroup[] = [];

    for(const g of cur.items) {
        categories.push(...g.categories.data.map(c => {
            c.game = g.id;
            c.variables = (<any>c.variables).data;
            return c;
        }));
        levels.push(...g.levels.data.map(l => {
            l.game = g.id;
            l.variables = (<any>l.variables).data;
            return l;
        }));

        // to preserve order of categories, levels...
        (<any>g).categories = _.map(g.categories.data, 'id');
        (<any>g).levels = _.map(g.levels.data, 'id');

        for(let groupable of ['genres', 'platforms', 'developers', 'publishers']) {
            let ggg: GameGroup[] = (g as { [key: string]: any })[groupable].data;

            if (ggg && ggg.length) {
                let type = groupable.substr(0, groupable.length - 1);
                let moreGameGroups = _.map(
                    _.cloneDeep(ggg), v => {
                        v.type = type;
                        return v;
                    });
                
                gameGroups.push(...moreGameGroups);
            }
        }

        games.push(g as any);
    }

    const game_dao = new GameDao(sched.storedb);
    const game_group_dao = new GameGroupDao(sched.storedb);

    const saves = [
        game_dao.save(games),
        game_group_dao.save(gameGroups)
    ];

    if(categories.length)
        saves.push(new CategoryDao(sched.storedb).save(categories));

    if(levels.length)
        saves.push(new LevelDao(sched.storedb).save(levels));

    // write everything to the db
    await Promise.all(saves);

    // TODO: rescore for game, game groups
    await game_dao.rescore_games(_.map(games, 'id'));
    await game_group_dao.rescore_game_group(_.map(gameGroups, 'id'));
}