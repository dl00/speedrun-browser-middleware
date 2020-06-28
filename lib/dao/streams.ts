import * as assert from 'assert';

import * as _ from 'lodash';

import { DB } from '../db';

import { RedisMultiIndex } from './backing/redis';

import { Dao, IndexDriver, DaoConfig } from '.';
import { BulkUser } from './users';
import { BulkGame } from './games';

export interface Stream {
    user_name: string;
    user: BulkUser;
    game: BulkGame|null;
    gg_ids: string[];
    title: string;
    viewer_count: number;
    language: string;
    thumbnail_url: string;
    started_at: string;
}

const POPULAR_STREAMS_KEY = 'popular_streams_gg_rank';

class PopularStreamsIndex implements IndexDriver<Stream> {
    public name: string;
    private max_return: number;

    constructor(name: string, max_return: number) {
        this.name = name;
        this.max_return = max_return;
    }

    public async load(conf: DaoConfig<Stream>, keys: string[]): Promise<Array<Stream|null>> {
        assert.equal(keys.length, 1, 'PopularGamesIndex only supports reading from a single key at a time');

        // we only read the first
        const spl = keys[0].split(':');

        const group = spl[0];
        const lang = spl[1];
        const offset = parseInt(spl[2]);

        const strm_ids: string[] = await conf.db.redis.zrevrange(
            POPULAR_STREAMS_KEY + (group ? `:${group}` : '') + (lang ? `:${lang}` : ''),
            offset, offset + this.max_return - 1);

        if (!strm_ids.length) {
            return [];
        }

        return await conf.load(strm_ids);
    }

    public async apply(conf: DaoConfig<Stream>, streams: Stream[]) {
        // have to get games to deal with game group data
        const m = conf.db.redis.multi();

        for (const strm of streams) {

            // install master rank list
            m.zadd(POPULAR_STREAMS_KEY, strm.viewer_count.toString(), strm.user.id);
            m.zadd(POPULAR_STREAMS_KEY + ':' + strm.language, strm.viewer_count.toString(), strm.user.id)

            for(const gg of strm.gg_ids) {
                m.zadd(POPULAR_STREAMS_KEY + `:${gg}`, strm.viewer_count.toString(), strm.user.id);
                m.zadd(POPULAR_STREAMS_KEY + `:${gg}:${strm.language}`, strm.viewer_count.toString(), strm.user.id);
            }
        }

        await m.exec();
    }

    public async clear(conf: DaoConfig<Stream>, streams: Stream[]) {
        const m = conf.db.redis.multi();

        const keys = _.map(streams, conf.id_key);
        await conf.db.redis.zrem(POPULAR_STREAMS_KEY,
            ...keys);
        
        for(const strm of streams) {
            for(const gg of strm.gg_ids) {
                m.zrem(POPULAR_STREAMS_KEY + `:${gg}`, strm.user.id);
                m.zrem(POPULAR_STREAMS_KEY + `:${gg}:${strm.language}`, strm.user.id);
            } 
        }

        await m.exec();
    }

    public has_changed(old_obj: Stream, new_obj: Stream): boolean {
        return old_obj.viewer_count != new_obj.viewer_count || 
            !_.isEqual(old_obj.gg_ids, new_obj.gg_ids) ||
            !_.isEqual(old_obj.language, new_obj.language);
    }
}

export interface StreamDaoOptions {
    max_items?: number;
}

export class StreamDao extends Dao<Stream> {
    constructor(db: DB, options?: StreamDaoOptions) {
        super(db, 'streams', 'redis');

        this.id_key = _.property('user.id');

        this.indexes = [
            new RedisMultiIndex('game', 'game_id'),
            new RedisMultiIndex('game-group', 'gg_ids'),
            new PopularStreamsIndex('popular_streams_game_groups', options ? options.max_items || 100 : 100)
        ];
    }

    public async load_popular_game_group(offset?: number, gg_id?: string|null, lang?: string|null) {
        const key = `${gg_id || ''}:${lang || ''}:${offset || 0}`;

        let idx = 'popular_streams_game_groups';

        return await this.load_by_index(idx, key);
    }
}
