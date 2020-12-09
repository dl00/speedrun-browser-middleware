import * as _ from 'lodash';

import { Request, Response, Router } from 'express';

import { CategoryDao } from '../../lib/dao/categories';
import { LevelDao } from '../../lib/dao/levels';
import { RunDao } from '../../lib/dao/runs';

import * as api from '../';
import * as api_response from '../response';

import Debug from 'debug';
import { GameDao } from '../../lib/dao/games';
const debug = Debug('api:runs');

const router = Router();

async function get_latest_runs(req: Request, res: Response) {
    let start = 0;
    const verified = req.query.verified !== 'false';
    const list_name = <string>req.query.list;

    if (req.query.start) {
        start = parseInt(<string>req.query.start);
    }

    let end = start + api.config!.api.maxItems - 1;
    if (req.query.count) {
        end = start + parseInt(<string>req.query.count) - 1;
    }

    if (isNaN(start) || start < 0) {
        return api_response.error(res, api_response.err.INVALID_PARAMS(['start']));
    }

    if (isNaN(end) || end < start || end - start + 1 > api.config!.api.maxItems) {
        return api_response.error(res, api_response.err.INVALID_PARAMS(['count']));
    }

    try {
        let runs;
        if(list_name) {
            runs =  await new RunDao(api.storedb!, { max_items: api.config!.api.maxItems })
                .load_latest_runs(start, <string>req.params.id || <string>req.query.id, list_name);
        }
        else {
            // compatibility
            runs = await new RunDao(api.storedb!, { max_items: api.config!.api.maxItems })
                .load_latest_runs(start, <string>req.params.id || <string>req.query.id, verified ? 'latest_verified_runs' : 'latest_new_runs');
        }

        return api_response.complete(res, runs, {
            code: (end + 1).toString(),
            total: 100000,
        });
    } catch (err) {
        debug('api/runs: could not send latest runs:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
}

router.get('/latest/genre/:id', (req, res) => get_latest_runs(req, res));
router.get('/latest', (req, res) => get_latest_runs(req, res));

// endpoint to retrieve speedruns awaiting moderation for a moderator
router.get('/new/:mod', async(req, res) => {

    const mod_id = req.params.mod;

    const start = <string|undefined>req.query.start;

    try {
        const games = await new GameDao(api.storedb!)
            .load_for_mod(mod_id);
    
        const runs = await new RunDao(api.storedb!, { max_items: api.config!.api.maxItems })
            .load_new_in_games(_.map(games, 'id'), start);

        return api_response.complete(res, runs);
    } catch(err) {
        debug('api/runs: could not send runs from list for mod:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

// retrieve one or more runs by id
router.get('/:ids', async (req, res) => {
    const ids = req.params.ids.split(',');

    if (ids.length > api.config!.api.maxItems) {
        return api_response.error(res, api_response.err.TOO_MANY_ITEMS());
    }

    try {
        const runs = await new RunDao(api.storedb!).load(ids);

        // load full category/level data if this run is the only one
        if (ids.length === 1 && !_.isNil(runs[0])) {
            runs[0]!.run.category = (await new CategoryDao(api.storedb!).load(runs[0]!.run.category.id))[0];
            if (runs[0]!.run.level) {
            runs[0]!.run.level = (await new LevelDao(api.storedb!).load(runs[0]!.run.level.id))[0];
            }
        }

        return api_response.complete(res, runs);
    } catch (err) {
        debug('api/runs: could not send runs from list:', err);
        return api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
});

module.exports = router;
