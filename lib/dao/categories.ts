import * as _ from 'lodash';

import { DB } from '../db';

import { RedisMultiIndex } from './backing/redis';

import {
    BaseMiddleware,
    normalize,
    UpstreamData,
    Variable,
} from '../speedrun-api';

import { Dao } from './';

export interface BulkCategory {
    id: string;
    name: string;
    type: string;

    variables?: UpstreamData<Variable>|Variable[];
}

export interface Category extends BulkCategory, BaseMiddleware {
    weblink: string;
    rules?: string;
    miscellaneous: boolean;

    /// Non-standard field: the game this category is part of
    game?: string;

    /// Non-standard field: corresponds to the sort order of this category against
    /// other categories. Lower is first.
    pos?: number;
}

export function category_to_bulk(category: Category): BulkCategory {
    const ret = _.pick(category, 'id', 'name', 'type', 'variables');

    delete ret.variables;

    return ret;
}

export function normalize_category(d: Category) {
    normalize(d);

    if (d.variables && (d.variables as UpstreamData<Variable>).data) {
        d.variables = (d.variables as UpstreamData<Variable>).data;
    }

    for (const variable in d.variables) {
        normalize((d.variables as any)[variable]);
    }
}

export function standard_sort_categories(categories: Category[]) {
    // first, sort by some predefined names that should always be in the front
    return _.sortBy(categories, (c) => {
        const name = c.name.toLowerCase();

        if(!_.isNil(c.pos))
            return c.pos;

        let score = 0;

        if (name === 'any%') {
            score = 0;
        }
        else if (name.match(/^all.*/)) {
            score = 1;
 }
        else if (name === 'low%') {
            score = 2;
 }
        else if (name === '100%') {
            score = 3;
 }
        else if (name.match(/^any%/)) {
            score = 4;
 }
        else if (name.match(/^100%/)) {
            score = 5;
 }
        else if (name.match(/%$/)) {
            score = 6;
 }
        else if (name.match(/^\d+.*/)) {
            score = 1 + parseInt(name.match(/^(\d+).*/)![1]) / 1000000;
 }
        else {
            score = 7;
 }

        if (c.type !== 'per-game') {
            score += 100;
        }
        if (c.miscellaneous) {
            score += 500;
        }

        return _.padStart(score.toFixed(6), 10, '0') + name;
    });
}

export class CategoryDao extends Dao<Category> {
    constructor(db: DB) {
        super(db, 'categories', 'redis');

        this.id_key = _.property('id');

        this.indexes = [
            new RedisMultiIndex('game', 'game'),
        ];
    }

    public async apply_for_game(game_id: string, new_categories: Category[]) {
        const old_categories = await this.load_by_index('game', game_id);
        if (old_categories.length) {
            await this.remove(_.map(old_categories, 'id'));
        }

        await this.save(new_categories);
    }

    protected async pre_store_transform(obj: Category): Promise<Category> {
        normalize_category(obj);

        if(!obj.game)
            throw new Error('category is missing a game id');

        return obj;
    }
}
