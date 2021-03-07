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

import { BulkGameAssets } from './games';
import { LeaderboardRunEntry, Run, run_to_bulk, RunDao } from './runs';

import { Dao, IndexerIndex } from '.';

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

    const score = Math.floor((user.score || 1) * 100);

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
        super(db, 'users', 'mongo');

        this.id_key = _.property('id');

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

    protected async pre_store_transform(user: User): Promise<User> {
        normalize_user(user);

        user.score = await this.calculate_score(user);

        return user;
    }

    private async calculate_score(player: User): Promise<number> {
        // look at personal bests for each game.
        // we want to find the score of the game and multiply it by a standing score

        const playerBests = await new RunDao(this.db).get_player_pbs(player.id, false, '', 100);

        if(!_.keys(playerBests).length)
            return 0;

        let score = 0;

        // cheap method for computing player score based on amount of time since last submission
        for(const lbr of playerBests) {

            const submittedDate = new Date(lbr.run.submitted);

            score += 30 / (Date.now() - submittedDate.getTime());
        }

        return score;
    }
}
