import * as _ from 'lodash';
import * as ioredis from 'ioredis';

import * as http from 'http';

import pTimeout from 'p-timeout';

const debug = require('debug')('sched:verbose');
const debugInfo = require('debug')('sched')

import { load_config } from '../lib/config';
import { DB, DBConfig, close_db, load_db } from '../lib/db';
import { EventEmitter } from 'events';

export const config: any = load_config();

const RDB_JOBS = 'jobs';
const RDB_JOBS_CONCURRENT = 'jobsConcurrent';
const RDB_JOB_NAMES = 'jobNames';
const RDB_JOB_SCHEDULE = 'jobSchedule';
const RDB_RESOURCES = 'resources';
const RDB_RESOURCES_QUEUE = 'resourcesJobQueue';
const RDB_FAILED_SEGMENTS = 'failedSegments';
const RDB_JOB_RUN_LOG = 'runLog';

const DUST_NEXT_EVENT = 25;

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 5 * 60 * 1000;

const MAX_CONCURRENT = 1;

const RUNNING_WAIT = 10 * 1000; // 10 seconds

// critical section for starting a job
const LUA_MARK_START_JOB = `
local function split(inputstr)
  local t={}
  for str in string.gmatch(inputstr, "([^,]+)") do
    table.insert(t, str)
  end
  return t
end

local job = ARGV[1]
local now = tonumber(ARGV[2])

-- check the job
local backoff, lastRun, blockedBy, resources, cur = unpack(redis.call("HMGET", "${RDB_JOBS}:" .. job, "backoff", "lastRun", "blockedBy", "resources", "cur"))

if resources == false then
  return "job is gone"
end

-- cannot set job if in backoff
if now < tonumber(lastRun) + tonumber(backoff) then
  return "in back-off (" .. tonumber(lastRun) + tonumber(backoff) - tonumber(now) .. ")"
end

-- cannot set job if too much concurrent
redis.call("ZREMRANGEBYSCORE", "${RDB_JOBS_CONCURRENT}:" .. job, "-inf", now - 300000)
if redis.call("ZCARD", "${RDB_JOBS_CONCURRENT}:" .. job) >= ${MAX_CONCURRENT} then
  return "too concurrent"
end

-- cannot set job if cur is still in use
if cur then
  if redis.call("ZSCORE", "${RDB_JOBS_CONCURRENT}:" .. job, cur) then
    return "cursor in use"
  end
else
  if redis.call("ZSCORE", "${RDB_JOBS_CONCURRENT}:" .. job, "null") then
    return "cursor in use"
  end
end

-- check blocking jobs
blockedBy = split(blockedBy, ",")

for _,bb in pairs(blockedBy) do
  -- cannot set job if blocked by another
  if redis.call("EXISTS", "${RDB_JOBS}:" .. bb) == 1 then
    return "blocked by " .. bb
  end
end

-- check resources
resources = split(resources, ",")

for i,r in ipairs(resources) do
  local rLastUse, rRateLimit = unpack(redis.call("HMGET", "${RDB_RESOURCES}:" .. r, "lastUseTime", "rateLimit"))

  -- cannot set job if resource not ready
  if now < rLastUse + rRateLimit then
    return "resource '" .. r .. "' is not ready"
  end
end

-- job can be done
for i, r in ipairs(resources) do
  redis.call("HSET", "${RDB_RESOURCES}:" .. r, "lastUseTime", now)

  -- move the job to the end of the queue
  redis.call("LREM", "${RDB_RESOURCES_QUEUE}:" .. r, 1, job)
  redis.call("RPUSH", "${RDB_RESOURCES_QUEUE}:" .. r, job)
end

redis.call("HMSET", "${RDB_JOBS}:" .. job, "lastRun", now)
redis.call("ZADD", "${RDB_JOBS_CONCURRENT}:" .. job, now, cur or "null")
`;

