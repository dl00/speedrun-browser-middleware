import * as _ from 'lodash';

import * as util from 'util';

export function generate_unique_id(length: number) {

    // base58 character set. From bitcoin.
    let CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let code = '';
    for (let i = 0; i < length; i++) {
        code += CHARSET.charAt(_.random(CHARSET.length - 1));
    }
    return code;
}

export async function sleep(time: number) {
    await util.promisify(setTimeout)(time)
}