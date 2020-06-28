import * as _ from 'lodash';

// have to import this the old way because TS freaks out with bluebird here.
const fb_admin = require('firebase-admin');

import { load_config } from '../lib/config';

import { Category, category_to_bulk } from '../lib/dao/categories';
import { Game, game_to_bulk } from '../lib/dao/games';
import { Level, level_to_bulk } from '../lib/dao/levels';
import { NewRecord, Run, run_to_bulk } from '../lib/dao/runs';
import { User } from '../lib/dao/users';

const debug = require('debug')('sched:verbose');

const config = load_config();

if (config.pushNotify.enabled) {
    fb_admin.initializeApp({
        credential: fb_admin.credential.cert(require(config.pushNotify.credentialFile)),
    });
}

interface RecordNotificationData {
    new_run: string;
    old_run?: string;
    game: string;
    category: string;
    level?: string;
    [key: string]: string|undefined;
}

function build_record_notification_data(record: NewRecord, game: Game, category: Category, level?: Level|null): RecordNotificationData {

    record.new_run.run = run_to_bulk(record.new_run.run as Run);

    const ret: RecordNotificationData = {
        new_run: JSON.stringify(record.new_run),
        game: JSON.stringify(game_to_bulk(game)),
        category: JSON.stringify(category_to_bulk(category)),
    };

    if (record.old_run) {
        record.old_run.run = run_to_bulk(record.old_run.run as Run);
        ret.old_run = JSON.stringify(record.old_run);
    }

    if (level) {
        ret.level = JSON.stringify(level_to_bulk(level));
    }

    return ret;
}

export async function notify_game_record(record: NewRecord, game: Game, category: Category, level?: Level|null) {
    if (!config.pushNotify.enabled) {
        return false;
    }

    const GAME_RECORD_TOPIC = `${config.stackName}_game_${game.id}_${category.id}${level ? '_' + level.id : ''}`;

    const run_notification_data: RecordNotificationData = build_record_notification_data(record, game, category, level);
    debug(`notify ${GAME_RECORD_TOPIC}`);

    try {
        await fb_admin.messaging().sendToTopic(GAME_RECORD_TOPIC, {
            data: run_notification_data as {[key: string]: string},
        });
    } catch (e) {
        console.error('[ERROR] Failed to send push notification:', e);
    }

    return true;
}

export async function notify_player_record(record: NewRecord, player: User, game: Game, category: Category, level?: Level|null) {
    if (!config.pushNotify.enabled) {
        return false;
    }

    const PLAYER_RECORD_TOPIC = `${config.stackName}_player_${player.id}`;

    const run_notification_data: RecordNotificationData = build_record_notification_data(record, game, category, level);
    console.log('[NOTIF]', PLAYER_RECORD_TOPIC);

    try {
        await fb_admin.messaging().sendToTopic(PLAYER_RECORD_TOPIC, {
            data: run_notification_data as {[key: string]: string},
        });
    } catch (e) {
        console.error('[ERROR] Failed to send push notification:', e, run_notification_data);
    }
}