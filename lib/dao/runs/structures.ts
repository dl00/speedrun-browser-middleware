import {
    BaseMiddleware
} from '../../speedrun-api';

import { BulkGame } from '../games';
import { BulkCategory } from '../categories';
import { BulkLevel } from '../levels';
import { BulkUser } from '../users';

/// information about a new PB from a player
export interface NewRecord {
    old_run: LeaderboardRunEntry;
    new_run: LeaderboardRunEntry;
}

export interface RunTimes {
    primary: string;
    primary_t: number;
    realtime?: string | null;
    realtime_t?: number;
    realtime_noloads?: string | null;
    realtime_noloads_t?: number;
    ingame?: string | null;
    ingame_t?: number;
}

export interface RunSystem {
    platform?: string;
    emulated?: boolean;
    region?: string;
}

export interface BulkRun {
    id: string;
    date: string;
    players: BulkUser[];
    times: RunTimes;
    system: RunSystem;
    values: {[key: string]: string};

    [key: string]: any;
}

export interface Run extends BulkRun, BaseMiddleware {
    weblink: string;
    game: BulkGame|string;
    level?: BulkLevel|string|null;
    category: BulkCategory|string;
    submitted: string;
    videos: {
        text?: string
        links: Array<{
            uri: string,
        }>,
    };

    comment: string;
    status: {
        status: 'new'|'verified'|'rejected'
        examiner?: BulkUser|string
        'verify-date': string,
    };

    values: {[key: string]: string};
}

export interface LeaderboardRunEntry {
    obsolete?: boolean; // TODO: maybe a date later
    place?: number|null;
    gameGroups?: string[];
    updatedAt?: number;
    run: BulkRun;
}
