import 'mocha';
import { Sched, SchedConfig, CursorData, InitJob } from '../sched';
import { load_config } from '../lib/config';

import * as _ from 'lodash';

import { expect } from 'chai';
import { load_db, DB } from '../lib/db';
import { sleep } from '../lib/util';

let taskCalled = 0;

// test spy functions for the sched
async function generate_test(_sched: Sched, cur: CursorData<any> | null) {
  return { items: [], asOf: Date.now(), pos: cur?.pos != '1' ? '1' : null, desc: 'test', done: 0, total: 0 }
}

async function apply_test() {
  taskCalled++;
}

function reset() {
  taskCalled = 0;
}

function test_timeout(_sched: Sched, _cur: CursorData<any> | null) {
  // returns a promise that never resolves
  return new Promise<CursorData<any>>(function() {})
}

export const SCHED_TEST_CONFIG: SchedConfig = {
  db: load_config().db,

  server: { host: 'localhost', port: 3051 },

  resources: {
    'slow': {
      name: 'slow',
      rateLimit: 10
    },

    'fast': {
      name: 'fast',
      rateLimit: 0
    }
  },

  generators: { 'test': generate_test, 'timeout': test_timeout },
  tasks: { 'test': apply_test, 'timeout': test_timeout },

  jobs: {

  }
}

describe('Sched', () => {
  var schedDb: DB;
  var sched: Sched;

  before(async () => {
    schedDb = await load_db(SCHED_TEST_CONFIG.db)
  })

  beforeEach(async () => {
    await schedDb.redis.flushall();
    reset();
  })

  afterEach(async () => {
    await sched.close();
  })

  it('should accept single job', async () => {
    sched = new Sched(SCHED_TEST_CONFIG);
    await sched.init();

    const job: InitJob = {
      name: 'dummy',
      resources: ['fast'],
      generator: 'test',
      task: 'test',
      args: [],
      blockedBy: [],
      timeout: 10
    };

    await sched.push_job(job);

    try {
      await sched.push_job(job);
      throw new Error('expected sched.push_job to throw an error due to duplicate')
    }
    catch(_e) {}

    await sched.loop();

    // TODO: would be way better if we could "await" for the below condition to succeed rather than sleeping some time
    await sleep(5);

    // make sure the job was called
    expect(taskCalled).to.eql(1);

    await sched.loop();
    await sched.loop();
    await sleep(5);
    await sched.loop();

    await sleep(5);

    // make sure the job was only called once (job is completed after 2nd run)
    expect(taskCalled).to.eql(2);

    // make sure we can add the job again now
    await sched.push_job(job);
  });

  it('should schedule jobs', async () => {
    sched = new Sched(_.defaults({
      jobs: {
        'test': {
          // basically this is a no-wait poller
          interval: 1,
          job: {
            name: 'dummy',
            resources: ['fast'],
            generator: 'test',
            task: 'test',
            timeout: 10
          }
        }
      }
    }, SCHED_TEST_CONFIG));

    await sched.init();
    await sleep(5);

    // should see the job scheduled
    await sched.loop();
    await sleep(5);
    expect(taskCalled).to.eql(1);

    await sched.loop();
    await sleep(5);
    expect(taskCalled).to.eql(2);

    // cannot test reschedule due to too much chaos
  });

  it('should rate limit with multiple resources round robin', async () => {
    sched = new Sched(SCHED_TEST_CONFIG);
    await sched.init();

    const job1: InitJob = {
      name: 'dummy1',
      resources: ['fast'],
      generator: 'test',
      task: 'test',
      args: [],
      blockedBy: [],
      timeout: 10
    };

    const job2: InitJob = {
      name: 'dummy2',
      resources: ['fast'],
      generator: 'test',
      task: 'test',
      args: [],
      blockedBy: [],
      timeout: 10
    };

    await sched.push_job(job1);
    await sched.push_job(job2);

    await sched.loop();

    // TODO: would be way better if we could "await" for the below condition to succeed rather than sleeping some time
    await sleep(5);

    // make sure the job was called
    expect(taskCalled).to.eql(1);

    await sched.loop();
    await sched.loop();
    await sleep(5);
    await sched.loop();

    await sleep(5);

    // make sure the job was only called once (job is completed after 2nd run)
    expect(taskCalled).to.eql(4);

    await sched.loop();

    expect(taskCalled).to.eql(4);
  });

  it('should handle timeouts', async () => {
    sched = new Sched(SCHED_TEST_CONFIG);
    await sched.init();

    // test timeout on generator
    const generatorTimeout: InitJob = {
      name: 'generatorTimeout',
      resources: ['fast'],
      generator: 'timeout',
      task: 'test',
      args: [],
      blockedBy: [],
      timeout: 1
    };

    await sched.push_job(generatorTimeout);

    await sched.loop();
    await sleep(5)

    // get the job, it should have a backoff now
    const job = await sched.get_job('generatorTimeout');

    expect(job?.backoff).to.be.greaterThan(0);

    // test timeout on task
    const taskTimeout: InitJob = {
      name: 'taskTimeout',
      resources: ['fast'],
      generator: 'test',
      task: 'timeout',
      args: [],
      blockedBy: [],
      timeout: 4
    };

    await sched.push_job(taskTimeout);

    await sched.loop();

    await sleep(5);

    // get the job, it should have been marked as a failed segment
    expect(await sched.get_job_failure_count('taskTimeout')).to.be.greaterThan(0);
  });
})