import * as _ from 'lodash';

import { populate_run_sub_documents, Run, RunDao } from '../lib/dao/runs';
import { RunTimes, RunSystem, LeaderboardRunEntry } from '../lib/dao/runs/structures';
import { UserDao, User } from '../lib/dao/users';

import * as puller from '../lib/puller';

import * as push_notify from '../lib/push-notify';

import { CursorData, Sched } from '../sched/index';

const RUN_BATCH_COUNT = 200;
const RUN_LATEST_COUNT = 25;

import Debug from 'debug';
const debug = Debug('jobs:all-runs');

export interface SRCRun {

    id: string;

    weblink: string;

    game: string;
    category: string;
    level?: string|null;

    date: string;
    times: RunTimes;
    system: RunSystem;
    values: {[key: string]: string};

    players: { data: User[] }

    [key: string]: any;
}

export async function generate_all_runs(sched: Sched, cur: CursorData<SRCRun>|null): Promise<CursorData<SRCRun>|null> {
    const res = await puller.do_pull(sched.storedb, `/runs?embed=players&max=200&orderby=submitted&direction=desc&offset=${cur?.pos || 0}`);

    const nextPos = cur ? parseInt(cur.pos!) : RUN_BATCH_COUNT;

    return {
        items: res.data.data,
        asOf: Date.now(),
        desc: `runs ${nextPos}..${nextPos + RUN_BATCH_COUNT}`,
        done: (cur?.done || 0) + res.data.data.length,
        total: 0,
        pos: res.data.pagination.max == res.data.pagination.size ? (nextPos + RUN_BATCH_COUNT).toString() : null
    };
}

export async function generate_latest_runs(sched: Sched, cur: CursorData<SRCRun>|null, args: string[]): Promise<CursorData<SRCRun>|null> {

    const latest_run_redis_property: 'latest_run_verify_date'|'latest_run_new_date' = args.length && args[0] == 'verified' ? 
        'latest_run_verify_date' : 
        'latest_run_new_date';

    const run_date_property: 'status.verify-date'|'submitted' = args.length && args[0] == 'verified' ?
        'status.verify-date' : 
        'submitted';

    const search_string = args.length && args[0] == 'verified' ? 
        `/runs?embed=players&max=${RUN_LATEST_COUNT}&orderby=verify-date&status=verified&direction=desc&offset=${cur?.pos || 0}` :
        `/runs?embed=players&max=${RUN_LATEST_COUNT}&orderby=submitted&direction=desc&offset=${cur?.pos || 0}`;

    const res = await puller.do_pull(sched.storedb, search_string);

    const nextPos = cur ? parseInt(cur.pos!) : RUN_BATCH_COUNT;

    // only keep going if the run dates are such that we have enough
    const latest_run_date: string|null = await sched.storedb!.redis.get(latest_run_redis_property);

    const cur_run_date = _.get(_.last(res.data.data), run_date_property);

    const needs_continue = 
        res.data.pagination.max == res.data.pagination.size && latest_run_date && latest_run_date <= cur_run_date;
    
    debug(`continuation: db ${latest_run_date} <= site ${cur_run_date}: ${needs_continue ? 'continue' : 'stop'}`);

    // continuation pointer management
    if(!cur?.pos) {
        const new_latest_run_date = _.get(res.data.data[0], run_date_property);
        await sched.storedb!.redis.set(latest_run_redis_property + ':pending', new_latest_run_date);
    }

    if(!needs_continue) {
        await sched.storedb!.redis.rename(latest_run_redis_property + ':pending', latest_run_redis_property);
    }

    return {
        items: res.data.data,
        asOf: Date.now(),
        desc: `runs ${nextPos}..${nextPos + RUN_BATCH_COUNT}`,
        done: (cur?.done || 0) + res.data.data.length,
        total: 0,
        pos: needs_continue ? 
            (nextPos + RUN_LATEST_COUNT).toString() : null
    };
}

