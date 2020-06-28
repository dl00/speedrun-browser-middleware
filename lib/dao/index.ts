import * as assert from 'assert';
import * as _ from 'lodash';

import * as util from 'util';

import { DB } from '../db';

export interface ScanOptions {
    filter?: any;
    sort?: any;
    skip?: number;

    batchSize: number;

    // used to resume a previously paused cursor, between calls to scanOnce
    cur?: any;
}

export interface DaoConfig<T> {
    db: DB;
    collection: string;
    backing: 'redis'|'mongo';

    id_key: (obj: T) => string;

    save(objs: T|T[]): Promise<void>;
    load(ids: string|string[], options?: any): Promise<any[]>;
}

export interface IndexDriver<T> {
    name: string;
    forceIndex?: boolean;

    /// retrieve objects using the given string index keys
    load(conf: DaoConfig<T>, keys: string[], options: any): Promise<Array<T|null>>;

    /// sets indexes associated with the given objects. the objects have already been stored in the db.
    apply(conf: DaoConfig<T>, objs: T[]): Promise<void>;

    /// unset indexes associated with the given objects.
    clear(conf: DaoConfig<T>, objs: T[]): Promise<void>;

    /// indicates if the given objects generate different indexes, thereby requiring a refresh
    has_changed(old_obj: T, new_obj: T): boolean;
}

export class IndexerIndex<T> implements IndexDriver<T> {
    public name: string;
    public index_by: (obj: T) => Array<{text: string, score: number, namespace?: string}>;
    private indexer_name: string;

    constructor(indexer_name: string, index_by: (obj: T) => Array<{text: string, score: number, namespace?: string}>) {
        this.name = 'autocomplete';
        this.indexer_name = indexer_name;
        this.index_by = index_by;
    }

    public async load(conf: DaoConfig<T>, keys: string[], options: any = {}): Promise<Array<T|null>> {
        if (keys.length !== 1) {
            throw new Error('IndexerIndex expects only a single text search to load');
        }

        const ids = await conf.db.indexers[this.indexer_name].search_raw(keys[0], {maxResults: 20});
        if (!ids.length) {
            return [];
        }

        return await conf.load(ids, options);
    }

    public async apply(conf: DaoConfig<T>, objs: T[]) {
        // install autocomplete entry
        await Promise.all(objs.map(async (obj: T) => {
            await conf.db.indexers[this.indexer_name].add(conf.id_key(obj), this.index_by(obj));
        }));
    }

    public async clear(conf: DaoConfig<T>, objs: T[]) {
        await Promise.all(objs.map(async (obj: T) => {
            await conf.db.indexers[this.indexer_name].remove(conf.id_key(obj));
        }));
    }

    public has_changed(old_obj: T, new_obj: T): boolean {
        return !_.isEqual(this.index_by(old_obj), this.index_by(new_obj));
    }
}

export class Dao<T> implements DaoConfig<T> {
    public db: DB;
    public collection: string;
    public backing: 'redis' | 'mongo';
    public indexes: Array<IndexDriver<T>> = [];
    public id_key: (obj: T) => string = _.property('id');

    public massage_sort: {[key: string]: any} = {};

    protected computed: {[path: string]: (obj: T) => Promise<any>} = {};

    constructor(db: DB, collection: string, backing?: 'redis'|'mongo') {
        this.collection = collection;
        this.db = db;
        this.backing = backing || 'redis';
    }

