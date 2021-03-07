
import * as _ from 'lodash';

import { Router } from 'express';

import { UserDao } from '../../lib/dao/users';

import * as api from '../';
import * as api_response from '../response';
import { RunDao } from '../../lib/dao/runs';

const router = Router();

// retrieve one or more leaderboards by id
router.get('/:ids', async (req, res) => {
    const ids = req.params.ids.split(',');

    if (ids.length > api.config!.api.maxItems) {
        return api_response.error(res, api_response.err.TOO_MANY_ITEMS());
    }

    const players = await new UserDao(api.storedb!).load(ids);
    return api_response.complete(res, players);
});

// retrieve personal bests for a user
router.get('/:id/bests', async (req, res) => {
    const id = req.params.id;

    const pbs = await new RunDao(api.storedb!).get_player_pbs(id, req.query.includeObsolete === 'true', req.query.lastSubmitted?.toString());
    return api_response.complete(res, pbs);
});

module.exports = router;
