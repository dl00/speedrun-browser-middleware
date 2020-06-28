import * as _ from 'lodash';

import { Dao } from '../';

import { BulkGame, Game, game_to_bulk, GameDao } from '../games';

import { Chart, BarChartData } from '../charts';
import { Metric } from '../metrics';
import { get_player_pb_chart, RecordChartIndex } from './charts';
import { SupportingStructuresIndex } from './supporting-structures';
import { LeaderboardRunEntry, Run, BulkRun, NewRecord } from './structures';
export { LeaderboardRunEntry, Run, BulkRun, NewRecord } from './structures';
import { RecentRunsIndex } from './recent-runs'

import { DB } from '../../db';

import {
    normalize,
    Variable,
} from '../../speedrun-api';

import { BulkCategory, Category, category_to_bulk, CategoryDao } from '../categories';
import { BulkLevel, Level, level_to_bulk, LevelDao } from '../levels';
import { BulkUser, User, user_to_bulk } from '../users';
import { UserDao } from '../users';

export function normalize_run(d: Run) {
    normalize(d);

    if (d.players) {
        d.players = d.players.map(user_to_bulk as any);
    }

    if (_.isObject(d.game)) {
        d.game = game_to_bulk(d.game as Game);
    }
    if (_.isObject(d.category)) {
        d.category = category_to_bulk(d.category as Category);
    }
    if (_.isObject(d.level)) {
        if (!_.keys(d.level).length) {
            delete d.level;
        }
        else {
            d.level = level_to_bulk(d.level as Level);
        }
    }
}

/// TODO: Use decorators
export function run_to_bulk(run: Run): BulkRun {
    const newr = _.pick(run, 'id', 'date', 'submitted', 'players', 'times', 'system', 'values');
    return newr;
}

function generate_month_boundaries(start: number, end: number) {
    // todo: pre-allocate array?
    const boundaries = [];

    for (let i = start; i < end; i++) {
        for (let j = 1; j <= 12; j++) {
            boundaries.push(`${i}-${_.padStart(j.toString(), 2, '0')}`);
        }
    }

    return boundaries;
}

export interface PopulateRunResponse {
    drop_runs: Run[];
    games: {[id: string]: Game|null};
    categories: {[id: string]: Category|null};
    levels: {[id: string]: Level|null};
}

// returns a list of runs which cannot be processed because the game is missing, or similar
export async function populate_run_sub_documents(db: DB, runs: Run[]): Promise<PopulateRunResponse> {
    const game_ids = _.uniq(_.map(runs, 'game.id')) as string[];
    const category_ids = _.uniq(_.map(runs, 'category.id')) as string[];
    const level_ids = _.uniq(_.map(runs, 'level.id')) as string[];

    const player_ids = _.uniq(_.flatten(_.map(runs, (run) => {
        return _.reject(_.map(run.players, 'id'), _.isNil);
    }))) as string[];

    let games: {[id: string]: Game|null} = {};
    if (game_ids.length) {
        games = _.zipObject(game_ids, await new GameDao(db).load(game_ids));
    }
    let categories: {[id: string]: Category|null} = {};
    if (category_ids.length) {
        categories = _.zipObject(category_ids, await new CategoryDao(db).load(category_ids));
    }
    let levels: {[id: string]: Level|null} = {};
    if (level_ids.length) {
        levels = _.zipObject(level_ids, await new LevelDao(db).load(level_ids));
    }
    let players: {[id: string]: User|null} = {};
    if (player_ids.length) {
        players = _.zipObject(player_ids, await new UserDao(db).load(player_ids, {skipComputed: true}));
    }

    // list of runs we are skipping processing
    const drop_runs: Run[] = [];

    for (const run of runs) {
        if (!run.game || !run.category ||
            !games[(run.game as BulkGame).id] || !categories[(run.category as BulkCategory).id]) {
            drop_runs.push(run);
            continue;
        }

        run.game = (games[(run.game as BulkGame).id] as BulkGame);
        run.category = (categories[(run.category as BulkCategory).id] as Category);

        if (run.level && (run.level as BulkLevel).id) {
            run.level = (levels[(run.level as BulkLevel).id] as Level|null);
        }

        // handle special cases for users
        for (let i = 0; i < run.players.length; i++) {
            if (!run.players[i].id) {
                continue;
            }
            if (!players[run.players[i].id]) {
                // new player
                // currently the best way to solve this is to do a game resync
                drop_runs.push(run);
                continue;
            }

            run.players[i] = (players[run.players[i].id] as BulkUser);
        }
    }

    return {
        drop_runs,
        games,
        categories,
        levels,
    };
}

export const LATEST_VERIFIED_RUNS_KEY = 'verified_runs';
export const LATEST_NEW_RUNS_KEY = 'latest_new_runs';

