// Maintains an updated list of streams from twitch by polling

import * as _ from 'lodash'

import got_up from '../lib/request';

import * as querystring from 'querystring';

import { StreamDao, Stream } from '../lib/dao/streams';
import { UserDao, User, user_to_bulk } from '../lib/dao/users';

import { GameDao, Game, extract_game_group_ids, game_to_bulk } from '../lib/dao/games';
import { CursorData, Sched } from '../sched/index';

import { load_config } from '../lib/config';

const config = load_config();

const TWITCH_STREAMS_URL = 'https://api.twitch.tv/helix/streams'
const TWITCH_GAMES_URL = 'https://api.twitch.tv/helix/games/top'
const TWITCH_ID_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

const TWITCH_STREAMS_BATCH_SIZE = 80;

let TWITCH_BEARER_TOKEN = '';
let TWITCH_BEARER_UPDATED = 0;

const got = got_up.extend({
    hooks: {
        beforeRequest: [
            async options => {
                if(TWITCH_BEARER_UPDATED < Date.now() - 20 * 60 * 1000) {
                    await refresh_token();
                }

                options.headers['Client-ID'] = config.twitch?.token;
                options.headers['Authorization'] = `Bearer ${TWITCH_BEARER_TOKEN}`;
            }
        ]
    }
})

interface TwitchRawGame {
    id: string;
    name: string;
}

interface TwitchRawStream {
    id: string;
    online: boolean;
    data: Stream|null;
}

export function extract_user_twitch_login(twitch_url: string|undefined) {
    if(!twitch_url)
        return null

    const m = twitch_url.match(/twitch.(tv|com)\/([^?/]*)/)
    if(!m)
        return null

    if(!m[2].match(/^[a-zA-Z0-9_]{4,25}$/) || m[2][0] === '_')
        return null

    return m[2]
}

async function refresh_token() {
    const twitch_response = await got_up.post(TWITCH_ID_TOKEN_URL, {
        searchParams: {
            client_id: config.twitch!!.token,
            client_secret: config.twitch!!.secret,
            grant_type: 'client_credentials'
        }
    });

    TWITCH_BEARER_TOKEN = (<any>twitch_response.body).access_token;
    TWITCH_BEARER_UPDATED = Date.now();
}

async function poll_stream_statuses(game_dao: GameDao, user_dao: UserDao, user_logins: { user_id: string, user_login: string}[]): Promise<Stream[]> {
    //const qs = user_logins.map(ul => 'user_login=' + encodeURIComponent(ul.user_login)).join('&') + '&first=100'

    const keyed_logins = _.keyBy(user_logins, v => v.user_login.toLowerCase())

    const raw_streams = (await got.get<{data: Stream[] }>(TWITCH_STREAMS_URL + '?' + querystring.stringify({
        first: 100,
        user_login: _.map(user_logins, 'user_login')
    }), {})).body.data;

    if(!raw_streams.length)
        return [];

    // get the games corresponding to all these streams
    const mapped_games = await game_dao.load_by_index('twitch_id', _.map(raw_streams, 'game_id'))
    const mapped_users = await user_dao.load(_.map(raw_streams, (rs) => {
        const kl = rs ? keyed_logins[(<string>rs.user_name).toLowerCase()] : null;
        if(!kl)
            // this can cometimes happen
            return 'bogus';
        
        return kl.user_id;
    }));

    return _.filter(_.zipWith(raw_streams, mapped_games, mapped_users, (rs: Stream|null, game: Game|null, user: User|null) => {
        if(!user)
            return null;
        
        if(!rs)
            return null;

        return {
            user: user ? user_to_bulk(user) : null,
            user_name: rs.user_name,
            game: game ? game_to_bulk(game) : null,
            gg_ids: game ? extract_game_group_ids(game) : [],
            title: rs.title,
            viewer_count: rs.viewer_count,
            language: rs.language,
            thumbnail_url: rs.thumbnail_url,
            started_at: rs.started_at
        }
    }), _.isObject) as Stream[];
}

