import * as _ from 'lodash';

import { Dao } from './';

import { DB } from '../db';

export interface LineChartData {
    x: number;
    y: number;
    obj: any;
}

export interface BarChartData {
    x: number;
    y: number;
}

export interface PieChartData {
    x: string;
    y: number;
}

export interface ListData {
    obj: string;
    score: number;
}

export interface Chart {
    item_id: string;
    parent_type?: string;
    item_type: string;
    aggr: string;
    chart_type: 'line'|'bar'|'pie'|'list';
    data: {[dataset: string]: Array<LineChartData|BarChartData|PieChartData|ListData>};
    timestamp: Date;
}

export class ChartDao extends Dao<Chart> {
    constructor(db: DB) {
        super(db, 'charts', 'mongo');

        this.id_key = (v) => v.item_type + '_' + v.aggr + '_' + v.item_id;
    }
}
