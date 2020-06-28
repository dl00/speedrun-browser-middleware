import * as _ from 'lodash';
import * as moment from 'moment';

import { Dao, DaoConfig, IndexDriver, IndexerIndex } from './';

import { DB } from '../db';

import { RedisMapIndex } from './backing/redis';

import { Category } from './categories';
import { RunDao } from './runs';
import { Level } from './levels';

import { Asset,
    BaseMiddleware,
    Names,
    normalize,
    Platform,
    Developer,
    Publisher,
    Region,
    Genre,
    UpstreamData,
} from '../speedrun-api';

import assert = require('assert');

export interface BulkGame {
    id: string;
    names: Names;
    abbreviation: string;
    weblink: string;
    assets: BulkGameAssets;
    developers: string[]|UpstreamData<Developer>|Developer[];
    publishers: string[]|UpstreamData<Publisher>|Publisher[];
    platforms: string[]|UpstreamData<Platform>|Platform[];
    regions: string[]|UpstreamData<Region>|Region[];
    genres: string[]|UpstreamData<Genre>|Genre[];
    'release-date': string;
}

export interface BulkGameAssets {
    'cover-large'?: Asset;
    'trophy-1st'?: Asset;
    'trophy-2nd'?: Asset;
    'trophy-3rd'?: Asset;
    'trophy-4th'?: Asset;
}

export interface GameAssets extends BulkGameAssets {
    logo?: Asset;
    'cover-tiny'?: Asset;
    'cover-small'?: Asset;
    'cover-medium'?: Asset;
    icon?: Asset;
    background?: Asset;
    foreground?: Asset;
}

export function game_assets_to_bulk(game_assets: GameAssets): BulkGameAssets {
    return _.pick(game_assets, 'cover-large', 'trophy-1st', 'trophy-2nd', 'trophy-3rd', 'trophy-4th');
}

export interface Game extends BulkGame, BaseMiddleware {
    twitch_id?: string;

    released: number;
    romhack?: boolean;
    created: string;
    assets: GameAssets;
    score?: number;

    categories?: Category[];
    levels?: Level[];
}

/// TODO: Use decorators
export function game_to_bulk(game: Game): BulkGame {
    const bulkGame: BulkGame = _.pick(game, 'id', 'names', 'abbreviation', 'weblink',
        'assets', 'platforms', 'regions', 'genres', 'developers', 'publishers', 'release-date');

    bulkGame.assets = game_assets_to_bulk(game.assets);

    return bulkGame;
}

export function normalize_game(d: Game) {
    normalize(d);

    if (d.platforms && (d.platforms as UpstreamData<Platform>).data) {
        d.platforms = (d.platforms as UpstreamData<Platform>).data;
    }

    if (d.regions && (d.regions as UpstreamData<Region>).data) {
        d.regions = (d.regions as UpstreamData<Region>).data;
    }

    if (d.genres && (d.genres as UpstreamData<Genre>).data) {
        d.genres = (d.genres as UpstreamData<Genre>).data;
    }

    if (d.publishers && (d.publishers as UpstreamData<Publisher>).data) {
        d.publishers = (d.publishers as UpstreamData<Publisher>).data;
    }

    if (d.developers && (d.developers as UpstreamData<Developer>).data) {
        d.developers = (d.developers as UpstreamData<Developer>).data;
    }

    for (const platform in d.platforms) {
        normalize((d.platforms as any)[platform]);
    }
    for (const region in d.regions) {
        normalize((d.regions as any)[region]);
    }
    for (const genre in d.genres) {
        normalize((d.genres as any)[genre]);
    }
    for (const publisher in d.publishers) {
        normalize((d.publishers as any)[publisher]);
    }
    for (const developer in d.developers) {
        normalize((d.developers as any)[developer]);
    }
}

export function extract_game_group_ids(d: Game): string[] {
    // TODO: switch to `speedrun_api.Genre[] instead of any[]`
    const groups: string[] = []
    for (const genre of d.genres as {id: string, name: string}[]) {
        groups.push(genre.id || <any>genre);
    }

    for (const platform of d.platforms as Platform[]) {
        groups.push(platform.id || <any>platform)
    }

    for (const developer of d.developers as Developer[]) {
        groups.push(developer.id || <any>developer)
    }

    for (const publisher of d.publishers as Publisher[]) {
        groups.push(publisher.id || <any>publisher);
    }

    return groups
}

class PopularGamesIndex implements IndexDriver<Game> {
    public name: string;
    private max_return: number;
    private score_func: (g: Game) => number;

    constructor(name: string, max_return: number, score_func?: (g: Game) => number) {
        this.name = name;
        this.max_return = max_return;
        this.score_func = score_func || (g => g.score || 0);
    }

    public async load(conf: DaoConfig<Game>, keys: string[]): Promise<Array<Game|null>> {
        assert.equal(keys.length, 1, 'PopularGamesIndex only supports reading from a single key at a time');

        // we only read the first
        const spl = keys[0].split(':');

        const genre = spl[0];
        const offset = parseInt(spl[1]);

        const popular_game_ids: string[] = await conf.db.redis.zrevrange(this.name + (genre ? ':' + genre : ''),
            offset, offset + this.max_return - 1);

        if (!popular_game_ids.length) {
            return [];
        }

        return await conf.load(popular_game_ids);
    }

