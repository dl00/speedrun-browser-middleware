import * as _ from 'lodash';

import { DaoConfig, IndexDriver } from '../';

import { Chart, ChartDao, LineChartData } from '../charts';

import { MetricDao } from '../metrics';

import { CategoryDao } from '../categories';

import { LeaderboardDao, Leaderboard } from '../leaderboards';

import { Variable } from '../../../lib/speedrun-api';

import { LeaderboardRunEntry, run_to_bulk } from './';

export class RecordChartIndex implements IndexDriver<LeaderboardRunEntry> {
    public name: string;

    constructor(name: string) {
        this.name = name;
    }

    public async make_chart(conf: DaoConfig<LeaderboardRunEntry>, category_id: string, level_id: string|null) {

        const leaderboard_id = category_id + (level_id ? '_' + level_id : '');

        const category = (await new CategoryDao(conf.db).load(category_id))[0];

        if (!category) {
            throw new Error('cannot generate chart: no category found for run!');
        }

        const subcategory_vars = _.map(
            _.filter(category.variables as Variable[], 'is-subcategory'),
            'id',
        );

        const chart: Chart = {
            item_id: leaderboard_id,
            parent_type: 'leaderboards',
            item_type: 'runs',
            chart_type: 'line',
            aggr: 'min',
            data: {},
            timestamp: new Date(),
        };

        const filter: any = {
            'run.category.id': category_id,
            'run.status.verify-date': {$exists: true},
            'run.status.status': 'verified',
        };

        if (level_id) {
            filter['run.level.id'] = level_id;
        }

        const cursor = await conf.db.mongo.collection(conf.collection)
            .find(filter)
            .sort({ 'run.date': 1 });

        while (await cursor.hasNext()) {
            const lbr = await cursor.next();

            let subcategory_id;
            if (!subcategory_vars.length) {
                subcategory_id = 'main';
            } else {
                subcategory_id = _.chain(lbr.run.values)
                    .pick(...subcategory_vars)
                    .toPairs()
                    .flatten()
                    .join('_')
                    .value();
            }

            const t = new Date(lbr.run.date).getTime() / 1000;

            if (isNaN(t) || !t) {
                continue;
            }

            const point: LineChartData = {
                x: t,
                y: lbr.run.times.primary_t,
                obj: run_to_bulk(_.cloneDeep(lbr.run)),
            };

            if (!chart.data[subcategory_id]) {
                chart.data[subcategory_id] = [point];
            } else if (point.y < (chart.data[subcategory_id][chart.data[subcategory_id].length - 1] as LineChartData).y) {
                chart.data[subcategory_id].push(point);
 }
        }

        await new ChartDao(conf.db).save(chart);
    }

    public async load(_conf: DaoConfig<LeaderboardRunEntry>, _keys: string[]): Promise<Array<LeaderboardRunEntry|null>> {
        throw new Error('cannot load runs from charts, use the chart directly');
    }

    public async apply(conf: DaoConfig<LeaderboardRunEntry>, objs: LeaderboardRunEntry[]) {
        // only need to update if the db contains to faster times earlier than this date in this category

        const chart_gens = [];
        const chart_ids_genned = new Set();

        for (const lbr of objs) {

            if (!lbr.run.category || !lbr.run.category.id) {
                continue;
            }

            const leaderboard_id = lbr.run.category.id + (lbr.run.level ? '_' + lbr.run.level.id : '');

            const filter: {[key: string]: any} = {
                'run.category.id': lbr.run.category.id,
                'run.date': {$lt: lbr.run.date},
                'run.times.primary_t': {$lt: lbr.run.times.primary_t},
                'run.status.verify-date': {$exists: true},
                'run.status.status': 'verified',
            };

            if (lbr.run.level && lbr.run.level.id) {
                filter['run.level.id'] = lbr.run.level.id;
            }

            const count: number = await conf.db.mongo.collection(conf.collection)
                .countDocuments(filter);

            if (!count && !chart_ids_genned.has(leaderboard_id)) {
                chart_gens.push(this.make_chart(conf, lbr.run.category.id, lbr.run.level ? lbr.run.level.id : null));
                chart_ids_genned.add(leaderboard_id);
            }
        }

        await Promise.all(chart_gens);
    }

    public async clear(conf: DaoConfig<LeaderboardRunEntry>, objs: LeaderboardRunEntry[]) {
        await this.apply(conf, objs);
    }

    public has_changed(old_obj: LeaderboardRunEntry, new_obj: LeaderboardRunEntry): boolean {
        return old_obj.run.date !== new_obj.run.date ||
            old_obj.run.times.primary_t !== new_obj.run.times.primary_t;
    }
}

// debug/helper function
export async function make_all_wr_charts(conf: DaoConfig<LeaderboardRunEntry>) {
    const leaderboard_dao = new LeaderboardDao(conf.db);

    const rci = new RecordChartIndex('');

    leaderboard_dao.scan({batchSize: 100}, async (lbs: Leaderboard[]) => {
        for(let lb of lbs) {
            console.log('CHART:', lb.game, lb.category, lb.level);

            if(lb.runs.length) {
                try {
                    await rci.make_chart(conf, lb.category, lb.level || null);
                } catch (err) {
                    // TODO: for right now just print and ignore
                    console.error(err);
                }
            }
        }
    });
}

export async function get_runs_total_time(conf: DaoConfig<LeaderboardRunEntry>) {
    let metric_dao = new MetricDao(conf.db);

    const total_run_time = (await conf.db.mongo.collection(conf.collection)
        .aggregate([{$group: {_id: null, time: {$sum: 'run.times.primary_t'}}}]).toArray())[0].time;

    await metric_dao.save({ id: 'runs_total_run_time', value: total_run_time});
}

export async function get_player_pb_chart(conf: DaoConfig<LeaderboardRunEntry>, player_id: string, game_id: string) {

    const chart: Chart = {
        item_id: `${player_id}_${game_id}`,
        item_type: 'runs',
        chart_type: 'line',
        aggr: 'min',
        data: {},
        timestamp: new Date(),
    };

    const filter: any = {
        'run.players.id': player_id,
        'run.game.id': game_id,
    };

    const chart_data = await conf.db.mongo.collection(conf.collection)
        .aggregate([
            {
                $match: filter,
            },
            {
                $group: {
                    _id: {category: '$run.category.id', level: '$run.level.id'},
                    data: { $push:
                        {
                            x: '$run.date',
                            y: '$run.times.primary_t',
                            obj: '$run',
                        },
                    },
                },
            },
        ]).toArray();

    chart.data = _.chain(chart_data)
        .keyBy((v) => v._id.category + (v._id.level ? '_' + v._id.level : ''))
        .mapValues((v) => {
            return v.data.map((p: LineChartData) => {
                return {
                    x: p.x,
                    y: p.y,
                    obj: run_to_bulk(p.obj),
                };
            });
        })
        .value();

    return chart;
}
