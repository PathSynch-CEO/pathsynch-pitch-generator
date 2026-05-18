'use strict';

const {
    validateSubindustry,
    normalizeHeadcount,
    inferHiringSignal,
    parseGeminiResponse,
    escapeCSVField,
    EnrichRequestSchema,
    PATHSYNCH_INDUSTRY_TAXONOMY,
    AsyncEnrichRequestSchema,
    MAX_ASYNC_LEADS
} = require('../geminiLeadEnricher');

test('geminiLeadEnricher — all unit tests pass', () => {
    let passed = 0;
    let failed = 0;

    function assert(condition, label, got, expected) {
        if (condition) {
            passed++;
        } else {
            console.log(`❌ ${label}`);
            console.log(`   got:      ${JSON.stringify(got)}`);
            console.log(`   expected: ${JSON.stringify(expected)}`);
            failed++;
        }
    }

    // ─── validateSubindustry ──────────────────────────────────────────────────────
    const subTests = [
        ['Automotive > Auto Repair Shops',                    'Automotive > Auto Repair Shops'],
        ['automotive > auto repair shops',                    'Automotive > Auto Repair Shops'],
        ['Automotive > Auto Shops',                           'Automotive > Auto Repair Shops'],
        ['Wrong Category > Dental Practices',                 'Healthcare > Dental Practices'],
        ['Other > SaaS Platform',                             'Other > SaaS Platform'],
        [null,                                                'Other > Uncategorized'],
        ['Insurance > Independent Insurance Agents',          'Insurance > Independent Insurance Agents'],
        ['Insurance > captive insurance agents',              'Insurance > Captive Insurance Agents'],
        ['Professional Services > Insurance Agencies',        'Other > Insurance Agencies'],
    ];

    for (const [input, expected] of subTests) {
        const result = validateSubindustry(input);
        assert(result === expected, `validateSubindustry(${JSON.stringify(input)})`, result, expected);
    }

    // ─── normalizeHeadcount ───────────────────────────────────────────────────────
    const hcTests = [
        ['11-50',               '11-50'],
        ['75',                  '51-200'],
        ['about 250 employees', '201-500'],
        [null,                  'unknown'],
        ['10',                  '1-10'],
        ['11',                  '11-50'],
        ['unknown',             'unknown'],
    ];

    for (const [input, expected] of hcTests) {
        const result = normalizeHeadcount(input);
        assert(result === expected, `normalizeHeadcount(${JSON.stringify(input)})`, result, expected);
    }

    // ─── inferHiringSignal ────────────────────────────────────────────────────────
    const hsTests = [
        [[],         'none'],
        [[{}],       'moderate'],
        [[{}, {}],   'moderate'],
        [[{},{},{}], 'active'],
        [null,       'none'],
    ];

    for (const [input, expected] of hsTests) {
        const result = inferHiringSignal(input);
        assert(result === expected, `inferHiringSignal(${JSON.stringify(input)})`, result, expected);
    }

    // ─── parseGeminiResponse ──────────────────────────────────────────────────────
    const validJSON = JSON.stringify({
        company_description: 'Test company does things. They serve people and are different.',
        subindustry:         'Automotive > Auto Repair Shops',
        job_listings:        [{ title: 'Mechanic', source: 'indeed' }],
        hiring_signal:       'moderate',
        headcount_range:     '11-50'
    });

    const r1 = parseGeminiResponse(validJSON);
    assert(r1.parseMode === 'strict', `Strict parse (no extra fields)`, r1.parseMode, 'strict');

    const extraFields = JSON.stringify({
        company_description: 'Test company does things. They serve people.',
        subindustry:         'Automotive > Auto Repair Shops',
        job_listings:        [],
        hiring_signal:       'none',
        headcount_range:     '1-10',
        extra_field:         'should trigger lenient'
    });
    const r2 = parseGeminiResponse(extraFields);
    assert(r2.parseMode === 'lenient', `Lenient parse (extra field present)`, r2.parseMode, 'lenient');

    const r3 = parseGeminiResponse('not json at all');
    assert(r3.parseMode === 'failed', `Failed parse (no JSON)`, r3.parseMode, 'failed');

    const r4 = parseGeminiResponse('```json\n' + validJSON + '\n```');
    assert(r4.parseMode === 'strict', `Markdown fence stripped → strict`, r4.parseMode, 'strict');

    // ─── escapeCSVField ───────────────────────────────────────────────────────────
    const csvTests = [
        ['hello',           '"hello"'],
        ['Smith, Jones',    '"Smith, Jones"'],
        ['He said "hi"',   '"He said ""hi"""'],
        [null,              '""'],
    ];

    for (const [input, expected] of csvTests) {
        const result = escapeCSVField(input);
        assert(result === expected, `escapeCSVField(${JSON.stringify(input)})`, result, expected);
    }

    // ─── Insurance taxonomy ───────────────────────────────────────────────────────
    const hasInsurance = 'Insurance' in PATHSYNCH_INDUSTRY_TAXONOMY;
    assert(hasInsurance, 'Insurance is a top-level category', hasInsurance, true);

    const proSvcHasInsurance = (PATHSYNCH_INDUSTRY_TAXONOMY['Professional Services'] || [])
        .some(s => s.toLowerCase().includes('insurance'));
    assert(!proSvcHasInsurance, 'Insurance removed from Professional Services', proSvcHasInsurance, false);

    // ─── Schema validation ────────────────────────────────────────────────────────
    const validReq = EnrichRequestSchema.safeParse({ leads: [{ company_name: 'Test Corp' }] });
    assert(validReq.success, 'Valid request passes', validReq.success, true);

    const tooMany = EnrichRequestSchema.safeParse({ leads: Array(101).fill({ company_name: 'X' }) });
    assert(!tooMany.success, '>100 leads rejected (sync)', tooMany.success, false);

    const noIdentifier = EnrichRequestSchema.safeParse({ leads: [{ city: 'Atlanta' }] });
    assert(!noIdentifier.success, 'Lead without domain AND company_name rejected', noIdentifier.success, false);

    // ─── Async Schema Validation ──────────────────────────────────────────────────
    const asyncValid = AsyncEnrichRequestSchema.safeParse({ leads: Array(500).fill({ company_name: 'X' }) });
    assert(asyncValid.success, '500 leads accepted (async)', asyncValid.success, true);

    const asyncTooMany = AsyncEnrichRequestSchema.safeParse({ leads: Array(1001).fill({ company_name: 'X' }) });
    assert(!asyncTooMany.success, '>1000 leads rejected (async)', asyncTooMany.success, false);

    assert(MAX_ASYNC_LEADS === 1000, 'MAX_ASYNC_LEADS is 1000', MAX_ASYNC_LEADS, 1000);

    const asyncDefaultConcurrency = AsyncEnrichRequestSchema.safeParse({ leads: [{ company_name: 'X' }] });
    assert(asyncDefaultConcurrency.success && asyncDefaultConcurrency.data.concurrency === 5, 'Default concurrency is 5', asyncDefaultConcurrency.data?.concurrency, 5);

    // ─── Summary ──────────────────────────────────────────────────────────────────
    console.log(`=== ALL TESTS COMPLETE: ${passed} passed, ${failed} failed ===`);
    expect(failed).toBe(0);
});
