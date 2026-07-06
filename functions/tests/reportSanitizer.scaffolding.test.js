'use strict';

/**
 * Regression tests for CHECK_PROMPT_SCAFFOLDING in reportSanitizer.js.
 *
 * The primary fixtures are the EXACT strings that leaked into the Abilene
 * Automotive market report (marketReports/huDSPOBIxlaoOaCPMt5T): the
 * "=== INDUSTRY-SPECIFIC INSTRUCTIONS ===" prompt scaffolding ran directly
 * into real narrative content mid-line with no paragraph break. The strip must
 * remove the scaffolding without over- or under-stripping the real content.
 */

const { sanitizeReport } = require('../utils/reportSanitizer');

const ABILENE_ES =
  'Procter Automotive dominates Abilene Automotive\n\n=== INDUSTRY-SPECIFIC INSTRUCTIONS ===\n' +
  'For the Strategic Market Thesis, frame the gap around the specific competitive dynamics — ' +
  'review volume vs quality, geographic gaps, price positioning, or underserved segments.\n\n' +
  'Use "competitors" instead of "competitors" throughout.\n' +
  'Use "opportunity gap" instead of "opportunity gap" throughout.\n' +
  'Use "qualified leads" instead of "qualified leads" throughout. with 728 reviews — 5.6x the ' +
  'market average of 129. 9 qualified leads identified with strong ratings and underdeveloped ' +
  'digital presence. The gap between reputation quality and online visibility represents a clear ' +
  'opportunity for targeted outreach. Start with Abilene Auto Doctor — 4.8★, 50 reviews, ' +
  'opportunity score 72.';

const ABILENE_CA =
  'Abilene Automotive\n\n=== INDUSTRY-SPECIFIC INSTRUCTIONS ===\n' +
  'For the Strategic Market Thesis, frame the gap around the specific competitive dynamics — ' +
  'review volume vs quality, geographic gaps, price positioning, or underserved segments.\n\n' +
  'Use "competitors" instead of "competitors" throughout.\n' +
  'Use "opportunity gap" instead of "opportunity gap" throughout.\n' +
  'Use "qualified leads" instead of "qualified leads" throughout. shows 20 competitors with ' +
  'Procter Automotive leading the field. The gap between the leader and the median represents a ' +
  'clear opening for reputation-focused outreach.';

describe('reportSanitizer — CHECK_PROMPT_SCAFFOLDING', () => {
  test('strips the actual Abilene executiveSummary leak without touching real content', () => {
    const data = { executiveSummary: ABILENE_ES, data: {} };
    sanitizeReport(data, new Date());
    const es = data.executiveSummary;

    expect(es).not.toMatch(/INDUSTRY-SPECIFIC INSTRUCTIONS/);
    expect(es).not.toMatch(/instead of/); // no-op substitution lines gone
    expect(es).toBe(
      'Procter Automotive dominates Abilene Automotive with 728 reviews — 5.6x the market average ' +
      'of 129. 9 qualified leads identified with strong ratings and underdeveloped digital ' +
      'presence. The gap between reputation quality and online visibility represents a clear ' +
      'opportunity for targeted outreach. Start with Abilene Auto Doctor — 4.8★, 50 reviews, ' +
      'opportunity score 72.'
    );
    expect(data._sanitizerHardStripped).not.toBe(true);
  });

  test('strips the actual Abilene competitorAnalysis leak without touching real content', () => {
    const data = { executiveSummary: '', data: { competitorAnalysis: ABILENE_CA } };
    sanitizeReport(data, new Date());
    expect(data.data.competitorAnalysis).toBe(
      'Abilene Automotive shows 20 competitors with Procter Automotive leading the field. The gap ' +
      'between the leader and the median represents a clear opening for reputation-focused outreach.'
    );
    expect(data._sanitizerHardStripped).not.toBe(true);
  });

  test('handles the government profile shape (Do NOT include these sections: terminal)', () => {
    const gov =
      'City Hall leads Abilene Government\n\n=== INDUSTRY-SPECIFIC INSTRUCTIONS ===\n' +
      'CRITICAL: These are government and public sector entities. De-emphasize review volume.\n\n' +
      'Use "peer entities" instead of "competitors" throughout.\n' +
      'Use "public engagement gap" instead of "opportunity gap" throughout.\n' +
      'Use "peer benchmarks" instead of "qualified leads" throughout.\n' +
      'Do NOT include these sections: Review Velocity, Promotional Offers, Customer Acquisition ' +
      'Funnel, Sales Recommendations, Pitch Hooks. with 5 reviews — well below the 129 average.';
    const data = { executiveSummary: gov, data: {} };
    sanitizeReport(data, new Date());
    const es = data.executiveSummary;
    expect(es).not.toMatch(/INDUSTRY-SPECIFIC INSTRUCTIONS/);
    expect(es).not.toMatch(/Pitch Hooks\./);
    expect(es).toBe('City Hall leads Abilene Government with 5 reviews — well below the 129 average.');
    expect(data._sanitizerHardStripped).not.toBe(true);
  });

  test('fails closed when the marker has no trailing instruction lines (hard-strip + flag)', () => {
    const weird =
      'Foo Automotive\n\n=== INDUSTRY-SPECIFIC INSTRUCTIONS ===\n' +
      'Some unrecognized injected paragraph with no trailing instruction lines.\nMore text.';
    const data = { executiveSummary: weird, data: {} };
    sanitizeReport(data, new Date());
    expect(data.executiveSummary).not.toMatch(/INDUSTRY-SPECIFIC INSTRUCTIONS/);
    expect(data.executiveSummary).toBe('Foo Automotive');
    expect(data._sanitizerHardStripped).toBe(true);
  });

  test('leaves a clean report untouched (no false positives)', () => {
    const cleanEs = 'Procter Automotive dominates Abilene Automotive with 728 reviews. Start with Abilene Auto Doctor.';
    const cleanCa = 'Abilene Automotive shows 20 competitors with Procter Automotive leading the field.';
    const data = { executiveSummary: cleanEs, data: { competitorAnalysis: cleanCa } };
    sanitizeReport(data, new Date());
    expect(data.executiveSummary).toBe(cleanEs);
    expect(data.data.competitorAnalysis).toBe(cleanCa);
    expect(data._sanitizerHardStripped).not.toBe(true);
  });

  test('does not throw on null / non-string / missing fields', () => {
    expect(() => {
      sanitizeReport({ executiveSummary: null, data: { competitorAnalysis: undefined } }, new Date());
      sanitizeReport({ data: {} }, new Date());
      sanitizeReport({ executiveSummary: 42, data: { competitorAnalysis: { narrative: 'x' } } }, new Date());
    }).not.toThrow();
  });
});