const LUA_ADD_JOB = `
local function split(inputstr)
  local t={}
  for str in string.gmatch(inputstr, "([^,]+)") do
    table.insert(t, str)
  end
  return t
end

local jobName = ARGV[1]

local resources = redis.call("HGET", "${RDB_JOBS}:" .. jobName, "resources")

-- add this job to all applicable resources
resources = split(resources, ",")

for i,r in ipairs(resources) do
  redis.call("LREM", "${RDB_RESOURCES_QUEUE}:" .. r, 0, jobName)
  redis.call("RPUSH", "${RDB_RESOURCES_QUEUE}:" .. r, jobName)
end

redis.call("SADD", "${RDB_JOB_NAMES}", jobName)
`;

const LUA_CLEAR_JOB = `
local function split(inputstr)
  local t={}
  for str in string.gmatch(inputstr, "([^,]+)") do
    table.insert(t, str)
  end
  return t
end

local jobName = ARGV[1]

local resources = redis.call("HGET", "${RDB_JOBS}:" .. jobName, "resources")

if resources == nil or resources == "" then
  return "job is gone"
end

-- remove this job from all applicable resources
resources = split(resources, ",")

for i,r in ipairs(resources) do
  redis.call("LREM", "${RDB_RESOURCES_QUEUE}:" .. r, 0, jobName)
end


local lastRun = redis.call("HGET", "${RDB_JOBS}:" .. jobName, "lastRun")

redis.call("ZADD", "${RDB_JOB_RUN_LOG}:" .. jobName, lastRun, lastRun)
redis.call("DEL", "${RDB_JOBS}:" .. jobName, "${RDB_JOBS_CONCURRENT}:" .. jobName)
redis.call("SREM", "${RDB_JOB_NAMES}", jobName)
`;

export interface InitResource {
  /** string used to identify this resource */
  name: string;

  /** minimum millisecond interval between calls to this resource */
  rateLimit: number;
}

export interface Resource extends InitResource {
  /** epoch milliseconds of the last time the resource was "used" */
  lastUseTime: number;
}

export interface InitJob {
  /** string used to identify this job (and to deduplicate the same job running twice) */
  name: string;

  /** resources which this job is waiting for */
  resources: string[];

  /** function to call to get the next set of input data */
  generator: string;

  /** function which does the actual work of processing the input data */
  task: string;

  /** string array which is passed to the function as arguments */
  args: string[];

  /** number of milliseconds before call to `task` is considered timed out */
  timeout: number;

  /** will prevent the execution of this job if another job by name is seen. useful for init. */
  blockedBy: string[];
}

export type GenericInitJob = InitJob;

export interface Job extends InitJob {

  /** last cursor value executed */
  cur: CursorData<any>|null;

  /** epoch milliseconds of the last time a job segment was started. may be used to temporarily lock a job. */
  lastRun: number;

  /** number of milliseconds to wait before running this job again after failure */
  backoff: number;
}

export type GenericJob = Job;

export interface ScheduledJob {
  /** frequency in milliseconds that this job should be run */
  interval: number;

  /** the job to run */
  job: GenericInitJob;
}

export interface CursorData<T> {
  /** string for the generator to identify the next position in the cursor */
  pos: any|null;

  /** date that the data in this cursor was generated */
  asOf: number;

  /** human readable explaination of the current position of the cursor */
  desc: string;

  /** the number of items which have been seen so far on this cursor */
  done: number;

  /** the total number of items expected on this cursor. used for progress calculation. */
  total: number;

  /** the items contained in this batch returned by the generator */
  items: T[];
}

export interface SchedConfig {
  /** database which should be used for recording the result of the jobs */
  db: DBConfig;

  /** configuration for the webserver which is used for health and metrics */
  server: {
    host: string,
    port: number,
  }

  /** resources which the jobs will be able to access */
  resources: { [key: string]: InitResource };

  /** references to functions which can be called by the scheduler */
  generators: { [key: string]: (sched: Sched, pos: CursorData<any>|null, args?: string[]) => Promise<CursorData<any>|null> };

  /** references to function which can be called by the scheduler */
  tasks: { [key: string]: (sched: Sched, data: CursorData<any>, args?: string[]) => Promise<any> };

  /** jobs which should be put on a schedule */
  jobs: { [key: string]: ScheduledJob };
};

export class Sched extends EventEmitter {

  /** stored copy of the scheduler configuration */
  readonly config: SchedConfig;

