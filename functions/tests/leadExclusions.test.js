'use strict';

/**
 * Lead definition exclusions — the Market Definition's excludedBusinessTypes is a PROMISE, and
 * before this module it was display-only: the 8/23 Atlanta retail reports rendered "Excluded:
 * chain retailer, big box store, online only, wholesale supplier" while HomeGoods (a national
 * chain) sat at qualified lead #1 with 0 reviews and Floor & Decor — the report's own named
 * market leader — at lead #3.
 *
 * Direction of fail-closed here: exclusion requires POSITIVE identification (category match,
 * pack-curated chain, or multi-location evidence from this run's discovery). An unknown local
 * business is always kept.
 */

const fs = require('fs');
const path = require('path');
const {
    buildChainEvidence, classifyLeadExclusion, applyLeadExclusions, definitionExcludesChains
} = require('../services/leadExclusions');
const { resolveDefinitionEntry } = require('../utils/marketDefinitionBuilder');
const { resolveQuestionPack } = require('../services/questionPacks');

const RETAIL_EXCLUDED = ['chain retailer', 'big box store', 'online only', 'wholesale supplier'];
const NO_CHAIN_EXCLUDED = ['auto dealership', 'car wash', 'auto parts store'];

describe('definitionExcludesChains: the gate on chain-based exclusion', () => {
    test('retail-style lists gate ON; auto-repair-style lists gate OFF', () => {
        expect(definitionExcludesChains(RETAIL_EXCLUDED)).toBe(true);
        expect(definitionExcludesChains(NO_CHAIN_EXCLUDED)).toBe(false);
        expect(definitionExcludesChains([])).toBe(false);
    });
});

describe('buildChainEvidence: multi-location vs multi-query', () => {
    test('the same store returned by several queries is ONE location, not a chain', () => {
        const raw = Array.from({ length: 8 }, () => ({ name: 'HomeGoods', address: '123 Peach St', reviewCount: 719, rating: 4.5 }));
        expect(buildChainEvidence(raw).get('homegoods')).toBe(1);
    });

    test('the same name at distinct addresses is counted as distinct locations', () => {
        const raw = [
            { name: 'HomeGoods', address: '123 Peach St', reviewCount: 719 },
            { name: 'HomeGoods', address: '9 Ponce Ave', reviewCount: 0 }
        ];
        expect(buildChainEvidence(raw).get('homegoods')).toBe(2);
    });

    test('without addresses, contradictory metrics for one name still evidence two locations', () => {
        // The 8/23 shape: competitor "HomeGoods" 4.5★/719 reviews vs lead "HomeGoods" 0 reviews.
        const raw = [
            { name: 'HomeGoods', reviewCount: 719, rating: 4.5 },
            { name: 'HomeGoods', reviewCount: 0, rating: null }
        ];
        expect(buildChainEvidence(raw).get('homegoods')).toBe(2);
    });
});

describe('classifyLeadExclusion: positive identification only', () => {
    const ctx = (over) => Object.assign({
        excludedTypes: RETAIL_EXCLUDED,
        chainEvidence: new Map(),
        knownChains: []
    }, over || {});

    test('the production case: HomeGoods lead excluded on multi-location evidence', () => {
        const evidence = buildChainEvidence([
            { name: 'HomeGoods', reviewCount: 719, rating: 4.5 },
            { name: 'HomeGoods', reviewCount: 0 }
        ]);
        const v = classifyLeadExclusion({ name: 'HomeGoods', reviewCount: 0 }, ctx({ chainEvidence: evidence }));
        expect(v).not.toBeNull();
        expect(v.reason).toBe('multi_location');
    });

    test('the production case: Floor & Decor excluded as a pack-curated chain', () => {
        const v = classifyLeadExclusion({ name: 'Floor & Decor', reviewCount: 1315 },
            ctx({ knownChains: ['Floor & Decor', 'HomeGoods'] }));
        expect(v).not.toBeNull();
        expect(v.reason).toBe('curated_chain');
    });

    test('curated matching uses the normalized name (punctuation/case-insensitive)', () => {
        const v = classifyLeadExclusion({ name: 'floor decor' }, ctx({ knownChains: ['Floor & Decor'] }));
        expect(v && v.reason).toBe('curated_chain');
    });

    test('"Discount Homegoods" is NOT HomeGoods: exact normalized-name match only', () => {
        const evidence = buildChainEvidence([
            { name: 'HomeGoods', address: 'a' }, { name: 'HomeGoods', address: 'b' }
        ]);
        expect(classifyLeadExclusion({ name: 'Discount Homegoods', reviewCount: 68 },
            ctx({ chainEvidence: evidence, knownChains: ['HomeGoods'] }))).toBeNull();
    });

    test('category match fires independent of chain gating', () => {
        const v = classifyLeadExclusion({ name: 'Atlanta Decor Depot', category: 'Wholesale supplier' }, ctx());
        expect(v && v.reason).toBe('category_match');
    });

    test('fail-closed: an unknown single-location local business is kept, even with 0 reviews', () => {
        expect(classifyLeadExclusion({ name: 'Home decor secret', reviewCount: 0 }, ctx())).toBeNull();
    });

    test('a definition WITHOUT chain-like exclusions keeps chain leads (franchisees are prospects)', () => {
        const evidence = buildChainEvidence([
            { name: 'Midas', address: 'a' }, { name: 'Midas', address: 'b' }
        ]);
        expect(classifyLeadExclusion({ name: 'Midas' },
            ctx({ excludedTypes: NO_CHAIN_EXCLUDED, chainEvidence: evidence, knownChains: ['Midas'] }))).toBeNull();
    });

    test('an EMPTY exclusion list excludes nothing at all', () => {
        expect(classifyLeadExclusion({ name: 'HomeGoods', category: 'chain retailer' },
            ctx({ excludedTypes: [] }))).toBeNull();
    });
});

