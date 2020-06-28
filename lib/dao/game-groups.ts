import * as _ from 'lodash';

import * as assert from 'assert';

import { DB } from '../db';

import {
    normalize,
    BaseUpstream
} from '../speedrun-api';

import { Dao, DaoConfig, IndexDriver, IndexerIndex } from './';

import { GameDao } from './games';

export interface GameGroup extends BaseUpstream {
    id: string;
    name: string;
    type: string;
    game_count?: number;
}

function get_game_group_search_indexes(gg: GameGroup) {
    const indexes: Array<{ text: string, score: number, namespace?: string }> = [];
    indexes.push({ text: gg.name.toLowerCase(), score: gg.game_count || 1 });

    return indexes;
}

const POPULAR_GAME_GROUPS_KEY = 'gg_rank';

class PopularGameGroupsIndex implements IndexDriver<GameGroup> {
    public name: string;
    private max_return: number;

    constructor(name: string, max_return: number) {
        this.name = name;
        this.max_return = max_return;
    }

    public async load(conf: DaoConfig<GameGroup>, keys: string[]): Promise<Array<GameGroup|null>> {
        assert.equal(keys.length, 1, 'PopularGameGroupsIndex only supports reading from a single key at a time');

        // we only read the first
        let offset;
        if (keys[0]) {
            offset = parseInt(keys[0]);
        }
        else {
            offset = 0;
        }

        const popular_game_ids: string[] = await conf.db.redis.zrevrange(POPULAR_GAME_GROUPS_KEY,
            offset, offset + this.max_return - 1);

        if (!popular_game_ids.length) {
            return [];
        }

        return await conf.load(popular_game_ids);
    }

    public async apply(conf: DaoConfig<GameGroup>, ggs: GameGroup[]) {
        // have to get games to deal with game group data
        const m = conf.db.redis.multi();

        for (const gg of ggs) {
            const gg_score = gg.game_count || 0;

            // install master rank list
            m.zadd(POPULAR_GAME_GROUPS_KEY, gg_score.toString(), gg.id);
        }

        await m.exec();
    }

    public async clear(conf: DaoConfig<GameGroup>, objs: GameGroup[]) {
        const keys = _.map(objs, conf.id_key);

        await conf.db.redis.zrem(POPULAR_GAME_GROUPS_KEY,
            ...keys);
    }

    public has_changed(old_obj: GameGroup, new_obj: GameGroup): boolean {
        return old_obj.game_count != new_obj.game_count;
    }
}

export interface GameGroupDaoOptions {
    max_items?: number;
}

export class GameGroupDao extends Dao<GameGroup> {
    constructor(db: DB, options?: GameGroupDaoOptions) {
        super(db, 'game_groups', 'redis');

        this.id_key = _.property('id');

        this.indexes = [
            new IndexerIndex('game_groups', get_game_group_search_indexes),
            new PopularGameGroupsIndex('popular_game_groups', options && options.max_items ? options.max_items : 100),
        ];
    }

    // refreshes the score for a game by counting the number of games in that game group
    public async rescore_game_group(ids: string|string[]) {

        if (!_.isArray(ids)) {
            ids = [ids];
        }

        const scores = await new GameDao(this.db).get_game_group_count(ids);

        const ggs = await this.load(ids);

        for (let i = 0; i < ggs.length; i++) {
            if (ggs[i]) {
                ggs[i]!.game_count = scores[i];
            }
        }

        await this.save(_.reject(ggs, _.isNil) as GameGroup[]);

        return ggs;
    }

    public async load_popular(offset?: number) {
        return await this.load_by_index('popular_game_groups', `${offset || ''}`);
    }

    protected async pre_store_transform(gg: GameGroup): Promise<GameGroup> {
        normalize(gg);
        return gg;
    }
}
