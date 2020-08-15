import * as _ from 'lodash';

import { Request, Response, Router } from 'express';

import * as api from '../';
import * as api_response from '../response';

import { Category, CategoryDao, standard_sort_categories } from '../../lib/dao/categories';
import { Game, GameDao } from '../../lib/dao/games';
import { Level, LevelDao } from '../../lib/dao/levels';

import Debug from 'debug';
const debug = Debug('api:games');

const router = Router();

async function get_popular_games(req: Request, res: Response) {
    let start = 0;

    if (req.query.start) {
        start = parseInt(<string>req.query.start);
    }

    let end = start + api.config!.api.maxItems - 1;
    if (req.query.count) {
        end = start + parseInt(<string>req.query.count) - 1;
    }

    let mode = 'popular';
    if (req.query.mode) {
        mode = <string>req.query.mode;
    }

    if (isNaN(start) || start < 0) {
        return api_response.error(res, api_response.err.INVALID_PARAMS(['start']));
    }

    if (isNaN(end) || end < start || end - start + 1 > api.config!.api.maxItems) {
        return api_response.error(res, api_response.err.INVALID_PARAMS(['count']));
    }

    try {
        const games = await new GameDao(api.storedb!,
            {max_items: api.config!.api.maxItems}).load_popular(mode, start, req.params.id);

        return api_response.complete(res, games, {
            code: (end + 1).toString(),
            total: 100000,
        });
    } catch (err) {
        debug('api/games/genre: could not send genred games:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
}

// retrieves a list of games from most popular to least popular
router.get('/', get_popular_games);
router.get('/genre/:id', get_popular_games);

// retrieve one or more games by id
// if only one game is requested, embed additionally the categories and levels
router.get('/:ids', async (req, res) => {
    const ids = req.params.ids.split(',');

    if (ids.length > api.config!.api.maxItems) {
        return api_response.error(res, api_response.err.TOO_MANY_ITEMS());
    }

    // remap abbrevations as necessary
    const game_dao = new GameDao(api.storedb!);

    try {

        let games: Array<Game|null>;
        const games_no_abbr = await game_dao.load(ids);
        if (games_no_abbr.indexOf(null) == -1) {
            games = games_no_abbr;
        } else {
            const games_abbr = await game_dao.load_by_index('abbr', ids);
            games = _.zipWith(games_no_abbr, games_abbr, (a: any, b: any) => a || b);

            return api_response.complete(res, games);
        }

        if (games.length === 1 && !_.isNil(games[0])) {
            games[0]!.categories = (await new CategoryDao(api.storedb!).load_by_index('game', games[0]!.id) as Category[]);

            // since we don't preserve the order from speedrun.com of categories, we have to sort them on our own
            games[0]!.categories = standard_sort_categories(games[0]!.categories);

            games[0]!.levels = (await new LevelDao(api.storedb!).load_by_index('game', games[0]!.id) as Level[]);

            // since we don't preserve the order from speedrun.com, we have to sort them on our own
            games[0]!.levels = _.sortBy(games[0]!.levels, (l) => l.name.toLowerCase());
        }

        return api_response.complete(res, games);
    } catch (err) {
        debug('api/games/genre: could not send genred games:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

// endpoint to retrieve games which have a moderator
router.get('moderator/:id', async(req, res) => {

    const mod_id = req.params.id;

    let start = 0;
    if (req.query.start) {
        start = parseInt(<string>req.query.start);
    }

    try {
        const games = await new GameDao(api.storedb!, { max_items: api.config!.api.maxItems })
            .load_for_mod(mod_id, start);

        return api_response.complete(res, games);
    } catch(err) {
        debug('api/runs: could not send runs from list for mod:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

module.exports = router;
