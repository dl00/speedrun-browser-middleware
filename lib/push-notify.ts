import * as _ from 'lodash';

// have to import this the old way because TS freaks out with bluebird here.
/* eslint @typescript-eslint/no-var-requires: "off" */
const fb_admin = require('firebase-admin');

import { load_config } from '../lib/config';

import { Category, category_to_bulk } from '../lib/dao/categories';
import { Game, game_to_bulk } from '../lib/dao/games';
import { Level, level_to_bulk } from '../lib/dao/levels';
import { NewRecord, Run, run_to_bulk } from '../lib/dao/runs';
import { User } from '../lib/dao/users';

import Debug from 'debug';
const debug = Debug('push-notify');

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

export async function notify_game_record(record: NewRecord, game: Game, category: Category, level?: Level|null): Promise<boolean> {

    const GAME_RECORD_TOPIC = `${config.stackName}_game_${game.id}_${category.id}${level ? '_' + level.id : ''}`;
    
    if (!config.pushNotify.enabled) {
        debug(`notify (dry) ${GAME_RECORD_TOPIC}`);
        return false;
    }
    else {
        debug(`notify ${GAME_RECORD_TOPIC}`);
    }

    const run_notification_data: RecordNotificationData = build_record_notification_data(record, game, category, level);
    debug(`notify ${GAME_RECORD_TOPIC}`);

    try {
        await fb_admin.messaging().sendToTopic(GAME_RECORD_TOPIC, {
            data: run_notification_data as {[key: string]: string},
        });
    } catch (e) {
        debug('failed to send push notification: %O', e);
        return false;
    }

    return true;
}

export async function notify_player_record(record: NewRecord, player: User, game: Game, category: Category, level?: Level|null): Promise<boolean> {

    const PLAYER_RECORD_TOPIC = `${config.stackName}_player_${player.id}`;

    if (!config.pushNotify.enabled) {
        debug(`notify (dry) ${PLAYER_RECORD_TOPIC}`);
        return false;
    }
    else {
        debug(`notify ${PLAYER_RECORD_TOPIC}`);
    }

    const run_notification_data: RecordNotificationData = build_record_notification_data(record, game, category, level);

    try {
        await fb_admin.messaging().sendToTopic(PLAYER_RECORD_TOPIC, {
            data: run_notification_data as {[key: string]: string},
        });
    } catch (e) {
        debug('failed to send push notification %O %O', e, run_notification_data);
        return false;
    }

    return true;
}