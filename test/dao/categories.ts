import { standard_sort_categories } from '../../lib/dao/categories';

import { expect } from 'chai';

import 'mocha';

describe('standard_sort_categories', () => {
    it('should give precedence to standard categories over all else', () => {
        const sorted = standard_sort_categories([
            { id: 'arst', name: 'Any%', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst3', name: 'Some other category', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst2', name: '100%', type: 'per-game', weblink: '', miscellaneous: false },
        ]);

        expect(sorted[0].name).to.eql('Any%');
        expect(sorted[1].name).to.eql('100%');
        expect(sorted[2].name).to.eql('Some other category');
    });

    it('should sort alphabetically almost', () => {
        const sorted = standard_sort_categories([
            { id: 'arst', name: 'Any%', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst2', name: 'Any% Fun', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst3', name: 'Any% Additive', type: 'per-game', weblink: '', miscellaneous: false },
        ]);

        expect(sorted[0].name).to.eql('Any%');
        expect(sorted[1].name).to.eql('Any% Additive');
        expect(sorted[2].name).to.eql('Any% Fun');
    });

    it('should sort miscellaneous and levels last', () => {
        const sorted = standard_sort_categories([
            { id: 'arst2', name: '1357 Some other category', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst', name: 'Low%', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst3', name: 'Any%', type: 'per-game', weblink: '', miscellaneous: true },
            { id: 'arst4', name: 'Any% Wohoo', type: 'per-level', weblink: '', miscellaneous: false },
        ]);

        expect(sorted[0].name).to.eql('1357 Some other category');
        expect(sorted[1].name).to.eql('Low%');
        expect(sorted[2].name).to.eql('Any% Wohoo');
        expect(sorted[3].name).to.eql('Any%');

    });

    it('should sort numerical categories', () => {
        const sorted = standard_sort_categories([
            { id: 'arst1', name: '16', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst2', name: '2048', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst3', name: '32', type: 'per-game', weblink: '', miscellaneous: false },
            { id: 'arst4', name: '2', type: 'per-game', weblink: '', miscellaneous: false },
        ]);

        expect(sorted[0].name).to.eql('2');
        expect(sorted[1].name).to.eql('16');
        expect(sorted[2].name).to.eql('32');
        expect(sorted[3].name).to.eql('2048');
    });
});