describe('applyLeadExclusions: the receipt', () => {
    test('kept and excluded partition the input; each exclusion carries name+reason+evidence', () => {
        const evidence = buildChainEvidence([
            { name: 'HomeGoods', address: 'a' }, { name: 'HomeGoods', address: 'b' }
        ]);
        const { kept, excluded } = applyLeadExclusions(
            [{ name: 'HomeGoods' }, { name: 'Discount Homegoods' }, { name: 'Home decor secret' }],
            { excludedTypes: RETAIL_EXCLUDED, chainEvidence: evidence, knownChains: [] }
        );
        expect(kept.map(l => l.name)).toEqual(['Discount Homegoods', 'Home decor secret']);
        expect(excluded).toEqual([
            { name: 'HomeGoods', reason: 'multi_location', evidence: expect.stringContaining('2 distinct locations') }
        ]);
    });

    test('null/empty input never throws', () => {
        expect(applyLeadExclusions(null, { excludedTypes: RETAIL_EXCLUDED })).toEqual({ kept: [], excluded: [] });
    });
});

describe('one entry, two consumers: enforcement reads the SAME lists the card displays', () => {
    test('resolveDefinitionEntry for Retail yields the exact excluded list the card renders', () => {
        const entry = resolveDefinitionEntry('Retail', 'Home Goods & Decor', 'home_goods_decor');
        expect(entry).not.toBeNull();
        expect(entry.excludedBusinessTypes).toEqual(RETAIL_EXCLUDED);
    });

    test('a market with no lookup entry resolves null: no promised exclusions, nothing enforced', () => {
        expect(resolveDefinitionEntry('Completely Unknown Industry', '', '')).toBeNull();
    });
});

describe('pack curation: retail carries knownChains through the sub→industry cascade', () => {
    test('home_goods_decor (no sub pack) resolves to the retail industry pack with knownChains', () => {
        const pack = resolveQuestionPack('home_goods_decor', 'retail');
        expect(pack).not.toBeNull();
        expect(Array.isArray(pack.leadExclusions && pack.leadExclusions.knownChains)).toBe(true);
        expect(pack.leadExclusions.knownChains).toEqual(
            expect.arrayContaining(['HomeGoods', 'Floor & Decor', 'T.J. Maxx & HomeGoods', 'IKEA', 'Target'])
        );
    });

    test('general_merchandise (has a sub pack) carries the same curation', () => {
        const pack = resolveQuestionPack('general_merchandise', 'retail');
        expect(pack.leadExclusions.knownChains).toEqual(expect.arrayContaining(['HomeGoods', 'Walmart']));
    });

    test('non-retail packs carry no knownChains (chain gating stays off for them)', () => {
        const auto = resolveQuestionPack('auto_repair', 'automotive');
        expect(auto.leadExclusions).toBeUndefined();
    });
});

describe('wiring source-shape guards', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'market.js'), 'utf8');

    test('enforcement runs against serperLeads in the pipeline', () => {
        expect(src).toMatch(/applyLeadExclusions\(serperLeads/);
    });

    test('the excluded set is persisted on leadQualification (the receipt reaches the report)', () => {
        expect(src).toMatch(/excludedByDefinition: leadDefinitionExclusions/);
    });

    test('enforcement resolves the definition entry with the SAME args as the card builder', () => {
        expect(src).toMatch(/resolveDefinitionEntry\(\s*displayIndustryName \|\| industry \|\| '', subIndustry \|\| '', subIndustryConfig\?\.id \|\| ''\)/);
    });
});
