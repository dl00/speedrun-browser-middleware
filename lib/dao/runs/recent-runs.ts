import * as assert from 'assert';

import * as _ from 'lodash';
import * as moment from 'moment';

import { DaoConfig, IndexDriver } from '../'

import { LeaderboardRunEntry, Run } from './structures';

import { BulkGame, Game, GameDao } from '../games';

import { GameGroup } from '../game-groups';

export class RecentRunsIndex implements IndexDriver<LeaderboardRunEntry> {
    public name: string;
    private date_property: string;
    private redis_key: string;
    private keep_count: number;
    private max_return: number;

    constructor(name: string, date_property: string, redis_key: string, keep_count: number, max_return: number) {
        this.name = name;
        this.date_property = date_property;
        this.redis_key = redis_key;
        this.keep_count = keep_count;
        this.max_return = max_return;
    }

    public async load(conf: DaoConfig<LeaderboardRunEntry>, keys: string[]): Promise<Array<LeaderboardRunEntry|null>> {

        assert.equal(keys.length, 1, 'RecentRunsIndex only supports reading from a single key at a time');

        // we only read the first
        const spl = keys[0].split(':');

        const genre = spl[0];
        const offset = parseInt(spl[1]);

        const latest_run_ids: string[] = await conf.db.redis.zrevrange(this.redis_key + (genre ? ':' + genre : ''),
            offset, offset + this.max_return - 1);

        if(!latest_run_ids.length)
            return [];

        return await conf.load(latest_run_ids);
    }

    public async apply(conf: DaoConfig<LeaderboardRunEntry>, objs: LeaderboardRunEntry[]) {
        // have to get games to deal with genre data
        const game_ids = _.map(objs, 'run.game.id');
        const games = _.zipObject(game_ids, await new GameDao(conf.db).load(game_ids));

        const m = conf.db.redis.multi();

        for (const lbr of objs) {

            if (lbr.run.times.primary_t <= 0.01) {
                // ensure these "dummy" runs are never added
                m.zrem(this.redis_key, lbr.run.id);
                continue;
            }

            const date_score = moment(_.get(lbr.run as Run, this.date_property) || 0).unix().toString();

            m
                .zadd(this.redis_key, date_score, lbr.run.id)
                .zremrangebyrank(this.redis_key, 0, -this.keep_count - 1);

            const game = games[((lbr.run as Run).game as BulkGame).id as string] as Game;

            if (!game) {
                throw new Error(`Missing game for run: ${lbr.run.id}, game id: ${((lbr.run as Run).game as BulkGame).id}`);
            }

            for(let grouping of ['platforms', 'genres', 'publishers', 'developers']) {
                let ggg: GameGroup[] = (game as {[key: string]: any})[grouping];
                for (const group of ggg) {
                    const gg_runs = this.redis_key + ':' + group.id;
                    m.zadd(gg_runs, date_score, lbr.run.id)
                        .zremrangebyrank(gg_runs, 0, -this.keep_count - 1);
                }
            }
        }

        await m.exec();
    }

    public async clear(conf: DaoConfig<LeaderboardRunEntry>, objs: LeaderboardRunEntry[]) {
        const keys = _.map(objs, conf.id_key);

        await conf.db.redis.zrem(this.redis_key,
            ...keys);
    }

    public has_changed(old_obj: LeaderboardRunEntry, new_obj: LeaderboardRunEntry): boolean {
        return _.get(old_obj.run as Run, this.date_property) != _.get(new_obj.run as Run, this.date_property);
    }
}
