import * as _ from 'lodash';

import * as pMap from 'p-map';

import { DaoConfig, IndexDriver } from '../';
import { BulkCategory, Category, CategoryDao } from '../categories';
import { correct_leaderboard_run_places, Leaderboard, LeaderboardDao } from '../leaderboards';
import { BulkLevel } from '../levels';
import { UserDao } from '../users';
import { LeaderboardRunEntry, NewRecord, Run, RunDao } from './';

import { Variable } from '../../speedrun-api';

function get_leaderboard_id_for_run(run: Run) {

    if (!run.category || !(run.category as BulkCategory).id) {
        return;
    }

    return (run.category as BulkCategory).id +
        (run.level ? '_' + (run.level as BulkLevel).id : '');
}

function generate_run_obsolete_filter(categories: {[key: string]: Category|null}, run: LeaderboardRunEntry) {
    const filter: any = {
        'run.game.id': run.run.game.id,
        'run.category.id': run.run.category.id,
        "$or": [
            {'run.date': {$lt: run.run.date}},
            {'run.date': run.run.date, 'run.times.primary_t': {$gt: run.run.times.primary_t} },
            {'run.date': null},
        ],
    };

    if (run.run.level && run.run.level.id) {
        filter['run.level.id'] = run.run.level.id;
    }

    // matching players
    filter['run.players'] = {$size: run.run.players.length};
    run.run.players.forEach((player, i) => {
        if (player.id) {
            filter[`run.players.${i}.id`] = player.id;
        }
        else if (player.name) {
            filter[`run.players.${i}.name`] = player.name;
        }
        else {
            // TODO: this is hacky
            filter[`unused_dummy`] = 'foobar';
        }
    });

    // return early if we dont have a category with variables to pull
    if (!categories[run.run.category.id]) {
        return filter;
    }

    const subcategory_var_ids = _.chain(categories[run.run.category.id]!.variables)
        .filter('is-subcategory')
        .map('id')
        .value();

    // matching subcategories
    for (const id of subcategory_var_ids) {
        if (run.run.values[id]) {
            filter[`run.values.${id}`] = run.run.values[id];
        }
    }

    // we check if its false here because the behavior of `obsoletes` appears to be as follows:
    // if false, only mark as obsolete if the subcategory variable remains the same
    // if true, always mark as obsolete regardless of filter value (aka no filter needed)
    const obsoletes_var_ids = _.chain(categories[run.run.category.id]!.variables)
        .reject('obsoletes')
        .map('id')
        .value();

    // matching "obsoletes" var ids
    for (const id of obsoletes_var_ids) {
        if (run.run.values[id]) {
            filter[`run.values.${id}`] = run.run.values[id];
        }
    }

    return filter;
}

export class SupportingStructuresIndex implements IndexDriver<LeaderboardRunEntry> {
    public name: string;

    public new_records: NewRecord[];

    constructor(name: string) {
        this.name = name;

        this.new_records = [];
    }

    public async update_leaderboard(conf: DaoConfig<LeaderboardRunEntry>, runs: LeaderboardRunEntry[], categories: {[key: string]: Category|null}) {
        const leaderboard_ids = _.map(runs, (run) => get_leaderboard_id_for_run(run.run as Run)) as string[];

        const leaderboard_ids_deduped = _.uniq(leaderboard_ids);

        let leaderboards: {[id: string]: Leaderboard} = {};
        if (leaderboard_ids_deduped.length) {
            leaderboards = (_.zipObject(leaderboard_ids_deduped,
                await new LeaderboardDao(conf.db).load(leaderboard_ids_deduped)) as {[id: string]: Leaderboard});
        }

        for (const leaderboard_id in leaderboards) {

            if (!leaderboards[leaderboard_id]) {
                // new leaderboard
                const category_id = leaderboard_id.split('_')[0];
                const level_id = leaderboard_id.split('_')[1];

                if (!categories[category_id]) {
                    continue;
                }

                leaderboards[leaderboard_id] = {
                	game: categories[category_id]!.game as string,
                    weblink: '',
                	category: category_id,
                    players: {},
                    runs: [],
                };

                if (level_id) {
                    leaderboards[leaderboard_id].level = level_id;
                }
            }

            const category = categories[leaderboards[leaderboard_id].category as string];
            if (!category) {
                continue;
            }

            leaderboards[leaderboard_id].runs = await (conf as RunDao).calculate_leaderboard_runs(leaderboards[leaderboard_id].game as string, leaderboards[leaderboard_id].category as string, leaderboards[leaderboard_id].level as string|undefined);

            correct_leaderboard_run_places(leaderboards[leaderboard_id], category.variables as Variable[]);
        }

        const clean_leaderboards = _.reject(_.values(leaderboards), _.isNil);

        if (clean_leaderboards.length) {
            await new LeaderboardDao(conf.db).save(clean_leaderboards);
        }
    }