export interface RunDaoOptions {
    latest_runs_history_length?: number;
    max_items?: number;
}

export class RunDao extends Dao<LeaderboardRunEntry> {
    constructor(db: DB, config?: RunDaoOptions) {
        super(db, 'runs', 'mongo');

        this.id_key = _.property('run.id');

        this.massage_sort = {
            'run.game.id': 1,
            'run.date': 1,
        };

        // TODO: these mongodb indexes are just hardcoded in here for now...
        // at least this first index for mongodb is overkill, its just used for an aggregation
        db.mongo.collection(this.collection).createIndex({
            'run.date': 1,
        }, {
            background: true,
            partialFilterExpression: {'run.status.status': 'verified'},
        }).then(_.noop, console.error);

        db.mongo.collection(this.collection).createIndex({
            'run.submitted': 1,
        }, {
            background: true
        }).then(_.noop, console.error);

        db.mongo.collection(this.collection).createIndex({
            'run.game.id': 1,
            'run.date': 1,
        }, {
            background: true,
        }).then(_.noop, console.error);

        db.mongo.collection(this.collection).createIndex({
            'run.category.id': 1,
            'run.level.id': 1,
            'run.date': 1,
        }, {
            background: true,
        }).then(_.noop, console.error);

        db.mongo.collection(this.collection).createIndex({
            'run.players.id': 1,
            'run.game.id': 1,
            'run.category.id': 1,
            'run.level.id': 1,
            'run.date': 1,
        }, {
            background: true,
        }).then(_.noop, console.error);

        // used to calculate leaderboards
        db.mongo.collection(this.collection).createIndex({
            'run.game.id': 1,
            'run.category.id': 1,
            'run.level.id': 1,
            'run.times.primary_t': 1,
            'run.date': 1,
            'run.players.id': 1,
        }, {
            background: true,
            partialFilterExpression: {
                'run.status.status': 'verified',
                'obsolete': false,
            },
        }).then(_.noop, console.error);

        // used to separate game groups
        db.mongo.collection(this.collection).createIndex({
            'gameGroups': 1,
            'run.date': 1
        }).then(_.noop, console.error);

        this.computed = {
            place: async (lbr: LeaderboardRunEntry) => {

                if (lbr.obsolete || !lbr.run || !lbr.run.game || !lbr.run.game.id || !lbr.run.category || !lbr.run.category.id) {
                    return null;
                }

                const filter: any = {
                    'run.game.id': lbr.run.game.id,
                    'run.category.id': lbr.run.category.id,
                    'run.times.primary_t': {$lte: lbr.run.times.primary_t},
                    'obsolete': false,
                    'run.status.status': 'verified',
                };

                if (lbr.run.level && lbr.run.level.id) {
                    filter['run.level.id'] = lbr.run.level.id;
                }

                const category = (await new CategoryDao(this.db).load(lbr.run.category.id))[0];
                if (category) {
                    const subcategory_vars = _.filter(category!.variables, 'is-subcategory') as Variable[];

                    for (const sv of subcategory_vars) {
                        filter[`run.values.${sv.id}`] = lbr.run.values[sv.id];
                    }
                }

                const r = await db.mongo.collection(this.collection).aggregate([
                    {$match: filter},
                    {$group: {_id: {id: '$run.players.id', name: '$run.players.name'}}},
                    {$count: 'count'},
                ]).toArray();

                return r.length ? r[0].count : null;
            },
        };

        this.indexes = [
            new RecentRunsIndex('latest_new_runs', 'submitted', LATEST_NEW_RUNS_KEY,
                config && config.latest_runs_history_length ? config.latest_runs_history_length : 1000,
                config && config.max_items ? config.max_items : 100,
            ),
            new RecentRunsIndex('latest_verified_runs', 'status.verify-date', LATEST_VERIFIED_RUNS_KEY,
                config && config.latest_runs_history_length ? config.latest_runs_history_length : 1000,
                config && config.max_items ? config.max_items : 100,
            ),
            new SupportingStructuresIndex('supporting_structures'),
            new RecordChartIndex('chart_wrs'),
        ];
    }

    // not used in prod: see leaderboards instaed.
    public async calculate_leaderboard_runs(game_id: string, category_id: string, level_id?: string): Promise<LeaderboardRunEntry[]> {

        const filter: any = {
            'run.game.id': game_id,
            'run.category.id': category_id,
            'obsolete': false,
            'run.status.status': 'verified',
        };

        if (level_id) {
            filter['run.level.id'] = level_id;
        }

        return await this.db.mongo.collection(this.collection).find(filter, {
            projection: {
                '_id': 0,
                'run.id': 1,
                'run.date': 1,
                'run.players': 1,
                'run.times': 1,
                'run.system': 1,
                'run.values': 1,
            },
        })
        .sort({
            'run.times.primary_t': 1,
            'run.date': 1,
        })
        .toArray();
    }

