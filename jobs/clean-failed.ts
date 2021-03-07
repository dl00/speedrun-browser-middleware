import * as _ from 'lodash';

import { CursorData, Sched, ScheduledJob } from '../sched';

// for cleaning failed runs of repeating jobs which can cause serious problem
export async function generate_clean_failed_segments(sched: Sched, _cur: CursorData<ScheduledJob>|null, _args: string[]): Promise<CursorData<ScheduledJob>|null> {
    return {
        items: sched.get_scheduled_jobs(),
        asOf: Date.now(),
        desc: 'clean failed segments',
        done: 1,
        total: 1,
        pos: 1
    };
}

export async function apply_clean_failed_segments(sched: Sched, cur: CursorData<ScheduledJob>) {
    for(const sj of cur.items) {
        await sched.clean_failed_segments(sj.job.name);
    }
}