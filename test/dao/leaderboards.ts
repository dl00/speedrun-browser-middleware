import * as _ from 'lodash';

import { correct_leaderboard_run_places, Leaderboard } from '../../lib/dao/leaderboards';

import { expect } from 'chai';

import 'mocha';

describe('correct_leaderboard_run_places', () => {
    it('should have a monotonically increasing list with no ties or subcategories', async () => {

        const lb = {
            weblink: '',
            game: '',
            category: '',
            players: {},
            runs: [
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '1'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '12T',
                            primary_t: 12,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '2'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '13T',
                            primary_t: 13,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '3'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '20T',
                            primary_t: 20,
                        },
                    },
                },
            ],
        };

        correct_leaderboard_run_places(lb, []);

        expect(lb.runs[0]).to.have.property('place', 1);
        expect(lb.runs[2]).to.have.property('place', 3);
    });

    it('should handle ties', () => {
        const lb = {
            weblink: '',
            game: '',
            category: '',
            players: {},
            runs: [
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '4'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '12T',
                            primary_t: 12,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '5'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '12T',
                            primary_t: 12,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '6'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '20T',
                            primary_t: 20,
                        },
                    },
                },
            ],
        };

        correct_leaderboard_run_places(lb, []);

        expect(lb.runs[0]).to.have.property('place', 1);
        expect(lb.runs[1]).to.have.property('place', 1);
        expect(lb.runs[2]).to.have.property('place', 3);
    });

    it('should partition subcategories', () => {
        const lb = {
            weblink: '',
            game: '',
            category: '',
            players: {},
            runs: [
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '6'}],
                        system: {},
                        values: {subc: 'one', test: 'argo'},
                        times: {
                            primary: '12T',
                            primary_t: 12,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '7'}],
                        system: {},
                        values: {subc: 'two', test: 'arlo'},
                        times: {
                            primary: '12T',
                            primary_t: 13,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '8'}],
                        system: {},
                        values: {subc: 'one', test: 'ammo'},
                        times: {
                            primary: '20T',
                            primary_t: 20,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '9'}],
                        system: {},
                        values: {subc: 'two', test: 'algo'},
                        times: {
                            primary: '20T',
                            primary_t: 21,
                        },
                    },
                },
            ],
        };

        correct_leaderboard_run_places(lb, [
            { "id": 'subc', 'is-subcategory': true, "values": []},
            { "id": 'test', 'is-subcategory': false, "values": []},
        ]);

        expect(lb.runs[0]).to.have.property('place', 1);
        expect(lb.runs[1]).to.have.property('place', 1);
        expect(lb.runs[2]).to.have.property('place', 2);
        expect(lb.runs[3]).to.have.property('place', 2);
    });

    it('should handle duplicate players', () => {
        const lb: Leaderboard = {
            weblink: '',
            game: '',
            category: '',
            players: {},
            runs: [
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '10'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '12T',
                            primary_t: 12,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '10'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '12T',
                            primary_t: 12,
                        },
                    },
                },
                {
                    run: {
                        id: 'one',
                        date: '2019-05-05',
                        players: [{id: '11'}],
                        system: {},
                        values: {},
                        times: {
                            primary: '20T',
                            primary_t: 20,
                        },
                    },
                },
            ],
        };

        correct_leaderboard_run_places(lb, []);

        expect(lb.runs[0]).to.have.property('place', 1);
        expect(lb.runs[1].place).to.not.exist;
        expect(lb.runs[2]).to.have.property('place', 2);
    });
});