    /// return new records saved to DB during the lifetime of this Dao instance
    public collect_new_records(): NewRecord[] {
        return (this.indexes.find((ind) => ind.name === 'supporting_structures') as SupportingStructuresIndex).new_records;
    }

    public async load_latest_runs(offset?: number, ggId?: string, verified: boolean = true) {
        const key = `${ggId || ''}:${offset || 0}`;
        return await this.load_by_index(verified ? 'latest_verified_runs' : 'latest_new_runs', key);
    }

    // used to compare elements seen on local vs. src to delete extra runs
    public async load_submitted_segment_ids(start: string, end: string): Promise<string[]> {
        return _.map(await this.db.mongo.collection(this.collection).find({
            'run.submitted': {
                $gt: start,
                $lt: end
            }
        }, { projection: {_id: true}}).toArray(), '_id')
    }

    public async get_player_count(filter: any) {

        let res = await this.db.mongo.collection(this.collection).aggregate([
            {$match: filter},
            {$group: { _id: '$run.players.id'}},
            {$count: 'total_players'}
        ]).toArray();

        return res.length ? res[0].total_players : 0;
    }

    public async get_historical_run_count(filter: any): Promise<BarChartData[]> {
        const month_bounaries: string[] = generate_month_boundaries(2010, new Date().getUTCFullYear() + 1);

        const data = (await this.db.mongo.collection(this.collection).aggregate([
            {
                $match: filter,
            },
            {
                $facet: _.chain(month_bounaries)
                        .map((v) => {
                            return [v, [{$match: {'run.date': {$lt: v}}}, {$count: 'y'}]];
                        })
                        .fromPairs()
                        .value(),
            },
        ]).toArray())[0];

        const now = new Date();
        const beginningOfMonth = (Date.UTC(now.getFullYear(), now.getDay()) - 86400000) / 1000;

        return _.chain(data)
            .mapValues((v, k) => {
                return {
                    x: new Date(k).getTime() / 1000,
                    y: v.length ? v[0].y : 0,
                };
            })
            .values()
            .filter((p) => p.x < beginningOfMonth)
            .value();
    }

    public async get_group_submission_volume(gg_id?: string|null): Promise<Chart> {

        let filter: any = { 'run.status.status': 'verified' };

        if(gg_id)
            filter.gameGroups = gg_id;

        return {
            item_id: gg_id || 'site',
            item_type: 'runs',
            parent_type: 'game-groups',
            aggr: 'volume',
            chart_type: 'bar',
            data: {
                main: await this.get_submission_volume(filter),
            },
            timestamp: new Date(),
        };
    }

    public async get_leaderboard_submission_volume(category_id: string, level_id: string|null): Promise<Chart> {
        const filter: any = {
            'run.category.id': category_id,
            'run.status.status': 'verified',
        };

        if (level_id) {
            filter['run.level.id'] = level_id;
        }

        return {
            item_id: category_id + (level_id ? '_' + level_id : ''),
            item_type: 'runs',
            parent_type: 'leaderboards',
            aggr: 'volume',
            chart_type: 'bar',
            data: {
                main: await this.get_submission_volume(filter),
            },
            timestamp: new Date(),
        };
    }

    public async get_game_submission_volume(game_id: string): Promise<Chart> {
        return {
            item_id: game_id,
            item_type: 'runs',
            parent_type: 'games',
            aggr: 'volume',
            chart_type: 'bar',
            data: {
                main: await this.get_submission_volume({
                    'run.game.id': game_id,
                    'run.status.status': 'verified',
                }),
            },
            timestamp: new Date(),
        };
    }

    public async get_player_submission_volume(player_id: string): Promise<Chart> {
        return {
            item_id: player_id,
            item_type: 'runs',
            parent_type: 'users',
            aggr: 'volume',
            chart_type: 'bar',
            data: {
                main: await this.get_submission_volume({
                    'run.players.id': player_id,
                    'run.status.status': 'verified',
                }),
            },
            timestamp: new Date(),
        };
    }

