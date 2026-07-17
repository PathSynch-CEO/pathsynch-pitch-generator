'use strict';

/**
 * govCorpusCountifi.test.js — Countifi master-proposal corpus (PR-C5 support).
 *
 * Two layers:
 *  1. Fixture integrity — always runs. Guards the cleaned docx / extracted text /
 *     manifest against drift and re-verifies the corpus's expected findings
 *     (removed artifacts stay removed, security certs stay absent, etc.).
 *  2. Evaluator Pass A — runs the corpus through the deterministic
 *     matchRequirements() from govEvaluationService. Auto-skips while the C5
 *     evaluator has not landed on this branch (its module tree doesn't resolve),
 *     and activates on its own once PR-C5 merges.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'govcapture', 'countifi-master');
const manifest = require(path.join(FIXTURE_DIR, 'manifest.json'));
// CRLF-normalize defensively — a .gitattributes pins the fixture to LF, but a
// stray checkout conversion must not masquerade as corpus drift.
const corpusText = fs
    .readFileSync(path.join(FIXTURE_DIR, 'countifi-master-cleaned.txt'), 'utf-8')
    .replace(/\r\n/g, '\n');
const corpusLower = corpusText.toLowerCase();

describe('Countifi corpus — fixture integrity', () => {
    test('neither removed artifact survives in the cleaned text', () => {
        for (const artifact of manifest.cleaning.removedArtifacts) {
            // Match on a distinctive prefix — mammoth may normalize whitespace.
            expect(corpusText).not.toContain(artifact.text.slice(0, 60));
        }
    });

    test('text length matches manifest', () => {
        expect(corpusText.length).toBe(manifest.textExtraction.chars);
    });

    test('every manifest section heading sits at its recorded offset', () => {
        for (const s of manifest.sections) {
            expect(corpusText.slice(s.offset, s.offset + 80)).toMatch(
                new RegExp('^' + s.n + '\\. ' + s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            );
        }
    });

    test('master-proposal blank solicitation fields are present as labels', () => {
        for (const label of manifest.blankFields) {
            expect(corpusLower).toContain(label.toLowerCase());
        }
    });

    test('expected-finding evidence keywords hold against the corpus', () => {
        for (const finding of manifest.expectedFindings) {
            for (const kw of finding.evidenceKeywordsAbsent || []) {
                expect(corpusLower).not.toContain(kw);
            }
            for (const kw of finding.evidenceKeywordsPresent || []) {
                expect(corpusLower).toContain(kw);
            }
        }
    });

    test('corpus exceeds the evaluator draft cap (documented truncation exposure)', () => {
        expect(corpusText.length).toBeGreaterThan(manifest.evaluatorNotes.draftTextCap);
        const beyondCap = manifest.sections.filter(s => s.offset >= manifest.evaluatorNotes.draftTextCap);
        expect(beyondCap.map(s => s.title)).toEqual(manifest.evaluatorNotes.sectionsBeyondCap);
    });

    test('cleaned .docx re-extracts to the committed .txt (no drift)', async () => {
        const mammoth = require('mammoth');
        const buffer = fs.readFileSync(path.join(FIXTURE_DIR, 'countifi-master-cleaned.docx'));
        const result = await mammoth.extractRawText({ buffer });
        expect(result.value).toBe(corpusText);
    });
});

// ── Evaluator Pass A — auto-skips until PR-C5 lands ─────────────────────────

let evaluationService = null;
try {
    evaluationService = require('../services/govcapture/govEvaluationService');
} catch (err) {
    evaluationService = null; // C5 not on this branch yet
}
const describeEvaluator = evaluationService ? describe : describe.skip;

describeEvaluator('Countifi corpus — evaluator Pass A (matchRequirements)', () => {
    let checked;

    beforeAll(() => {
        const requirements = manifest.passAProbes.map(({ id, category, text, keywords }) =>
            ({ id, category, text, keywords }));
        checked = evaluationService.matchRequirements(requirements, corpusText);
    });

    test.each(manifest.passAProbes.map(p => [p.id, p.expectedStatus]))(
        'probe %s → %s',
        (id, expectedStatus) => {
            const result = checked.find(r => r.id === id);
            expect(result).toBeDefined();
            expect(result.status).toBe(expectedStatus);
        }
    );

    test('missing certifications carry no matched keywords', () => {
        for (const id of ['cert-fedramp', 'cert-nist', 'cert-soc2-cjis']) {
            expect(checked.find(r => r.id === id).matchedKeywords).toEqual([]);
        }
    });

    test('probe summary matches the corpus profile', () => {
        const byStatus = (status) => checked.filter(r => r.status === status).length;
        const expected = (status) =>
            manifest.passAProbes.filter(p => p.expectedStatus === status).length;
        expect(byStatus('present')).toBe(expected('present'));
        expect(byStatus('unclear')).toBe(expected('unclear'));
        expect(byStatus('missing')).toBe(expected('missing'));
    });
});
