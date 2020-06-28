import * as _ from 'lodash';

import { Router, Request, Response } from 'express';

import { StreamDao } from '../../lib/dao/streams';

import * as api from '..';
import * as api_response from '../response';

const router = Router();

async function get_game_group_streams(req: Request, res: Response) {
    let gg_id: string|null = req.params.ggId as string|null;
    let lang: string|null = req.params.lang as string|null;
    let start = 0;

    if (req.query.start) {
        start = parseInt(req.query.start);
    }

    if(!gg_id || gg_id === 'site')
        gg_id = null;
    
    if(!lang)
        lang = null;

    const stream_dao = new StreamDao(api.storedb!, { max_items: api.config!.api.maxItems });

    try {
        const ggs = _.reject(await stream_dao.load_popular_game_group(start, gg_id, lang), _.isNil);
        
        return api_response.complete(res, ggs);
    } catch (err) {
        console.log('api/streams: could not get top list:', err);
        api_response.error(res, api_response.err.INTERNAL_ERROR());
    }
}

// retrieves a list of streams from most viewers to least viewers
router.get('/game-groups/:ggId/:lang', get_game_group_streams);
router.get('/game-groups/:ggId', get_game_group_streams);
router.get('/:lang', get_game_group_streams);
router.get('/', get_game_group_streams);

module.exports = router;
