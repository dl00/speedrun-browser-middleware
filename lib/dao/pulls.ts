import * as _ from 'lodash';

import { Dao } from './';

import { DB } from '../db';

export interface Pull {
    api_url: string;
    data: any;
    timestamp: Date;
}

export class PullDao extends Dao<Pull> {
    constructor(db: DB) {
        super(db, 'pulls', 'mongo');

        this.id_key = _.property('api_url');
    }
}