export async function generate_twitch_games(_sched: Sched, cur: CursorData<TwitchRawGame>|null): Promise<CursorData<TwitchRawGame>|null> {
    await refresh_token();

    const params: any = { first: 100 };

    if(cur?.pos)
        params.after = cur.pos


    const twitchResponse = await got.get<{ data: TwitchRawGame[], pagination: any }>(TWITCH_GAMES_URL, {
        searchParams: params
    });

    return {
        items: twitchResponse.body.data,
        asOf: Date.now(),
        desc: `twitch games ${twitchResponse.body.pagination.cursor}`,
        done: (cur?.done || 0) + twitchResponse.body.data.length,
        total: 0,
        pos: twitchResponse.body.pagination.cursor ? twitchResponse.body.pagination.cursor.toString() : null
    };
}

export async function apply_twitch_games(sched: Sched, cur: CursorData<TwitchRawGame>) {
    const game_dao = new GameDao(sched.storedb);

    const save_games: Game[] = [];

    for(const game of cur.items) {
        // find the game in our db by name
        const best_game = (await game_dao.load_by_index('autocomplete', game.name.toLowerCase()))[0];

        if(!best_game) {
            //console.log('[TWITCH] cannot map twitch game:', game.name, game.id);
            continue;
        }

        //console.log(`[TWITCH] ${best_game.id} is ${game.id} (${game.name})`)
        best_game.twitch_id = game.id;
        save_games.push(best_game);
    }

    if(save_games.length)
        await game_dao.save(save_games);
}

export async function generate_all_twitch_streams(sched: Sched, cur: CursorData<TwitchRawStream>|null): Promise<CursorData<TwitchRawStream>|null> {
    await refresh_token();

    const game_dao = await new GameDao(sched.storedb!);
    const user_dao = await new UserDao(sched.storedb!);

    const [pos, users] = await user_dao.scanOnce({batchSize: TWITCH_STREAMS_BATCH_SIZE, cur: cur?.pos });

    let user_logins: { user_id: string, user_login: string}[] = []

    for(let user of users) {
        const user_login = extract_user_twitch_login(user.twitch ? user.twitch!.uri : undefined)
        if(!user_login)
            continue;
        
        user_logins.push({ user_login, user_id: user.id })
    }

    const items = (await poll_stream_statuses(game_dao, user_dao, user_logins)).map((ss: Stream) => {
        return {
            id: ss.user.id,
            online: true,
            data: ss
        }
    });

    return {
        items: items,
        asOf: Date.now(),
        done: (cur?.done || 0) + items.length,
        total: 0,
        desc: 'scan twitch streams',
        pos: pos
    };
}

export async function generate_running_twitch_streams(sched: Sched, cur: CursorData<TwitchRawStream>|null): Promise<CursorData<TwitchRawStream>|null> {
    await refresh_token();

    const game_dao = await new GameDao(sched.storedb!);
    const user_dao = await new UserDao(sched.storedb!);
    const stream_dao = await new StreamDao(sched.storedb!);

    const [pos, streams] = await stream_dao.scanOnce({batchSize: TWITCH_STREAMS_BATCH_SIZE, cur: cur?.pos });

    const newStreams = _.keyBy(await poll_stream_statuses(game_dao, user_dao, _.filter(_.map(streams, s => {
        return {
            user_login: s.user_name,
            user_id: s.user.id
        }
    }))), 'user.id');


    const streamStatuses: TwitchRawStream[] = streams.map((s: Stream) => {
        return {
            id: s.user.id,
            online: !!newStreams[s.user.id],
            data: newStreams[s.user.id]
        }
    });

    return {
        items: streamStatuses,
        asOf: Date.now(),
        desc: 'scan twitch streams',
        done: (cur?.done || 0) + streamStatuses.length,
        total: await stream_dao.count(),
        pos: pos
    };
}

export async function apply_twitch_streams(sched: Sched, cur: CursorData<TwitchRawStream>) {
    
    const [setStreams, delStreams] = _.partition(cur.items, 'online');
    
    if (delStreams.length)
        await new StreamDao(sched.storedb!).remove(_.map(delStreams, 'id'));

    if (setStreams.length)
        await new StreamDao(sched.storedb!).save(<Stream[]>_.map(setStreams, 'data'));
}