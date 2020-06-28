import * as fs from 'fs';
import * as path from 'path';

import * as express from 'express';

import { Config } from '../lib/config';
import { DB, load_db } from '../lib/db';

export let storedb: DB|null = null;
export let config: Config|null = null;

export let MIN_APP_VERSION = '20';

export function create_express_server() {
    const app = express();

    // add middlewares

    return app;
}

export async function run(conf: Config) {

    console.log('Start API');

    config = conf;

    // load storedb
    storedb = await load_db(config.db);

    // create an express server
    const app = create_express_server();

    // min app version
    app.use((_req, res, next) => {
        res.setHeader('x-sr-appversion', MIN_APP_VERSION);
        next();
    });

    // load endpoints
    const endpoint_modules = fs.readdirSync(path.join(__dirname, 'endpoints'));
    const loaded: {[name: string]: express.Router} = {};
    for (const endpoint_module of endpoint_modules) {
        const name = endpoint_module.split('.')[0];
        if (loaded[name]) {
            continue;
        }

        console.log('Load endpoint:', '/' + name);
        loaded[name] = require(path.join(__dirname, 'endpoints', name));
        app.use('/api/v1/' + name, loaded[name]);
    }

    app.listen(config!.listen, () => {
        console.log('API Ready', config!.listen);
    });
}
