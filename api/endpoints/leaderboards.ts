
import * as _ from 'lodash';

import { Router } from 'express';

import { LeaderboardDao } from '../../lib/dao/leaderboards';

import * as api from '../';
import * as api_response from '../response';

const router = Router();

import Debug from 'debug';
const debug = Debug('api:leaderboards');

// retrieve one or more leaderboards by id
router.get('/:ids', async (req, res) => {
    const ids = req.params.ids.split(',');

    if (ids.length > api.config!.api.maxItems) {
        return api_response.error(res, api_response.err.TOO_MANY_ITEMS());
    }

    try {
        const leaderboards = await new LeaderboardDao(api.storedb!).load(ids);

        return api_response.complete(res, leaderboards);
    } catch (err) {
        debug('api/leaderboards: could not send leaderboard:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

// new api to return runs from a single leaderboard, only the first positions
router.get('/:id/runs', async (req, res) => {
    const id = req.params.id;

    try {

        const filters: any = {};
        for(const f in req.query) {
            if(f.startsWith('var_')) {
                filters[f.substr(4)] = req.query[f];
            }
        }

        const lbrs = await new LeaderboardDao(api.storedb!).load_runs(id, req.query.startAfter?.toString(), filters);

        return api_response.complete(res, lbrs);
    } catch (err) {
        debug('api/leaderboards: could not send runs from list:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

module.exports = router;
