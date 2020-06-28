import * as _ from 'lodash';

import * as moment from 'moment';
import request from './request';

const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIMEDIA_REST_URL = 'https://wikimedia.org/api/rest_v1';

const DATE_FORMAT = 'YYYYMMDDHH';

export interface WikipediaSearchResult {
    searchinfo: {
        totalhits: number,
    };

    search: Array<{
        title: string
        pageid: number
        wordcount: number
        snippet: string
        timestamp: string,
    }>;
}

/// Search for an article ID by name
/// Returns list of matches from wikipedia
export async function search(name: string) {
    const res = await request<{query: WikipediaSearchResult }>(WIKIPEDIA_API_URL, {
        searchParams: {
            format: 'json',
            action: 'query',
            list: 'search',
            srsearch: name,
        },
    });

    return res.body.query;
}

/// Query for the number of pageviews for an article.
/// * article: the article ID (can be searched for using autocomplete)
/// * start: a Date representing the start of the data to collect
/// * end: a Date representing the end of the data to collect
/// Returns the total number of pageviews within that date range
export async function get_pageviews(article: string, start: moment.Moment, end: moment.Moment) {
    const res = await request<{items: number[]}>(`${WIKIMEDIA_REST_URL}/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${article}/daily/${start.format(DATE_FORMAT)}/${end.format(DATE_FORMAT)}`);

    return _.sum(_.map(res.body.items, 'views'));
}