  private rdb: ioredis.Redis;
  
  /** the database connection object */
  private db: DB|null = null;

  /** reference to http server for healthcheck and etc. */
  private server: http.Server|null = null;

  /** pending call to the `loop` function, in case a cancel is needed */
  private loopPending: any|null = null;

  /** pending calls to push scheduled jobs, in case a cancel is needed */
  private readonly pendingTasks: {[id: string]: any} = {};

  get storedb(): DB {
    return this.db!
  }

  constructor(config: SchedConfig, db: DB | null = null) {
    super();
    this.config = _.cloneDeep(config);
    this.db = db;

    this.rdb = new ioredis(config.db.redis);

    this.rdb.defineCommand('schedstart', {
      numberOfKeys: 0,
      lua: LUA_MARK_START_JOB
    });

    this.rdb.defineCommand('schedjobadd', {
      numberOfKeys: 0,
      lua: LUA_ADD_JOB
    })

    this.rdb.defineCommand('schedjobclear', {
      numberOfKeys: 0,
      lua: LUA_CLEAR_JOB
    });
  }
  
  private async mark_job_exec_start(name: string, now: number): Promise<boolean> {
    return await (<any>this.rdb).schedstart(name, now);
  }
  
  private async mark_job_exec_new_cursor(job: GenericJob, now: number, cursor: CursorData<any>|null): Promise<void> {
    await this.rdb.hmset(`${RDB_JOBS}:${job.name}`, {
      lastRun: now,
      cur: JSON.stringify(cursor)
    });
  }
  
  private async mark_job_exec_finish(job: GenericJob, cur: CursorData<any>|null, backoff = 0): Promise<void> {

    if(!await this.rdb.exists(`${RDB_JOBS}:${job.name}`)) {
      return
    }

    const m = this.rdb.multi();
    m.hmset(`${RDB_JOBS}:${job.name}`, 'lastRun', Date.now(), 'backoff', backoff);
    m.zrem(`${RDB_JOBS_CONCURRENT}:${job.name}`, cur ? JSON.stringify(cur) : 'null');

    await m.exec();
  }
  
  private async push_failed_segment(job: GenericJob, seg: CursorData<any>): Promise<void> {
    await this.rdb.rpush(`${RDB_FAILED_SEGMENTS}:${job.name}`, JSON.stringify(seg));
  }
  
  private async pop_failed_segment(job: GenericJob): Promise<CursorData<any>|null> {
    const raw_seg = await this.rdb.lpop(`${RDB_FAILED_SEGMENTS}:${job.name}`);
  
    if(raw_seg)
      return JSON.parse(raw_seg);
  
    return null;
  }
  
  private async set_resource(r: InitResource): Promise<void> {

    const old_res = await this.get_resource(r.name);

    await this.rdb.hmset(`${RDB_RESOURCES}:${r.name}`, _.assign({
      lastUseTime: 0
    }, old_res, r));
  }
  
  private async get_resource(name: string): Promise<Resource> {
    const res = await this.rdb.hgetall(`${RDB_RESOURCES}:${name}`) as any;

    res.lastUseTime = res.lastUseTime ? parseInt(res.lastUseTime) : 0;
    res.rateLimit = res.rateLimit ? parseInt(res.rateLimit) : 0;

    return res;
  }

  private async get_resource_job_queue(name: string): Promise<string[]> {
    return await this.rdb.lrange(`${RDB_RESOURCES_QUEUE}:${name}`, 0, -1);
  }
  
  private async get_all_resources(): Promise<{[id: string]: Resource}> {
    const all_resources = await this.rdb.scan(0, 'match', `${RDB_RESOURCES}:*`, 'count', 100);

    const rets: Resource[] = [];
    await Promise.all(_.map(all_resources[1], async (r) => {
      rets.push(await this.get_resource(r.split(':')[1]));
    }));

    return _.keyBy(rets, 'name');
  }

  private async set_job(job: GenericJob): Promise<void> {
    // we only want to set some properties on first init (determined by lastRun === 0)

    const saved_job: any = job;
    saved_job.args = (job.args || []).join(',');

    await this.rdb.hmset(`${RDB_JOBS}:${job.name}`, _.omit(saved_job, job.lastRun === 0 ? ['cur'] : ['cur', 'lastRun']));
  }
  
