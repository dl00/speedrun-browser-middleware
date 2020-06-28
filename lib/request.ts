import got from 'got';

export default got.extend({
    responseType: 'json',
    headers: { 'User-Agent': 'SpeedrunAndroidMiddlewareSchedV2 (report@danb.email)' }
});