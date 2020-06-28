
import * as _ from 'lodash';

import { Router } from 'express';

import { UserDao } from '../../lib/dao/users';

import * as api from '../';
import * as api_response from '../response';

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

module.exports = router;