  private async clear_job(job: GenericJob): Promise<void> {
    debugInfo(`clear job: ${job.name}`);
    await (<any>this.rdb).schedjobclear(job.name);

    this.emit('clear_job', job);
  }
  
  async get_job(name: string): Promise<GenericJob|null> {
    const raw_job: any = await this.rdb.hgetall(`${RDB_JOBS}:${name}`);
  
    if(raw_job && _.keys(raw_job).length) {
      raw_job.lastRun = parseInt(<string>raw_job.lastRun);
      raw_job.backoff = parseInt(<string>raw_job.backoff);
      raw_job.timeout = parseInt(<string>raw_job.timeout);
      raw_job.args = (<string>raw_job.args || '').split(',');

      if (raw_job.cur) {
        raw_job.cur = JSON.parse(<string>raw_job.cur)
      }

      return raw_job as any;
    }
  
    return null;
  }

  async get_job_failure_count(name: string): Promise<number> {
    return await this.rdb.llen(`${RDB_FAILED_SEGMENTS}:${name}`);
  }
  
  async push_job(job: GenericInitJob): Promise<void> {
    if(await this.get_job(job.name))
      throw new Error(`job already exists/running: ${job.name}`);

    debugInfo('new job', job);
    
    await this.set_job(_.assign({ lastRun: 0, backoff: 0, cur: null }, job));
    await (<any>this.rdb).schedjobadd(job.name);

    this.emit('push_job', job);
  }

  async has_job(name: string): Promise<boolean> {
    return !!(await this.get_job(name)) || !!(await this.rdb.exists(`${RDB_JOB_RUN_LOG}:${name}`));
  }
  
  /** perform a single iteration of executing jobs. may spawn tasks which continue in the background. */
  async loop(repeat = false) {
    debug('enter loop');

    try {
  
      const resources = await this.get_all_resources();
  
      const now = Date.now();
      let nextEvent = 10000;
  
      const doneJobs: GenericJob[] = [];
  
      for(const name in resources) {
        debug(`check resource: ${name}`);
        const r = resources[name];

        const jobQueue = await this.get_resource_job_queue(name);
    
        // can execute?
        if(jobQueue.length && r.lastUseTime + r.rateLimit <= now) {
          // find the first job that works
          let doJob: GenericJob|null = null;
  
          let jobNextEvent = 10000;
  
          for(const j of jobQueue) {
            // try to start the job
            const jobStatus = await this.mark_job_exec_start(j, now);
            
            debug(`check job: ${j} (${jobStatus})`);
            if (!jobStatus) {
              // job is qualified
              doJob = await this.get_job(j);
              break;
            }
          }
  
          if(!doJob) {
            // nothing can execute right now
            nextEvent = Math.min(nextEvent, now + jobNextEvent);
          }
          else {
            debugInfo(`do job: ${doJob.name} (cur ${doJob.cur?.pos})`);
            doneJobs.push(doJob);
            
            // do this job
            (async () => {
              try {
                // pull the next data from the generator
                const newCur = await pTimeout(this.config.generators[doJob.generator](this, doJob.cur, doJob.args), doJob.timeout);
  
                await this.mark_job_exec_new_cursor(doJob!, now, newCur);
          
                // last batch segment?
                if(!newCur?.pos) {
                  await this.clear_job(doJob);
                  // if there is a problem processing the last segment, it will be reflected in the rejected segments
                }
                else {
                  // may be able to use the new cursor now
                  this.loop().then(_.noop);
                }
  
                if (newCur) {
                  try {
                    // process the next data that was generated
                    if(newCur) {
                      await pTimeout(this.config.tasks[doJob.task](this, newCur, doJob.args), doJob.timeout);

                      debugInfo(`complete job seg: ${doJob.name} (${newCur.done} / ${newCur.total})`);
                    }

                    await this.mark_job_exec_finish(doJob, doJob.cur);

                    // trigger an immediately loop since this job may be able to run again
                    this.loop().then(_.noop);

                  } catch(err) {
                    debugInfo(`job seg task fail (dead): ${doJob.name}: %O`, err);
                    await this.push_failed_segment(doJob, newCur!);
                    await this.mark_job_exec_finish(doJob, doJob.cur);
                  }
                }
              } catch(err) {
                debugInfo('failed generating job segment:', doJob!.name, err);
  
                doJob!.backoff = Math.min(Math.max(doJob!.backoff * 2, MIN_BACKOFF), MAX_BACKOFF);

                await this.mark_job_exec_finish(doJob, doJob.cur, doJob!.backoff);
  
              }
            })()
          }
        }
        else if(r.lastUseTime + r.rateLimit > now)
          nextEvent = Math.min(nextEvent - DUST_NEXT_EVENT, r.lastUseTime + r.rateLimit - now);
      }
  
      if(repeat) {
        debugInfo(`next event in ${nextEvent}`);
        this.loopPending = setTimeout(_.bind(this.loop, this, true), nextEvent);
      }
  
    } catch(err) {
      console.error('problem in sched:', err);
  
      if(repeat)
        this.loopPending = setTimeout(_.bind(this.loop, this, true), 1000);
    }
  }
  
