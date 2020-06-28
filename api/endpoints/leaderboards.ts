
import * as _ from 'lodash';

import { Router } from 'express';

import { LeaderboardDao } from '../../lib/dao/leaderboards';

import * as api from '../';
import * as api_response from '../response';

const router = Router();

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
        console.error('api/leaderboards: could not send runs from list:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }

    /*for(let leaderboard of leaderboards) {
        if(!leaderboard.players) {

            let player_ids = _.chain(leaderboard.runs)
                .map(v => _.map(v.run.players, 'id'))
                .flatten()
                .reject(_.isNil)
                .uniq()
                .value();

            if(!player_ids.length) {
                leaderboard.players = {};
                continue;
            }

            let players_raw = await api.storedb!.hmget(speedrun_db.locs.players, ...player_ids);

            leaderboard.players = <any>_.chain(players_raw)
                .reject(_.isNil)
                .map(JSON.parse)
                .map(v => _.pick(v, 'id', 'names', 'weblink', 'name-style', 'role'))
                .keyBy('id')
                .value();
        }
    }*/
});

module.exports = router;
