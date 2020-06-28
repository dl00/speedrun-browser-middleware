import * as _ from 'lodash';

/// Constants and type definitions for the speedrun.com api
/// Docs: https://github.com/speedruncomorg/api/blob/master/version1/games.md#bulkaccess

export const API_PREFIX = 'https://www.speedrun.com/api/v1';

export interface BaseUpstream {
    links?: Asset[];
}

export interface UpstreamData<T> {
    data: T[];
}

export function normalize(d: BaseUpstream) {
    // remove unnecessary links which we do not use
    delete d.links;
}

export interface BaseMiddleware extends BaseUpstream {
    updated?: string;
}

export interface Names {
    international: string;
    [index: string]: string|null;
}

export interface Asset {
    uri: string;
    rel?: string;
    width?: number;
    height?: number;
}

export interface Variable extends BaseMiddleware {
    id: string;
    'is-subcategory'?: boolean;
    obsoletes?: boolean;
    values: any;
}

export interface Platform {
    id: string;
    name: string;
    released: number;
}

export interface Region {
    id: string;
    name: string;
}

export interface Developer {
    id: string;
    name: string;
}

export interface Publisher {
    id: string;
    name: string;
}

export interface Genre {
    id: string;
    name: string;
}