    private async get_submission_volume(filter: any) {
        const month_bounaries: string[] = generate_month_boundaries(2010, new Date().getUTCFullYear() + 1);

        const d = (await this.db.mongo.collection(this.collection).aggregate([
            {
                $match: filter,
            },
            {
                $bucket: {
                    groupBy: '$run.date',
                    boundaries: month_bounaries,
                    default: '1970-01',
                    output: {
                        count: {$sum: 1},
                    },
                },
            },
        ]).toArray()).map((v) => {
            return {
                x: new Date(v._id).getTime() / 1000,
                y: v.count,
            };
        });

        // remove unknown entries
        if (d.length && d[0].x === 0) {
            d.splice(0, 1);
        }

        if (!d.length) {
            return d;
        }

        // fill in skipped boundaries
        let bound_cur = _.findIndex(month_bounaries, (v) => d[0].x == new Date(v + '-01').getTime() / 1000);
        for (let i = 1; i < d.length; i++) {
            const to_add = [];
            while (d[i].x != new Date(month_bounaries[++bound_cur] + '-01').getTime() / 1000) {
                to_add.push({ x: new Date(month_bounaries[bound_cur] + '-01').getTime() / 1000, y: 0});
            }

            if (to_add.length) {
                d.splice(i, 0, ...to_add);
                i += to_add.length;
            }
        }

        // remove current month, if any
        if (new Date(d[d.length - 1].x).getUTCMonth() == new Date().getUTCMonth() &&
            new Date(d[d.length - 1].x).getUTCFullYear() == new Date().getUTCFullYear()) {
            d.splice(d.length - 1, 1);
        }

        return d;
    }

    public async get_player_favorite_runs(player_id: string): Promise<Chart> {
        const chart_data = await this.db.mongo.collection(this.collection).aggregate([
            {
                $match: {
                    'run.players.id': player_id,
                },
            },
            {
                $group: {
                    _id: '$run.game.id',
                    count: {$sum: 1},
                    game: {$mergeObjects: '$run.game'},
                },
            },
            {
                $sort: {
                    count: -1,
                },
            },
        ]).toArray();

        return {
            item_id: player_id,
            item_type: 'runs',
            parent_type: 'games',
            aggr: 'sum_over_games',
            chart_type: 'pie',
            data: {
                main: _.chain(chart_data)
                .map((p) => {
                    return {
                        x: 0,
                        y: p.count,
                        obj: p.game,
                    };
                })
                .value(),
            },
            timestamp: new Date(),
        };
    }

    public async get_player_pb_chart(player_id: string, game_id: string) {
        return await get_player_pb_chart(this, player_id, game_id);
    }

    public async get_basic_metrics(opts: {game_id?: string|null, player_id?: string|null, gg_id?: string|null}): Promise<{[id: string]: Metric}> {

        let filter: any = {};

        if(opts.gg_id && opts.gg_id != 'site')
            filter['gameGroups'] = opts.gg_id;
        if(opts.game_id)
            filter['run.game.id'] = opts.game_id;

        if(opts.player_id)
            filter['run.players.id'] = opts.player_id;

        let metrics: {[id: string]: Metric} = {};

        if(opts.game_id || opts.player_id) {
            let totalRunTimeAggr = (await this.db.mongo.collection(this.collection).aggregate([
                    {$match: filter},
                    {$group: { _id: null, time: {$sum: '$run.times.primary_t'}}}
                ]).toArray())[0];

            if(totalRunTimeAggr)
                metrics.total_run_time = { value: totalRunTimeAggr.time };

            metrics.level_run_count = {
                value: <any>await this.db.mongo.collection(this.collection)
                    .countDocuments({ ...filter, 'run.category.type': 'per-level' })
            };

            metrics.full_game_run_count = {
                value: <any>await this.db.mongo.collection(this.collection)
                    .countDocuments({ ...filter, 'run.category.type': {$ne: 'per-level' }})
            };

            metrics.total_run_count = {
                value: metrics.level_run_count.value + metrics.full_game_run_count.value
            };
        }
        else if(!_.keys(filter).length) {
            metrics.total_run_count = {
                value: <any>await this.db.mongo.collection(this.collection).estimatedDocumentCount()
            };
        }

        if(!opts.player_id) {
            if(!_.keys(filter).length) {
                metrics.total_players = { value: await new UserDao(this.db).count() };
            }
            else {
                metrics.total_players = {
                    value: await this.get_player_count(filter)
                };
            }
        }

        return metrics;
    }

    public async massage_hook(runs: LeaderboardRunEntry[]) {
        await populate_run_sub_documents(this.db, _.map(runs, 'run') as Run[]);
    }

    protected async pre_store_transform(run: LeaderboardRunEntry, old_obj: LeaderboardRunEntry|null): Promise<LeaderboardRunEntry> {
        normalize_run(run.run as Run);
        delete run.place;

        if(!run.obsolete)
            run.obsolete = old_obj && old_obj.obsolete ? old_obj.obsolete : false;

        run.gameGroups = _.chain(
            ['platforms', 'genres', 'publishers', 'developers'].map(v => run.run.game[v])
        )
            .flatten()
            .map('id')
            .uniq()
            .value();
        
        run.updatedAt = Date.now();

        return run;
    }
}