// for pulling a single run which we previously lacked the resources to do
export async function generate_single_run(sched: Sched, _cur: CursorData<SRCRun>|null, args: string[]): Promise<CursorData<SRCRun>|null> {

    const res = await puller.do_pull(sched.storedb, `/runs/${args[0]}`);

    return {
        items: [res.data],
        asOf: Date.now(),
        desc: `single run ${args[0]}`,
        done: 1,
        total: 1,
        pos: null
    };
}

export async function apply_runs(sched: Sched, cur: CursorData<SRCRun>, args: string[]) {

    const runs: Run[] = cur.items.map((run: any) => {
        run.game = {id: run.game};
        run.category = {id: run.category};

        if (run.level) {
            run.level = {id: run.level};
        }

        run.players = run.players.data;

        return run;
    });

    // handle player obj updates before anything else
    //console.log(runs);
    const updatedPlayers = _.chain(runs)
        .map('players')
        .flatten()
        .filter('id')
        .value();

    const user_dao = new UserDao(sched.storedb!);
    const users = await user_dao.load(_.map(updatedPlayers, 'id'), {skipComputed: true});
    await user_dao.save(users.map((v, i) => _.merge(v, updatedPlayers[i] as any)));

    const pr = await populate_run_sub_documents(sched.storedb!, runs);

    if (pr.drop_runs.length) {

        // TODO: schedule a job to pull in the game and category that this run depends on, and then pull this game again

        _.remove(runs, (r) => _.find(pr.drop_runs, (dr) => dr.id === r.id));
    }

    if (runs.length) {

        const run_dao = new RunDao(sched.storedb!);

        if(args.indexOf('deletes') != -1) {
            // delete runs not seen in this continuous segment
            // its not perfect if runs are between segments, but over time runs should be deleted well enough
            const early_time = runs[0].submitted;
            const late_time = runs[0].submitted;

            const dbRuns = await run_dao.load_submitted_segment_ids(early_time, late_time);

            const oldIds = _.map(dbRuns, 'run.id');
            const newIds = _.map(runs, 'id');

            const toRemove = _.difference(oldIds, newIds);
            if (toRemove.length) {
                await run_dao.remove(toRemove);
            }
        }

        let save_runs = runs.map((run: Run) => {
            return {run: run};
        });

        const cur_runs = await run_dao.load(_.map(save_runs, 'run.id'));

        // compare and look for runs that have been updated

        // compare a few key properies
        const RUN_CMP_PROPERTIES = [
            'run.date',
            'run.comment',
            'run.times.primary',
            'run.status.status',
            'run.videos.links[0].uri',
            'run.players[0].id',
            'run.players[1].id'
        ];

        save_runs = save_runs.filter((run, i) => {
            const cur_run = cur_runs[i];

            if(!cur_run)
                return true;
            
            for (const prop of RUN_CMP_PROPERTIES) {
                if (!_.isEqual(_.get(cur_run, prop), _.get(run, prop)))
                    return true;
            }

            return false; // no need to re-save this run
        });

        if(save_runs.length) {

            // save the runs
            await run_dao.save(save_runs);

            // notify of new records as appropriate
            const new_records = run_dao.collect_new_records();

            if(new_records.length) {
                // reload from db in order to get computed properties
                const lbres = _.remove(await run_dao.load(_.map(new_records, 'new_run.run.id')) as LeaderboardRunEntry[], _.isNil);

                for (const record_run of new_records) {

                    debug('read new record %O, %O', record_run, lbres);

                    record_run.new_run = lbres.find(r => record_run.new_run.run.id == r.run.id)!;

                    if (record_run.new_run.place == 1 && args.length &&  args[0] === 'verified') {
                        // new record on this category/level, send notification
                        await push_notify.notify_game_record(record_run, record_run.new_run.run.game, record_run.new_run.run.category, record_run.new_run.run.level);
                    }
        
                    // this should be a personal best. send notification to all attached players who are regular users
                    if(!args.length || args[0] !== 'verified') {
                        for (const p of record_run.new_run.run.players) {
                            await push_notify.notify_player_record(record_run, p as User,
                                record_run.new_run.run.game, record_run.new_run.run.category, record_run.new_run.run.level);
                        }
                    }
                }
            }
        }
    }
}