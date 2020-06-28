
import * as _ from 'lodash';

import { DaoConfig, IndexDriver, ScanOptions } from '../';
import { Cursor } from 'mongodb';

// given an ordered array, makes the set of objects in the last parameter match the order
// of the arr based on matching the predicate.
// this is a O(n) operation
function associate(arr: string[], predicate: string, objs: any[]) {
    // create a dictionary of strings mapped to corresponding positions
    const assocs: {[key: string]: number} = _.chain(arr)
        .map((v, i) => [v, i])
        .fromPairs()
        .value();

    const ret: any[] = _.fill(Array(arr.length), null);

    for (const obj of objs) {
        // simply insert into the array at the matching position
        ret[assocs[_.get(obj, predicate)]] = obj;
    }

    return ret;
}

export async function save(conf: DaoConfig<any>, objs: any[]) {
    await conf.db.mongo.collection(conf.collection).bulkWrite(
        objs.map((obj: any) => {
            return {
                replaceOne: {
                    filter: { _id: conf.id_key(obj) },
                    replacement: obj,
                    upsert: true,
                }
            }
        }), {
            ordered: false
        }
    );
}

export async function load(conf: DaoConfig<any>, ids: any[]) {
    const data = await conf.db.mongo.collection(conf.collection)
        .find({ _id: { $in: ids } })
        .toArray();

    if (!data.length) {
        return _.fill(new Array(ids.length), null);
    }

    return _.map(associate(ids, '_id', data), (v) => {
        if (_.isNil(v))
            return null;
        else
            return _.omit(v, '_id')
    });
}

export async function remove(conf: DaoConfig<any>, ids: string[]) {
    await conf.db.mongo.collection(conf.collection).deleteMany({ _id: { $in: ids }});
}

export async function scanOnce(conf: DaoConfig<any>, options: ScanOptions): Promise<Array<any>> {

    const cursor = options.cur as Cursor || await conf.db.mongo.collection(conf.collection)
        .find(options.filter || {})
        .sort(options.sort || {})
        .skip(options.skip || 0);
    
    const objs = new Array(options.batchSize);

    let cur;
    for (cur = 0; cur < options.batchSize && await cursor.hasNext(); cur++) {
        objs[cur] = await cursor.next();
    }

    objs.splice(cur, options.batchSize);

    return [cursor.hasNext() ? cursor : null, objs];
}

export async function scan(conf: DaoConfig<any>, options: ScanOptions, func: Function): Promise<number> {
    const cursor = await conf.db.mongo.collection(conf.collection)
        .find(options.filter || {})
        .sort(options.sort || {})
        .skip(options.skip || 0);

    let count = 0;
    const objs = new Array(options.batchSize);

    while (await cursor.hasNext()) {

        let cur;
        for (cur = 0; cur < options.batchSize && await cursor.hasNext(); cur++) {
            objs[cur] = await cursor.next();
        }

        objs.splice(cur, options.batchSize);

        count += cur;

        await func(objs);
    }

    return count;
}

export async function count(conf: DaoConfig<any>): Promise<number> {
    return await conf.db.mongo.collection(conf.collection).estimatedDocumentCount();
}

export class MongoMapIndex<T> implements IndexDriver<T> {
    public name: string;
    public key_by: string;

    private created: boolean = false;

    constructor(name: string, key_by: string) {
        this.name = name;
        this.key_by = key_by;
    }

    public async load(conf: DaoConfig<T>, keys: string[]): Promise<Array<T|null>> {
        const data = await conf.db.mongo.collection(conf.collection)
            .find(_.set({}, this.key_by, { $in: keys}))
            .toArray();

        if (!data.length) {
            return data;
        }

        return _.map(associate(keys, this.key_by, data), (v) => _.omit(v, '_id'));
    }

    public async apply(conf: DaoConfig<T>, _objs: T[]) {
        if (!this.created) {
            const idx: any = {};
            idx[this.key_by] = 1;

            try {
                await conf.db.mongo.collection(conf.collection).createIndex(idx, {unique: true});
            } catch (_) {}

            this.created = true;
        }
    }

    public async clear(_conf: DaoConfig<T>, _objs: T[]) {}

    public has_changed(old_obj: T, new_obj: T): boolean {
        return _.get(old_obj, this.key_by) != _.get(new_obj, this.key_by);
    }
}

export class MongoMultiIndex<T> implements IndexDriver<T> {
    public name: string;
    public key_by: string;

    private created: boolean = false;

    constructor(name: string, key_by: string) {
        this.name = name;
        this.key_by = key_by;
    }

    public async load(conf: DaoConfig<T>, keys: string[]): Promise<Array<T|null>> {
        const data = await conf.db.mongo.collection(conf.collection)
            .find(_.set({}, this.key_by, { $in: keys}))
            .toArray();

        if (!data.length) {
            return data;
        }

        return _.map(data, (v) => _.omit(v, '_id'));
    }

    public async apply(conf: DaoConfig<T>, _objs: T[]) {
        if (!this.created) {
            const idx: any = {};
            idx[this.key_by] = 1;

            try {
                await conf.db.mongo.collection(conf.collection).createIndex(idx);
            } catch (_) {}

            this.created = true;
        }
    }

    public async clear(_conf: DaoConfig<T>, _objs: T[]) {}

    public has_changed(old_obj: T, new_obj: T): boolean {
        return _.get(old_obj, this.key_by) != _.get(new_obj, this.key_by);
    }
}
