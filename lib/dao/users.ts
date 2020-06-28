import * as _ from 'lodash';

import { DB } from '../db';

import {
    BaseMiddleware,
    Names,
    normalize,
} from '../speedrun-api';

import { RedisMapIndex } from './backing/redis';

import { game_assets_to_bulk } from './games';
import { NewRecord } from './runs';

import { BulkGameAssets, GameDao } from './games';
import { LeaderboardRunEntry, Run, run_to_bulk, RunDao } from './runs';

import { Dao, IndexerIndex } from './';

export interface GamePersonalBests {
    id: string;
    names: Names;
    assets: BulkGameAssets;

    categories: {[id: string]: CategoryPersonalBests};
}

export interface CategoryPersonalBests {
    id: string;
    name: string;
    type: string;

    levels?: {[id: string]: LevelPersonalBests};

    run?: LeaderboardRunEntry;
}

export interface LevelPersonalBests {
    id: string;
    name: string;

    run: LeaderboardRunEntry;
}

export interface BulkUser {
    id: string;
    names?: Names;
    name?: string;
    'name-style'?: {
        style: 'solid'|'gradient'|''
        color?: {
            light: string
            dark: string,
        },
        'color-from'?: {
            light: string
            dark: string,
        },
        'color-to'?: {
            light: string
            dark: string,
        },
    };
}

export interface User extends BulkUser, BaseMiddleware {
    weblink?: string;
    role?: 'banned'|'user'|'trusted'|'moderator'|'admin'|'programmer';
    signup?: string;
    score?: number;

    twitch?: { uri: string } | null;
    youtube?: { uri: string } | null;
    twitter?: { uri: string } | null;
    speedrunslive?: { uri: string } | null;
    location?: any | null;
    hitbox?: any | null;

    bests: {[id: string]: GamePersonalBests};
}

export function user_to_bulk(user: User) {
    return _.pick(user, 'id', 'names', 'name', 'name-style', 'location');
}

// add/update the given personal best entry for the given user
export function apply_personal_best(player: User, run: LeaderboardRunEntry): NewRecord|null {

    if (!run.run.category || !run.run.category.id) {
        return null;
    }

    const category_run: CategoryPersonalBests = {
        id: run.run.category.id,
        name: run.run.category.name,
        type: run.run.category.type,
    };

    const game_run: GamePersonalBests = {
        id: run.run.game.id,
        names: run.run.game.names,
        assets: game_assets_to_bulk(run.run.game.assets),
        categories: {},
    };

    const best_run: LeaderboardRunEntry = {
        run: run_to_bulk(run.run as Run),
    };

    if (!best_run.run.submitted) {
        return null;
    }

    let old_run = null;

    if (run.run.level && run.run.level.id) {

        old_run = _.get(player, `bests["${run.run.game.id}"].categories["${run.run.category.id}"].levels["${run.run.level.id}"].run`);
        if (old_run && old_run.run.submitted && (old_run.run.id === best_run.run.id || old_run.run.submitted > best_run.run.submitted)) {
            return null;
        }

        const level_run: LevelPersonalBests = {
            id: run.run.level.id,
            name: run.run.level.name,

            run: best_run,
        };

        category_run.levels = {};
        category_run.levels[run.run.level.id] = level_run;
    } else {
        old_run = _.get(player, `bests["${run.run.game.id}"].categories["${run.run.category.id}"].run`);
        if (old_run && old_run.run.submitted && (old_run.run.id === best_run.run.id || old_run.run.submitted > best_run.run.submitted)) {
            return null;
        }

        category_run.run = best_run;
    }

    game_run.categories[run.run.category.id] = category_run;

    const new_bests: {[id: string]: GamePersonalBests} = {};

    new_bests[run.run.game.id] = game_run;

    _.merge(player, {bests: new_bests});

    return {
        old_run,
        new_run: best_run,
    };
}

