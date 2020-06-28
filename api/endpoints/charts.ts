import * as _ from 'lodash';

import { Router } from 'express';

import * as api from '../';
import * as api_response from '../response';

import { Category, CategoryDao, standard_sort_categories } from '../../lib/dao/categories';
import { Chart, ChartDao, LineChartData } from '../../lib/dao/charts';
import { Metric } from '../../lib/dao/metrics';
import { GameDao } from '../../lib/dao/games';
import { LeaderboardDao, make_distribution_chart } from '../../lib/dao/leaderboards';
import { Level, LevelDao } from '../../lib/dao/levels';
import { Run, RunDao } from '../../lib/dao/runs';
import { UserDao } from '../../lib/dao/users';
import { Variable } from '../../lib/speedrun-api';

const router = Router();

export function get_wr_chart_longest_holders(wr_chart: Chart): Chart {
    const chart: Chart = {
        item_id: wr_chart.item_id + '_holders',
        item_type: 'users',
        aggr: 'sum_over_time',
        chart_type: 'list',
        data: {},
        timestamp: new Date(),
    };

    for (const subcategory in wr_chart.data) {

        const holders: {[player_id: string]: any} = {};

        for (let i = 0; i < wr_chart.data[subcategory].length - 1; i++) {
            const run = (wr_chart.data[subcategory][i + 1] as LineChartData).obj as Run;

            const dt = run.times.primary_t -
                (wr_chart.data[subcategory][i] as LineChartData).obj.times.primary_t;

            if (holders[run.players[0].id]) {
                holders[run.players[0].id].score += dt;
            }
            else {
                holders[run.players[0].id] = {
                    score: dt,
                    player: run.players[0],
                };
            }
        }

        chart.data[subcategory] = _.reverse(_.sortBy(_.values(holders), 'score'));
    }

    return chart;
}

router.get('/game-groups/:id', async (req, res) => {

    const gg_id = req.params.id;

    const chart_dao = new ChartDao(api.storedb!);

    const game_dao = new GameDao(api.storedb!);
    const leaderboard_dao = new LeaderboardDao(api.storedb!);
    const run_dao = new RunDao(api.storedb!);

    // total run count over time
    const count_over_time_chart = (await chart_dao.load(`runs_count_${gg_id}`))[0];

    // submitted run volume
    const volume_chart = (await chart_dao.load(`runs_volume_${gg_id}`))[0];

    // metric: hours recorded in PBs by speedrunners

    // metric: game with the most speedruns this month

    let metrics: {[key: string]: Metric} = await run_dao.get_basic_metrics({ gg_id: gg_id });

    if(gg_id === 'site') {
        metrics.total_games = { value: await game_dao.count() };
        metrics.total_leaderboards = { value: await leaderboard_dao.count() };
    }

    api_response.complete_single(res, {
        charts: {
            count_over_time: count_over_time_chart,
            volume: volume_chart,
        },
        metrics: metrics
    });
});

router.get('/games/:id', async (req, res) => {

    const game_id = req.params.id;

    const game_dao = new GameDao(api.storedb!);
    const leaderboard_dao = new LeaderboardDao(api.storedb!);
    const run_dao = new RunDao(api.storedb!);

    const game = (await game_dao.load(game_id))[0];

    if (!game) {
        return api_response.error(res, api_response.err.NOT_FOUND());
    }

    /// run submission volume over the last 12 months
    const volume_chart = await run_dao.get_game_submission_volume(game_id);

    /// all time longest world record holders overall

    /// fastest improving runners, runners who have come out of nowhere/improved/relevant recently

    api_response.complete_single(res, {
        game,
        charts: {
            volume: volume_chart,
        },
        metrics: {
            ...await run_dao.get_basic_metrics({ game_id: game_id }),
            total_leaderboards: { value: await leaderboard_dao.get_leaderboard_count_for_game(game_id) }
        }
    });
});

