import * as _ from 'lodash';

import * as ioredis from 'ioredis';
import * as mongodb from 'mongodb';

const Indexer = require('@13013/indexer');

export interface DB {
    redis: ioredis.Redis;
    mongo: mongodb.Db;

    indexers: {[key: string]: any};

    batch?: {
        redis: ioredis.Pipeline;
        mongo: mongodb.Db;
        mongo_session?: mongodb.ClientSession;
    };

    mongo_client: mongodb.MongoClient;
}

export interface DBConfig {
    /// MongoDB database connection options
    mongo: {
        /// MongoDB connection string, see https://docs.mongodb.com/manual/reference/connection-string/
        uri: string,

        /// The database to use on the server
        dbName: string,

        /// Extra options for mongodb
        options?: mongodb.MongoClientOptions,
    }

    /// Redis database connection options
    redis: ioredis.RedisOptions,

    indexers: {[id: string]: IndexerConfig}
}

export interface IndexerConfig {

    /// Options for the indexer
    config: {
        depth: number, // how many letters to match sequences
        spread: number, // extra sequences to generate to account for misspellings/errornous letters
        scoreLength: number, // determines the maximum score understood by the indexer
    }

    /// Override configuration options for this redis connection
    redis: ioredis.RedisOptions,
}

export async function start_transaction(db: DB) {
    if (db.batch) {
        throw new Error('Cannot start transaction: transaction already in progress');
    }

    db.batch = {
        mongo: db.mongo,
        redis: db.redis.multi(),
    };
}

export async function exec_transaction(db: DB) {
    if (!db.batch) {
        throw new Error('Cannot end transaction: transaction must already be in progress');
    }

    // await db.batch.mongo_session!.commitTransaction();
    await db.batch.redis.exec();

    delete db.batch;
}

export function load_indexer(config: IndexerConfig, name: string) {
    return new Indexer(name, config.config, config.redis);
}

export async function load_db(conf: DBConfig): Promise<DB> {

    const db: any = {
        redis: new ioredis(_.merge(conf.redis, { lazyConnect: true })),
        mongo: null,
        mongo_client: (await mongodb.connect(conf.mongo.uri, _.merge(conf.mongo.options, {useNewUrlParser: true }))),
        indexers: {},
    };

    db.mongo = db.mongo_client.db(conf.mongo.dbName);

    await db.redis.connect();

    for(const idxr in conf.indexers) {
        conf.indexers[idxr].redis = _.defaults(conf.indexers[idxr].redis, conf.redis);
        db.indexers[idxr] = load_indexer(conf.indexers[idxr], idxr);
    }

    return db;
}

export async function close_db(db: DB) {
    await db.mongo_client.close();
    db.redis.disconnect();

    for (const ind in db.indexers) {
        // TODO: fix indexer so we don't have to call the private "rdb" directly
        db.indexers[ind].rdb.disconnect();
    }
}
