import * as allRuns from './all-runs';
import * as charts from './charts';
import * as gamelist from './gamelist';
import * as twitch from './twitch';
import { CursorData, Sched } from '../sched';

export function make_generators(): { [key: string]: (sched: Sched, pos: CursorData<any>|null, args: string[]) => Promise<CursorData<any>|null> } {
  return {
    'generate_all_runs': allRuns.generate_all_runs,
    'generate_latest_runs': allRuns.generate_latest_runs,
    'generate_single_run': allRuns.generate_single_run,

    'generate_games': gamelist.generate_games,

    'generate_game_group_charts': charts.generate_game_group_charts,
    
    'generate_twitch_games': twitch.generate_twitch_games,
    'generate_all_twitch_streams': twitch.generate_all_twitch_streams,
    'generate_running_twitch_streams': twitch.generate_running_twitch_streams
  }
}

export function make_tasks(): { [key: string]: (sched: Sched, data: CursorData<any>, args: string[]) => Promise<any> } {
  return {
    'apply_runs': allRuns.apply_runs,
    'apply_games': gamelist.apply_games,
    'apply_game_group_charts': charts.apply_game_group_charts,
    'apply_twitch_games': twitch.apply_twitch_games,
    'apply_twitch_streams': twitch.apply_twitch_streams
  }
}