    public async update_player_pbs(conf: DaoConfig<LeaderboardRunEntry>, runs: LeaderboardRunEntry[], _categories: {[key: string]: Category|null}) {
        this.new_records.push(...await new UserDao(conf.db).apply_runs(runs));
    }

    public async update_obsoletes(conf: DaoConfig<LeaderboardRunEntry>, runs: LeaderboardRunEntry[], categories: {[key: string]: Category|null}) {


        const usable_runs = runs.filter((v) => v.run.status.status === 'verified' &&
            v.run.category &&
            v.run.category.id &&
            v.run.submitted &&
            v.run.date);
        
        
        const run_filters = usable_runs.map(_.partial(generate_run_obsolete_filter, categories));

        // should this run (itself) be obsolete?
        const not_obsolete_filters: any[] = [];
        const not_obsolete: LeaderboardRunEntry[] = [];
        const to_obsolete: LeaderboardRunEntry[] = [];

        await pMap(usable_runs, async (r, i) => {
            if(r.obsolete) {
                // nothing to do
                return;
            }

            // see if there is a newer run
            const filter_mod = _.cloneDeep(run_filters[i]);

            // its the same filter except the date and time conditions are opposite
            filter_mod.$or = [
                {'run.date': {$gt: r.run.date}},
                {'run.date': r.run.date, 'run.times.primary_t': {$lt: r.run.times.primary_t} },
                {'run.date': null},
            ]

            // run must be verified in order to obsolete this run
            filter_mod['run.status.status'] = 'verified';

            const npb = await conf.db.mongo.collection(conf.collection).findOne(filter_mod);

            if(npb) {
                // this run should be obsoleted by another
                to_obsolete.push(r);
            }
            else {
                // this run should be obsoleting other runs
                not_obsolete.push(r);
                not_obsolete_filters.push(run_filters[i]);
            }
        }, {concurrency: 5});


        const filter: any = {
            // only runs with a category we have and which are verified can
            $or: not_obsolete_filters,
        };

        if (filter.$or.length) {
            await conf.db.mongo.collection(conf.collection).updateMany(filter, {
                $set: {
                    obsolete: true,
                },
            });
        }

        if(to_obsolete.length) {
            await conf.db.mongo.collection(conf.collection).updateMany({
                'run.id': { $in: _.map(to_obsolete, 'run.id') }
            }, {
                $set: { obsolete: true }
            });
        }

        return not_obsolete;
    }

    public async load(_conf: DaoConfig<LeaderboardRunEntry>, _keys: string[]): Promise<Array<LeaderboardRunEntry|null>> {
        throw new Error('cannot load data from supporting structures');
    }

    public async apply(conf: DaoConfig<LeaderboardRunEntry>, runs: LeaderboardRunEntry[]) {

        // obsolete runs do not get added to leaderboards and cannot create obsoletes themselves.
        runs = _.reject(runs, 'obsolete');

        const category_ids = _.uniq(_.map(runs, 'run.category.id')) as string[];
        let categories: {[id: string]: Category|null} = {};
        if (category_ids.length) {
            categories = _.zipObject(category_ids, await new CategoryDao(conf.db!).load(category_ids));
        }

        const not_obsolete_runs = await this.update_obsoletes(conf, runs, categories);

        if(not_obsolete_runs.length) {
            await Promise.all([
                this.update_leaderboard(conf, _.cloneDeep(not_obsolete_runs), categories),
                this.update_player_pbs(conf, _.cloneDeep(not_obsolete_runs), categories),
            ]);
        }
    }

    public async clear(conf: DaoConfig<LeaderboardRunEntry>, runs: LeaderboardRunEntry[]) {
        await this.apply(conf, runs);
    }

    public has_changed(_old_obj: LeaderboardRunEntry, _new_obj: LeaderboardRunEntry): boolean {
        return true; // !_.isEqual(old_obj, new_obj);
    }
}
