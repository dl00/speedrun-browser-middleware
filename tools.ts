import * as _ from 'lodash';

import * as push_notify from './lib/push-notify';

import * as config from './lib/config';

import { Category } from './lib/dao/categories';
import { Level } from './lib/dao/levels';
import { User, UserDao } from './lib/dao/users';

import { Game, GameDao } from './lib/dao/games';
import { LeaderboardRunEntry, Run, RunDao } from './lib/dao/runs';

import { make_all_wr_charts } from './lib/dao/runs/charts';
import { load_db } from './lib/db';

export async function send_dummy_player_notify(run_id: string) {
    const db = await load_db(config.load_config().db);

    const runs = await new RunDao(db).load(run_id);

    const player = (await new UserDao(db).load((runs[0]!.run as Run).players[0].id))[0] as User;
    const game = (await new GameDao(db).load(((runs[0]!.run as Run).game as Game).id))[0] as Game;
    const category: Category = (runs[0]!.run as Run).category as Category;
    const level: Level|null = (runs[0]!.run as Run).level as Level|null;

    await push_notify.notify_player_record({new_run: runs[0]!, old_run: runs[0]!}, player, game, category, level as any);
}

export async function massage_all_runs(skip = 0) {
    const db = await load_db(config.load_config().db);
    return await new RunDao(db).massage({}, skip);
}

export async function massage_all_games(skip = 0) {
    const db = await load_db(config.load_config().db);
    return await new GameDao(db).massage({}, skip);
}

export async function restore_single_run(id: string) {
    const db = await load_db(config.load_config().db);
    const run_dao = new RunDao(db);
    const run = await run_dao.load(id);
    if (run[0] != null) {
        return await run_dao.save(run[0] as LeaderboardRunEntry);
    }
    else {
        return 'Run does not exist.';
    }
}

export async function regenerate_autocomplete() {
    const db = await load_db(config.load_config().db);
    const game_dao = new GameDao(db);
    game_dao.indexes.find((ind) => ind.name == 'autocomplete')!.forceIndex = true;
    game_dao.indexes.find((ind) => ind.name == 'popular_games')!.forceIndex = true;
    game_dao.indexes.find((ind) => ind.name == 'popular_trending_games')!.forceIndex = true;

    await game_dao.massage();

    const user_dao = new UserDao(db);
    user_dao.indexes.find((ind) => ind.name == 'autocomplete')!.forceIndex = true;
    user_dao.indexes.find((ind) => ind.name == 'abbr')!.forceIndex = true;

    await user_dao.massage();
}

export async function generate_all_charts() {
    const db = await load_db(config.load_config().db);
    await make_all_wr_charts(new RunDao(db));
}