router.get('/leaderboards/:id', async (req, res) => {

    const leaderboard_id = req.params.id;

    const category_id = leaderboard_id.split('_')[0];
    const level_id = leaderboard_id.split('_')[1];

    const chart_dao = new ChartDao(api.storedb!);
    const leaderboard_dao = new LeaderboardDao(api.storedb!);
    const game_dao = new GameDao(api.storedb!);
    const category_dao = new CategoryDao(api.storedb!);
    const level_dao = new LevelDao(api.storedb!);
    const run_dao = new RunDao(api.storedb!);

    const leaderboard = (await leaderboard_dao.load(leaderboard_id))[0]!;
    const category = (await category_dao.load(category_id))[0]!;

    if (!category) {
        return api_response.error(res, api_response.err.NOT_FOUND());
    }

    const game = (await game_dao.load(category.game!))[0]!;

    let level = null;
    if (level_id) {
        level = (await level_dao.load(level_id))[0];
    }

    if (!game) {
        return api_response.error(res, api_response.err.NOT_FOUND());
    }

    if (!leaderboard) {
        return api_response.complete_single(res, {
            game,
            category,
            level,
            charts: {
                wrs: null,
                distribution: null,
                volume: null,
            },
        });
    }

    // word records chartify
    const wr_chart = (await chart_dao.load(`runs_min_${leaderboard_id}`))[0];

    // show the run time distributions
    const distrib_chart = make_distribution_chart(leaderboard, category.variables as Variable[]);

    // run submission volume over the last 12 months
    const volume_chart = await run_dao.get_leaderboard_submission_volume(category_id, level_id);

    // all time longest world record holders for each category (just a repackaging of wr_chart)

    // fastest improving runners, runners who have come out of nowhere/improved/relevant recently (repackaging of player pb chart)

    api_response.complete_single(res, {
        game,
        category,
        level,
        charts: {
            wrs: wr_chart,
            distribution: distrib_chart,
            volume: volume_chart,
        }
    });
});

router.get('/users/:id', async (req, res) => {
    const player_id = req.params.id;

    const user_dao = new UserDao(api.storedb!);
    const run_dao = new RunDao(api.storedb!);

    const player = (await user_dao.load(player_id))[0]!;

    /// calculate "favorite" games by count of runs
    const favorite_games_chart = await run_dao.get_player_favorite_runs(player_id);
    const volume_chart = await run_dao.get_player_submission_volume(player_id);

    api_response.complete_single(res, {
        player,
        charts: {
            favorite_games: favorite_games_chart,
            volume: volume_chart,
        },
        metrics: {
            ...await run_dao.get_basic_metrics({player_id: player_id})
        }
    });
});

router.get('/games/:game_id/players/:player_id', async (req, res) => {
    const game_id = req.params.game_id;
    const player_id = req.params.player_id;

    const game_dao = new GameDao(api.storedb!);
    const run_dao = new RunDao(api.storedb!);

    const game = (await game_dao.load(game_id))[0]!;

    game.categories = (await new CategoryDao(api.storedb!)
        .load_by_index('game', game.id) as Category[]);

    // since we don't preserve the order from speedrun.com of categories, we have to sort them on our own
    game.categories = standard_sort_categories(game.categories);

    game.levels = (await new LevelDao(api.storedb!)
        .load_by_index('game', game.id) as Level[]);

    // since we don't preserve the order from speedrun.com, we have to sort them on our own
    game.levels = _.sortBy(game.levels, (l) => l.name.toLowerCase());

    /// personal bests chartify
    const pb_chart = await run_dao.get_player_pb_chart(player_id, game_id);

    api_response.complete_single(res, {
        game,
        charts: {
            pbs: pb_chart,
        },
        metrics: {
            ...await run_dao.get_basic_metrics({ game_id: game_id, player_id: player_id })
        }
    });
});

module.exports = router;
