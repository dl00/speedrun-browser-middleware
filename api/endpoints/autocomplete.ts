
import { Router } from 'express';

import * as _ from 'lodash';

import * as api from '../';
import * as api_response from '../response';

import { game_to_bulk, GameDao } from '../../lib/dao/games';
import { user_to_bulk, UserDao } from '../../lib/dao/users';
import { GameGroupDao } from '../../lib/dao/game-groups';

interface IndexerResponse {[type: string]: any[]}

const router = Router();

router.get('/', async (req, res) => {
    let query = req.query.q as string;

    if (!query || query.length > api.config!.api.maxSearchLength) {
        api_response.error(res, api_response.err.INVALID_PARAMS(['q'], 'invalid length'));
    }

    query = query.toLowerCase();

    // search all the indexer indexes
    try {
        const results: IndexerResponse = {
            games: _.chain(await new GameDao(api.storedb!).load_by_index('autocomplete', query))
                .reject(_.isNil)
                .map(game_to_bulk)
                .value(),
            players: _.chain(await new UserDao(api.storedb!).load_by_index('autocomplete', query, {skipComputed: true}))
                .reject(_.isNil)
                .map(user_to_bulk)
                .value(),
            game_groups: _.chain(await new GameGroupDao(api.storedb!).load_by_index('autocomplete', query))
                .reject(_.isNil)
                .value()
        };

        return api_response.custom(res, {
            search: results,
        });
    } catch (err) {
        console.log('api/autocomplete: could not autocompleted:', err);
        api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

module.exports = router;
