
import * as _ from 'lodash';

import { DaoConfig, IndexDriver, ScanOptions } from '../';

export async function save(conf: DaoConfig<any>, objs: any[]) {
    const set_vals = _.chain(objs)
        .keyBy(conf.id_key)
        .mapValues(JSON.stringify)
        .toPairs()
        .flatten()
        .value() as any;

    await conf.db.redis.hmset(conf.collection, ...set_vals);
}

export async function load(conf: DaoConfig<any>, ids: string[]) {
    const raw_vals = await conf.db.redis.hmget(conf.collection, ...ids);
    return _.map(raw_vals, JSON.parse) as any[];
}

export async function remove(conf: DaoConfig<any>, ids: string[]) {
    await conf.db.redis.hdel(conf.collection, ...ids);
}

export async function scanOnce(conf: DaoConfig<any>, options: ScanOptions): Promise<[any, Array<any>]> {
    const scan = await conf.db.redis.hscan(conf.collection, options.cur || 0, 'COUNT', options.batchSize);

    const objs = _.chain(scan[1])
            .filter((_v: any, i: number) => i % 2 === 1)
            .map(JSON.parse)
            .value();

    return [parseInt(scan[0]) != 0 ? parseInt(scan[0]) : null, objs];
}

export async function scan(conf: DaoConfig<any>, options: ScanOptions, func: Function): Promise<number> {
    let cur = 0;
    let count = 0;

    do {
        const [newCur, objs] = await scanOnce(conf, _.defaults({ cur }, options));

        cur = newCur;
        count += objs.length;
        await func(objs);
    } while (cur);

    return count;
}

export async function count(conf: DaoConfig<any>): Promise<number> {
    return await conf.db.redis.hlen(conf.collection);
}

export class RedisMapIndex<T> implements IndexDriver<T> {
    public name: string;
    public key_by: ((obj: T) => string)|string;

    constructor(name: string, key_by: ((obj: T) => string)|string) {
        this.name = name;
        this.key_by = key_by;
    }

    public async load(conf: DaoConfig<T>, keys: string[]): Promise<Array<T|null>> {
        const mapIds = <string[]>await conf.db.redis.hmget(`${conf.collection}:${this.name}`, ...keys);
        return await conf.load(mapIds);
    }

    public async apply(conf: DaoConfig<T>, objs: T[]) {
        const set_vals = _.chain(objs)
            .keyBy(this.key_by)
            .mapValues(conf.id_key)
            .toPairs()
            .flatten()
            .value() as any;

        await conf.db.redis.hmset(`${conf.collection}:${this.name}`, ...set_vals);
    }

    public async clear(conf: DaoConfig<T>, objs: T[]) {
        const keys = _.map(objs, this.key_by as (obj: T) => string);

        await conf.db.redis.hdel(`${conf.collection}:${this.name}`,
            ...keys);
    }

    public has_changed(old_obj: T, new_obj: T): boolean {
        if (_.isString(this.key_by)) {
            return _.get(old_obj, this.key_by) != _.get(new_obj, this.key_by);
        }
        else {
            return this.key_by(old_obj) != this.key_by(new_obj);
        }
    }
}

export class RedisMultiIndex<T> implements IndexDriver<T> {
    public name: string;
    public key_by: ((obj: T) => string)|string;

    constructor(name: string, key_by: ((obj: T) => string)|string) {
        this.name = name;
        this.key_by = key_by;
    }

    public async load(conf: DaoConfig<T>, keys: string[]): Promise<Array<T|null>> {
        if (keys.length !== 1) {
            throw new Error('RedisMultiIndex expects to only work with a single key');
        }

        const mapIds: string[] = await conf.db.redis.smembers(`${conf.collection}:${this.name}:${keys[0]}`);

        if (!mapIds.length) {
            return [];
        }

        return await conf.load(mapIds);
    }

    public async apply(conf: DaoConfig<T>, objs: T[]) {
        const m = await conf.db.redis.multi();

        for (const obj of objs) {
            const key = _.isFunction(this.key_by) ? this.key_by(obj) : _.get(obj, this.key_by);
            m.sadd(`${conf.collection}:${this.name}:${key}`, conf.id_key(obj));
        }

        await m.exec();
    }

    public async clear(conf: DaoConfig<T>, objs: T[]) {
        const m = await conf.db.redis.multi();

        for (const obj of objs) {
            const key = _.isFunction(this.key_by) ? this.key_by(obj) : _.get(obj, this.key_by);
            m.srem(`${conf.collection}:${this.name}:${key}`, conf.id_key(obj));
        }

        await m.exec();
    }

    public has_changed(old_obj: T, new_obj: T): boolean {
        if (_.isString(this.key_by)) {
            return _.get(old_obj, this.key_by) != _.get(new_obj, this.key_by);
        }
        else {
            return this.key_by(old_obj) != this.key_by(new_obj);
        }
    }
}
