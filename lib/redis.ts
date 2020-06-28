import * as fs from 'fs';
import * as path from 'path';

import * as IORedis from 'ioredis';

/// Adds redis lua commands defined in the `redis/` of this middleware to the given redis instance.
export function defineCommands(rdb: IORedis.Redis) {

    try {
        for (const file of fs.readdirSync('./redis')) {
            const cmdname = file.split('.')[0];

            rdb.defineCommand(cmdname, {
                lua: fs.readFileSync(path.join('./redis', file)).toString('utf8'),
            });
        }
    } catch (err) {
        console.log('No redis scripts were loaded');
    }
}
