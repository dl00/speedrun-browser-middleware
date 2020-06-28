import { Response } from 'express';

import * as _ from 'lodash';

export interface MoreSpec {
    /// a link to a cursor which can be used to consume more data from a request
    code?: string;

    /// the number of elements available in this dataset
    total?: number;
}

export interface ErrorInfo {
    /// HTTP response code that should be used to respond with this error
    code: number;

    /// human readable description of the problem
    msg: string;
}

export function custom(res: Response, custom_data: any) {
    res.json(_.defaults({
        error: null,
    }, custom_data));
}

export function complete(res: Response, data: any[], more?: MoreSpec) {
    res.json({
        data,
        more,
        error: null,
    });
}

export function complete_single(res: Response, data: any, more?: MoreSpec) {
    res.json({
        data,
        more,
        error: null,
    });
}

export function error(res: Response, info: ErrorInfo) {
    res.status(info.code).json({
        data: [],
        error: {
            msg: info.msg,
        },
    });
}

export const err = {
    INTERNAL_ERROR: () => {
        return {
            code: 500,
            msg: 'internal server error',
        };
    },
    TOO_MANY_ITEMS: () => {
        return {
            code: 400,
            msg: 'number of requested items is too large. please reduce your request item count.',
        };
    },
    NOT_FOUND: () => {
        return {
            code: 404,
            msg: 'id does not exist',
        };
    },
    INVALID_PARAMS: (invalid: string[], hint?: string) => {
        return {
            code: 400,
            msg: `parameters are not able to be parsed or are generally invalid ${hint ? '(' + hint + ')' : ''}: ` +
                invalid.join(', '),
        };
    },
};
