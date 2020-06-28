import { inspect } from 'util';

import request from '../lib/request';

import { DB } from '../lib/db';

import { Pull, PullDao } from '../lib/dao/pulls';

import { API_PREFIX } from '../lib/speedrun-api';

export async function do_pull(db: DB, api_url: string): Promise<Pull> {
    const res = await request(API_PREFIX + api_url);

    if(res.statusCode >= 300)
        throw new Error(`request failed: ${inspect(res.body)} `);

    const pull = {
        api_url,
        data: res.body,
        timestamp: new Date(),
    };

    await new PullDao(db).save(pull);

    return pull;
}
