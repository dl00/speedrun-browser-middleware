import * as _ from 'lodash';

import { Router } from 'express';

import { GameGroupDao } from '../../lib/dao/game-groups';

import * as api from '../';
import * as api_response from '../response';

const router = Router();

// retrieves a list of games from most popular to least popular
router.get('/', async function(req, res) {
    let query = req.query.q as string;

    const gg_dao = new GameGroupDao(api.storedb!);

    if (!query) {
        try {
            const ggs = _.reject(await gg_dao.load_popular(), _.isNil);
            return api_response.complete(res, ggs);
        } catch (err) {
            console.log('api/game-groups: could not get top list:', err);
            api_response.error(res, api_response.err.INTERNAL_ERROR());
        }
    }

    if (query.length > api.config!.api.maxSearchLength) {
        api_response.error(res, api_response.err.INVALID_PARAMS(['q'], 'invalid length'));
    }

    query = query.toLowerCase();

    // search all the indexer indexes
    try {
        const ggs = _.reject(await gg_dao.load_by_index('autocomplete', query), _.isNil);
        api_response.complete(res, ggs);
    } catch (err) {
        console.log('api/game-groups: could not autocompleted:', err);
        api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

module.exports = router;