  async init() {

    debugInfo(`initialized with generators: ${_.keys(this.config.generators).join(' ')}`);
    debugInfo(`initialized with tasks:      ${_.keys(this.config.tasks).join(' ')}`);

    // add resources
    for(const res of _.values(this.config.resources)) {
      debugInfo(`init resource ${res.name}`);
      await this.set_resource(res);
    }
  
    const now = Date.now();
  
    for (const job of _.values(this.config.jobs)) {

      debug('eval %O', job);

      const scheduled: string = await this.rdb!.hget(RDB_JOB_SCHEDULE, job.job.name) as any;
  
      const runAndSchedule = async () => {
        try {
          await this.push_job(job.job);
          await this.rdb!.hset(RDB_JOB_SCHEDULE, job.job.name, Date.now());
          this.pendingTasks[job.job.name] = setTimeout(runAndSchedule, job.interval);
        } catch(err) {
          // schedule again in some time (not the given interval because we want to resume once the existing is done)
          this.pendingTasks[job.job.name] = setTimeout(runAndSchedule, RUNNING_WAIT);
        }

      }
  
      if (scheduled && parseInt(scheduled) + job.interval > now) {
        // schedule for the time difference
        const scheduleFromNow = parseInt(scheduled) + job.interval - now;
        debugInfo(`scheduled time difference: ${job.job.name} in ${scheduleFromNow}`);
  
        this.pendingTasks[job.job.name] = setTimeout(runAndSchedule, scheduleFromNow);
  
        continue;
      }
  
      // if we make it this far, spawn right now. schedule for later
      debugInfo(`schedule now: ${job.job.name}`)
      runAndSchedule().then(_.noop)
    }
  }
  
  async exec() {
    this.server = http.createServer((req, res) => {
      if(req.url === '/') {
        return res.end('OK');
      }

      // add metrics here later

      res.statusCode = 404;
      res.end();
    });

    this.server.listen(this.config.server.port, this.config.server.host);

    this.loop(true).then(_.noop);
  }

  async reprocess_dead(jobName: string) {
    await this.init()

    const job = await this.get_job(jobName)!;

    if(!job)
      throw new Error('job not registered');

    let seg;
    while(seg = await this.pop_failed_segment(job)) {
      try {
        await pTimeout(this.config.tasks[job.task](this, seg, job.args), job.timeout);
      } catch(err) {
        debug(`still fails: %O`, err);
        await this.push_failed_segment(job, seg);
      }
    }
  }

  async close() {

    if(this.server)
      this.server.close();

    if(this.db)
      await close_db(this.db);
    
    if(this.loopPending)
      clearTimeout(this.loopPending);

    for(const task in this.pendingTasks) {
      clearTimeout(this.pendingTasks[task]);
    }
  }
}

if(module === require.main) {
  load_db(load_config().db).then((db) => {
    const sched = new Sched(load_config().sched, db);
    sched.exec();
  });
}