    public async save(objs: T|T[]) {
        if (!_.isArray(objs)) {
            objs = [objs];
        }

        if (!objs.length) {
            throw new Error(`Dao ${this.collection} save() called with no objects to save`);
        }

        if (_.findIndex(objs, _.isNil) !== -1) {
            throw new Error(`Dao ${this.collection} trying to save a null object: ${util.inspect(objs)}`);
        }

        // run the transform for each obj
        let prev_objs = await this.load(objs.map(this.id_key), {skipComputed: true});
        assert.equal(objs.length, prev_objs.length,
            'previous objects should be same length and mappable to new objs');

        for (let i = 0;i < objs.length;i++) {
            objs[i] = await this.pre_store_transform(objs[i], prev_objs[i]);
        }

        await require(`./backing/${this.backing}`).save(this, objs);

        // process indexes
        // get a list of deleted and inserted indexes
        // updates will trigger both a delete and insert, whereas inserts will only trigger an insert
        for (const idx of this.indexes) {
            // updated objects can be seen by a change in the key_by property
            const insert_indexes_objs = [], remove_previous_index_objs = [];
            for (let i = 0; i < objs.length; i++) {
                // new objects are indicated by null in prev_objs returned values
                if (_.isNil(prev_objs[i])) {
                    insert_indexes_objs.push(objs[i]);
                }
                else if (idx.has_changed(prev_objs[i]!, objs[i]) || idx.forceIndex) {
                    remove_previous_index_objs.push(prev_objs[i]!);
                    insert_indexes_objs.push(objs[i]);
                }
            }

            if (remove_previous_index_objs.length) {
                await idx.clear(this, remove_previous_index_objs);
            }
            if (insert_indexes_objs.length) {
                await idx.apply(this, insert_indexes_objs);
            }
        }
    }

    public async load(ids: string|string[], options: any = {}): Promise<Array<T|null>> {
        if (!_.isArray(ids)) {
            ids = [ids];
        }

        if (!ids.length) {
            throw new Error('Dao load() called with no IDs to load');
        }

        const objs = await require(`./backing/${this.backing}`).load(this, ids);

        if (!options.skipComputed) {
            for (const prop in this.computed) {
                await Promise.all(_.map(objs, async (obj: any) => {
                    if (obj) {
                        _.set(obj, prop, await this.computed[prop](obj));
                    }
                }));
            }
        }

        return objs;
    }

    public async remove(ids: string|string[]): Promise<Array<T|null>> {

        if(!ids || !ids.length) {
            throw new Error('Dao remove() called with no objs to remove')
        }

        if (!_.isArray(ids)) {
            ids = [ids];
        }

        if (this.indexes.length) {
            const objs = _.reject(await this.load(ids), _.isNil) as T[];

            // first delete indexes
            for (const idx of this.indexes) {
                await idx.clear(this, objs);
            }
        }

        // now delete actual obj
        return await require(`./backing/${this.backing}`).remove(this, ids);
    }

    public async scan(options: ScanOptions, func: Function): Promise<number> {
        return await require(`./backing/${this.backing}`).scan(this, options, func);
    }

    public async scanOnce(options: ScanOptions): Promise<[any, Array<T>]> {
        return await require(`./backing/${this.backing}`).scanOnce(this, options);
    }

    public async count(): Promise<number> {
        return await require(`./backing/${this.backing}`).count(this);
    }

    public async load_by_index(index: string, vals: string|string[], options: any = {}): Promise<Array<T|null>> {
        if (!_.isArray(vals)) {
            vals = [vals];
        }

        const idx = _.find(this.indexes, (v) => v.name == index);

        if (!idx) {
            throw new Error(`Undefined Index: ${index}`);
        }

        return await idx.load(this, vals, options);
    }

    /// regenerates data matching the given filter
    /// useful when supplementary data structures are changed or index needs a refresh
    public async massage(filter = {}, skip = 0) {

        const scan_options = {
            filter,
            skip,
            sort: this.massage_sort,
            batchSize: 200,
        };

        let seen = 0;

        const count = await require(`./backing/${this.backing}`).scan(this, scan_options, async (objs: any) => {
            seen += objs.length;
            console.log('[MASSAGE]', seen);

            for (const nullobj of _.remove(objs, (v: T) => !this.id_key(v))) {
                console.log('[IGNORE/CHECK]', nullobj);
            }

            await this.massage_hook(objs);
            await this.save(objs);
        });

        return count;
    }

    public async massage_hook(_objs: any[]) {
        _.noop();
    }

    protected async pre_store_transform(obj: T, _old_obj: T|null): Promise<T> {
        return obj;
    }
}
