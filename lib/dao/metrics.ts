import * as _ from 'lodash';

import { Dao } from './';

import { DB } from '../db';

export interface Metric {
    value: number;
    item_id?: string;
    item_type?: string;
}

export interface StoredMetric extends Metric {
    id: string;
}

export class MetricDao extends Dao<StoredMetric> {
    constructor(db: DB) {
        super(db, 'metrics', 'redis');
    }
}
