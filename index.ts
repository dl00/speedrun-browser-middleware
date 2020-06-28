import * as _ from 'lodash';

import { load_config } from './lib/config';

import * as api from './api';
import { Sched } from './sched';

import * as cluster from 'cluster';
import { make_generators, make_tasks } from './jobs';
import { load_db } from './lib/db';

const OVERRIDE_SCHED_CONFIG = {
    resources: {
        src: {
            name: 'src',
            rateLimit: 1000
        },

        twitch: {
            name: 'twitch',
            rateLimit: 100
        },

        local: {
            name: 'local',
            rateLimit: 10
        }
    },

    generators: make_generators(),

    tasks: make_tasks()
}

export async function start_sched(config: any) {
    const sched = new Sched(_.merge(OVERRIDE_SCHED_CONFIG, config.sched), await load_db(config.db));

    await sched.init();

    if (!await sched.has_job('init_games')) {
        console.log('has job push job')
        // add required initialization job (will block other jobs)
        await sched.push_job({
            name: 'init_games',
            resources: ['src', 'local'],
            generator: 'generate_games',
            task: 'apply_games',
            args: [],
            blockedBy: [],
            timeout: 90000
        });
    }

    console.log('execute scheduler');
    await sched.exec();
}

export async function start_server(config: any) {
    await api.run(config);
}

export async function run() {
    const config = load_config();

    if (cluster.isMaster) {
        cluster.fork({ROLE: 'scraper'});
        cluster.fork({ROLE: 'web'});
    } else if (process.env.ROLE == 'scraper') {
        await start_sched(config);
    } else if (process.env.ROLE == 'web') {
        await start_server(config);
    }
}

if (require.main == module) {
    run().then(() => {
        console.log('Startup completed');
    }, console.error);
}
