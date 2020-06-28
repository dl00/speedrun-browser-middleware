import * as _ from 'lodash';

import { RunDao } from '../lib/dao/runs';

import { CursorData, Sched } from '../sched/index';
import { Chart, ChartDao, BarChartData } from '../lib/dao/charts';
import { GameGroup, GameGroupDao } from '../lib/dao/game-groups';

const GAME_GROUP_BATCH_COUNT = 1;

// for pulling a single run which we previously lacked the resources to do
export async function generate_game_group_charts(sched: Sched, cur: CursorData<GameGroup>|null, args: string[]): Promise<CursorData<GameGroup>|null> {

  const game_group_dao = await new GameGroupDao(sched.storedb!);

  if(!cur) {
    return {
      items: [{id: 'site', name: 'site', type: ''}],
      asOf: Date.now(),
      desc: `single run ${args[0]}`,
      done: 0,
      total: await game_group_dao.count() + 1, // +1 for site
      pos: 'first'
    };
  }

  const [pos, ggs] = await game_group_dao.scanOnce({
    cur: cur.pos == 'first' ? null : cur.pos,
    batchSize: GAME_GROUP_BATCH_COUNT
  });

  return {
    items: ggs,
    asOf: Date.now(),
    desc: `game group charts`,
    done: cur.done + ggs.length,
    total: await game_group_dao.count() + 1, // +1 for site
    pos: pos
  };
}

export async function apply_game_group_charts(sched: Sched, cur: CursorData<GameGroup>) {
  const run_dao = await new RunDao(sched.storedb!);
  const chart_dao = await new ChartDao(sched.storedb!);

  for(const gg of cur.items) {
    // generate volume chart
    const volume_chart = await run_dao.get_group_submission_volume(gg.id == 'site' ? null : gg.id);
    await chart_dao.save(volume_chart);

    // generate historical run count chart
    const data = new Array(volume_chart.data.main.length);

    if(data.length > 0) {
      data[0] = volume_chart.data.main[0];
      for(let i = 1;i < volume_chart.data.main.length;i++) {
        data[i] = {
          x: (<BarChartData>volume_chart.data.main[i]).x,
          y: data[i - 1].y + (<BarChartData>volume_chart.data.main[i]).y
        }
      }
    }

    const historical_count_chart: Chart = {
      item_id: gg.id,
      parent_type: 'game-groups',
      item_type: 'runs',
      aggr: 'count',
      chart_type: 'bar',
      timestamp: new Date(),
      data: { 'main': data }
    };

    await chart_dao.save(historical_count_chart);
  }
}