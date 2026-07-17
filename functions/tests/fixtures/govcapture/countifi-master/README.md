# Countifi Master Proposal — C5 Evaluator Test Corpus

Real-customer corpus for the PR-C5 proposal evaluator
(`services/govcapture/govEvaluationService.js`), built from Countifi's reusable
master government proposal (David Hailey, 2026-07-17).

| File | What it is |
|------|-----------|
| `countifi-master-cleaned.docx` | The master proposal with two non-content artifacts removed (see `manifest.json` → `cleaning`). Content otherwise untouched. |
| `countifi-master-cleaned.txt` | Text extracted from the cleaned docx via `mammoth.extractRawText` — the exact extraction path `manualUploadService.extractTextFromDocx` uses, so this is what the evaluator sees. |
| `manifest.json` | Provenance, cleaning record, section offsets, expected findings, and Pass A requirement probes consumed by `tests/govCorpusCountifi.test.js`. |

## Rules

- The **original** docx lives outside the repo and is never edited. All fixes go in the cleaned copy.
- If the docx changes, **regenerate the .txt from the .docx with mammoth** (never hand-edit the .txt) and update `manifest.json` offsets. `govCorpusCountifi.test.js` fails if the two drift.
- `expectedFindings` are per-solicitation gaps in a deliberately generic master — they are what the evaluator *should* surface, not defects to "fix" in the fixture.
