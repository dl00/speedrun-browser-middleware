import * as fs from 'fs';
import * as path from 'path';

import * as _ from 'lodash';

import { SchedConfig } from '../sched';
import { DBConfig } from './db';

export interface Config {

    stackName: string;

    listen: {
        /// Hostname to accept connections from. Use 0.0.0.0 for all interfaces.
        host: string

        /// Port for the API to accept connections from
        port: number,
    };

    api: {
        /// Maximum number of individual elements to return in a single request
        maxItems: number

        /// Maximum number of characters which may be used to search for an autocomplete result
        maxSearchLength: number,
    };

    /// credentails used for connecting to the twitch api
    twitch?: {
        /// token of the credentials used for connecting to the twitch api
        token: string;

        /// secret of the credentials used for connecting to the twitch api
        secret: string;
    }

    /// Configure the DB connection
    db: DBConfig;

    sched: SchedConfig;

    /// Configure push notifications
    pushNotify: {
        /// Whether or not to send out push notifications
        enabled: boolean,

        /// Authentication JSON file as provided by firebase
        credentialFile: string,

    }
}

export const DEFAULT_CONFIG: Config = {

    stackName: 'dev',

    listen: {
        host: '0.0.0.0',
        port: 3500,
    },

    api: {
        maxItems: 40,
        maxSearchLength: 50,
    },

    db: {
        redis: {},
        mongo: {
            uri: 'mongodb://localhost:27017',
            dbName: 'srbrowser',
        },
        indexers: {
            games: {
                config: {
                    depth: 3,
                    spread: 0,
                    scoreLength: 6,
                },
        
                redis: {
                    db: 2,
                }
            },
            players: {
                config: {
                    depth: 3,
                    spread: 0,
                    scoreLength: 6,
                },
        
                redis: {
                    db: 2,
                }
            },
            game_groups: {
                config: {
                    depth: 3,
                    spread: 0,
                    scoreLength: 6,
                },
        
                redis: {
                    db: 2,
                }
            }
        }
    },

    sched: {
        db: {
            redis: {
                db: 1
            },
            mongo: {
                uri: 'mongodb://localhost:27017',
                dbName: 'srbrowser',
            },
            indexers: {}
        },

        /** configuration for the webserver which is used for health and metrics */
        server: {
            host: '0.0.0.0',
            port: 3501,
        },

        resources: {
            src: {
                name: 'src',
                rateLimit: 1000
            },
            twitch: {
                name: 'twitch',
                rateLimit: 75
            },
            local: {
                name: 'local',
                rateLimit: 0
            }
        },

        generators: {},
        tasks: {},

        jobs: {
            'games': {
                interval: 3 * 24 * 60 * 60 * 1000,
                job: {
                    name: 'games',
                    resources: ['src', 'local'],
                    generator: 'generate_games',
                    task: 'apply_games',
                    args: [],
                    blockedBy: ['init_games'],
                    timeout: 90000
                }
            },
            'runs': {
                interval: 14 * 7 * 60 * 60 * 1000,
                job: {
                    name: 'runs',
                    resources: ['src', 'local'],
                    generator: 'generate_all_runs',
                    task: 'apply_runs',
                    args: ['deletes'],
                    blockedBy: ['init_games', 'h'],
                    timeout: 90000
                }
            },
            'latest_runs': {
                interval: 60 * 1000,
                job: {
                    name: 'latest_runs',
                    resources: ['src', 'local'],
                    generator: 'generate_latest_runs',
                    task: 'apply_runs',
                    args: [],
                    blockedBy: ['init_games'],
                    timeout: 60000
                }
            },
            'verified_runs': {
                interval: 60 * 1000,
                job: {
                    name: 'verified_runs',
                    resources: ['src', 'local'],
                    generator: 'generate_latest_runs',
                    task: 'apply_runs',
                    args: ['verified'],
                    blockedBy: ['init_games'],
                    timeout: 60000
                }
            },
            'charts_game_groups': {
                interval: 24 * 60 * 60 * 1000,
                job: {
                    name: 'charts_game_groups',
                    resources: ['local'],
                    generator: 'generate_game_group_charts',
                    task: 'apply_game_group_charts',
                    args: [],
                    blockedBy: ['init_games'],
                    timeout: 2 * 60 * 60 * 1000 // charts can sometimes take a very long time to generate
                }
            },
            'twitch_games': {
                interval: 24 * 60 * 60 * 1000,
                job: {
                    name: 'twitch_games',
                    resources: ['twitch', 'local'],
                    generator: 'generate_twitch_games',
                    task: 'apply_twitch_games',
                    args: [],
                    blockedBy: ['init_games'],
                    timeout: 20000
                }
            },
            'twitch_streams': {
                interval: 10 * 60 * 1000,
                job: {
                    name: 'twitch_streams',
                    resources: ['twitch', 'local'],
                    generator: 'generate_all_twitch_streams',
                    task: 'apply_twitch_streams',
                    args: [],
                    blockedBy: ['init_games'],
                    timeout: 20000
                }
            },
            'twitch_active_streams': {
                interval: 60 * 1000,
                job: {
                    name: 'twitch_active_streams',
                    resources: ['twitch', 'local'],
                    generator: 'generate_running_twitch_streams',
                    task: 'apply_twitch_streams',
                    args: [],
                    blockedBy: ['init_games'],
                    timeout: 20000
                }
            }
        }
    },
    
    pushNotify: {
        enabled: false,
        credentialFile: '/speedrunbrowser-middleware/secrets/firebase-service-account.json',
    },

};

/// A list of places to look for configuration files. Later configurations override prior configs.
const CONFIG_LOCATIONS: Array<string|null> = [
    '/speedrunbrowser-middleware/config/config.json',
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), '../config.json'),
    process.env.CONFIG_FILE || null,
];

export let config = DEFAULT_CONFIG;

export let load_config = _.memoize(() => {
    let config = DEFAULT_CONFIG;

    for (const loc of CONFIG_LOCATIONS) {

        if (loc == null) {
            continue;
        }

        if (fs.existsSync(loc)) {
            try {
                config = _.merge(config, require(loc));
                console.log('Loaded configuration:', loc);
            } catch (err) {
                // TODO: Might want to make sure this is actually "file not found"
            }
        }
    }

    return config;
});