function get_user_search_indexes(user: User) {
    const indexes: Array<{ text: string, score: number, namespace?: string }> = [];

    let score = Math.floor((user.score || 1) * 100);

    if (user.name) {
        indexes.push({ text: user.name.toLowerCase(), score: score });
    } else {
        for (const name in user.names) {
            if (!user.names[name]) {
                continue;
            }

            const idx: any = { text: user.names[name]!.toLowerCase(), score: score };
            if (name != 'international') {
                idx.namespace = name;
            }

            indexes.push(idx);
        }
    }

    return indexes;
}

export function normalize_user(d: User) {
    normalize(d);
}

export class UserDao extends Dao<User> {
    constructor(db: DB) {
        super(db, 'users', 'redis');

        this.id_key = _.property('id');

        this.computed = {
            /// TODO: simplify this
            bests: async (user) => {

                const run_dao = new RunDao(this.db!);

                await Promise.all(_.map(user.bests, async (bg: GamePersonalBests) => {
                    await Promise.all(_.map(bg.categories, async (bc: CategoryPersonalBests) => {
                        if (bc.run) {
                            const run = (await run_dao.load(bc.run.run.id))[0];
                            bc.run.place = run ? run.place : null;
                        } else if (bc.levels) {
                            const ids = _.map(bc.levels, 'run.run.id');
                            const runs = _.zipObject(ids, await run_dao.load(ids));

                            for (const id in bc.levels) {
                                const run = runs[bc.levels[id].run.run.id];
                                bc.levels[id].run.place = run ? run.place : null;
                            }
                        }
                    }));
                }));

                return user.bests;
            },
        };

        this.indexes = [
            new RedisMapIndex('abbr', (v: User) => {
                if (v.names && v.names.international) {
                    return v.names.international.toLowerCase();
                }

                // TODO: this is kind of dumb
                return '';
            }),
            new IndexerIndex('players', get_user_search_indexes),
        ];
    }

    public async apply_runs(runs: LeaderboardRunEntry[]): Promise<NewRecord[]> {
        const player_ids = _.chain(runs)
            .map((v) => _.map(v.run.players, 'id'))
            .flatten()
            .reject(_.isNil)
            .uniq()
            .value();

        if (!player_ids.length) {
            return [];
        } // nothing to do

        const players = _.keyBy(
            _.filter(await this.load(player_ids, {skipComputed: true}), 'id'),
            'id') as {[id: string]: User};

        if (!_.keys(players).length) {
            return []; // still nothing
        }

        const new_records: Array<NewRecord|null> = [];

        for (const run of runs) {
            for (const player of run.run.players) {
                // can only notify for non-guests (with ID)
                if (player.id) {
                    new_records.push(
                        apply_personal_best(players[player.id], run));
                }
            }
        }

        await this.save(_.values(players));

        return _.reject(new_records, _.isNil) as NewRecord[];
    }

    protected async pre_store_transform(user: User): Promise<User> {
        normalize_user(user);

        user.score = await this.calculate_score(user);

        return user;
    }

    private async calculate_score(player: User): Promise<number> {
        // look at personal bests for each game.
        // we want to find the score of the game and multiply it by a standing score

        if(!_.keys(player.bests).length)
            return 0;

        let score = 0;

        let games = await new GameDao(this.db).load(_.keys(player.bests));

        for(let game of games) {
            if(!game)
                continue;

            let game_score = Math.max(1, game.score || 1);

            let pbg = player.bests[game.id];
            for(let category_id in pbg.categories) {
                let pbc = pbg.categories[category_id];

                if(pbc.run) {
                    score += game_score / (pbc.run.place || 100);
                }
                else if(pbc.levels) {
                    for(let level_id in pbc.levels)
                        score += game_score / _.keys(pbc.levels).length /
                            (pbc.levels[level_id].run.place || 100);
                }
            }
        }

        return score;
    }
}