    public async apply(conf: DaoConfig<Game>, games: Game[]) {
        // have to get games to deal with genre data
        const m = conf.db.redis.multi();

        for (const game of games) {

            const game_score = this.score_func(game);

            // install master rank list
            m.zadd(this.name, game_score.toString(), game.id);

            // install on game group lists
            for(const gg of extract_game_group_ids(game)) {
                m.zadd(this.name + ':' + gg, game_score.toString(), game.id)
            }
        }

        await m.exec();
    }

    public async clear(conf: DaoConfig<Game>, objs: Game[]) {
        const keys = _.map(objs, conf.id_key);

        await conf.db.redis.zrem(this.name,
            ...keys);
    }

    public has_changed(old_obj: Game, new_obj: Game): boolean {
        return old_obj.score != new_obj.score;
    }

    public async get_game_group_count(conf: DaoConfig<Game>, gg_ids: string[]): Promise<number[]> {

        const m = conf.db.redis.multi();

        for (const id of gg_ids) {
            m.zcard(this.name + ':' + id);
        }

        const res: Array<[any, number]> = await m.exec();

        return res.map((v) => v[1]);
    }
}

function get_game_search_indexes(game: Game) {
    const indexes: Array<{ text: string, score: number, namespace?: string }> = [];

    if (game.abbreviation) {
        indexes.push({ text: game.abbreviation.toLowerCase(), score: game.score || 1 });
    }

    for (const name in game.names) {
        if (!game.names[name]) {
            continue;
        }

        const idx: any = { text: game.names[name]!.toLowerCase(), score: game.score || 1 };
        if (name != 'international') {
            idx.namespace = name;
        }

        indexes.push(idx);
    }

    return indexes;
}

export interface GameDaoOptions {
    max_items?: number;

    game_score_time_now?: moment.Moment;
    game_score_leaderboard_updated_cutoff?: moment.Moment;
    game_score_leaderboard_edge_cutoff?: moment.Moment;
}

export class GameDao extends Dao<Game> {

    private game_score_time_now: moment.Moment;
    private game_score_leaderboard_updated_cutoff: moment.Moment;
    private game_score_leaderboard_edge_cutoff: moment.Moment;

    constructor(db: DB, options?: GameDaoOptions) {
        super(db, 'games', 'redis');

        this.id_key = _.property('id');

        let max_items = (options && options.max_items) ? options.max_items : 100;

        this.game_score_time_now = options && options.game_score_time_now ? options.game_score_time_now : moment(new Date());
        this.game_score_leaderboard_updated_cutoff = moment(this.game_score_time_now).subtract(3, 'months');
        this.game_score_leaderboard_edge_cutoff = moment(this.game_score_time_now).subtract(18, 'months');

        this.indexes = [
            new RedisMapIndex('abbr', 'abbreviation'),
            new RedisMapIndex('twitch_id', 'twitch_id'),
            new IndexerIndex('games', get_game_search_indexes),
            new PopularGamesIndex('popular_games', max_items),
            new PopularGamesIndex('popular_trending_games', max_items,
                (g) => {
                    return (g.score || 0) /
                        Math.max(49, Math.pow(this.game_score_time_now.diff(moment(g['release-date'])) / 86400000, 2))
                })
        ];

        _.assign(this, _.pick(options, 'game_score_leaderboard_edge_cutoff', 'game_score_leaderboard_updated_cutoff'));
    }

    public async save(games: Game|Game[]): Promise<void> {
        if (!_.isArray(games)) {
            games = [games];
        }

        for (const game of games) {
            // make sure every game comes in with a score
            game.score = await this.calculate_score(game);
        }

        await super.save(games);
    }

    // refreshes the score for a game by reading its leaderboards.
    // returnes the games with the score calculated
    public async rescore_games(ids: string|string[]) {
        const games = _.reject(await this.load(ids), _.isNil) as Game[];

        for (const game of games) {
            game.score = await this.calculate_score(game);
        }

        await this.save(games);

        return games;
    }

    public async load_popular(mode?: string, offset?: number, gg_id?: string) {
        const key = `${gg_id || ''}:${offset || 0}`;

        let idx = 'popular_games';
        switch (mode) {
            case 'trending':
                idx = 'popular_trending_games';
        }

        return await this.load_by_index(idx, key);
    }

    public async get_game_group_count(gg_id: string[]): Promise<number[]> {
        // TODO: this is kind of loose
        return await (this.indexes[3] as PopularGamesIndex).get_game_group_count(this, gg_id);
    }

    protected async pre_store_transform(game: Game): Promise<Game> {
        normalize_game(game);
        return game;
    }

    // calculates the score for a single game by count the number of distinct active players
    private async calculate_score(game: Game): Promise<number> {
        return await new RunDao(this.db).get_player_count({
            'run.game.id': game.id,
            'run.submitted': { $gt: this.game_score_leaderboard_updated_cutoff.toISOString() }
        }) * 6 +
        await new RunDao(this.db).get_player_count({
            'run.game.id': game.id,
            'run.submitted': { $gt: this.game_score_leaderboard_edge_cutoff.toISOString() }
        });
    }
}
