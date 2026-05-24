# Changelog — 2026-05-24

## Fix: Credit Deduction Double-Spend (P0) — Atomic Billing

**Reviewed by:** Arthur Morrissette (Focal AI)

**Problem:** `checkCredits()` + `deductCredits()` ran as separate Firestore reads and writes. Two concurrent requests could both pass the credit check, then both deduct — resulting in double-spend and negative credit balances confirmed in production.

---

### New Billing Helpers (`functions/api/billing.js`)

Three new exported functions. `checkCredits` and `deductCredits` are **retained** for backward compatibility.

#### `checkAndDeductCredits(userId, required, reason, options)`
- Atomically checks and deducts credits in a single Firestore transaction
- **FAILS CLOSED:** If the transaction throws (Firestore unavailable), returns `{ allowed: false, error: 'BILLING_TRANSACTION_FAILED' }`. Routes return 503, NOT 402.
- Legacy accounts (no `credits` field) → allowed, logged
- Anonymous/null users → allowed without touching Firestore

#### `refundCredits(userId, amount, reason, options)`
- Restores credits with a positive ledger entry
- Non-blocking — failure is logged, never thrown to the caller
- Used for: generation failure refunds, variable-cost partial refunds

#### `writeCreditLedger(userId, amount, reason, service)`
- Shared ledger writer extracted from `deductCredits`
- Fire-and-forget — negative for deductions, positive for refunds

---

### Pattern Changes by Service

| Service | Pattern | Change |
|---------|---------|--------|
| Template Enrichment | Reserve max → refund unused delta | `checkCredits+deductCredits` → `checkAndDeductCredits` (reserve) + `refundCredits` (partial refund) |
| Opportunity Brief | Atomic deduct before work, refund on failure | `checkCredits` → `checkAndDeductCredits`; `deductCredits` removed from service (moved to route) |
| Intent Signals | Guard before work | `deductCredits` fire-and-forget AFTER work → `checkAndDeductCredits` BEFORE work |
| Market Intel | creditBlocked null check added | `intentSignalsResult.creditBlocked` → null (omit from report) |

---

### Files Changed

| File | Change |
|------|--------|
| `functions/api/billing.js` | +3 new exports: `checkAndDeductCredits`, `refundCredits`, `writeCreditLedger` |
| `functions/services/templateEnrichment.js` | Import updated; credit gate → atomic reserve; deduct → partial refund |
| `functions/routes/opportunityBriefRoutes.js` | Import updated; both endpoints use atomic deduct + 503 path + generation failure refund |
| `functions/services/opportunityBriefService.js` | `deductCredits` import removed; billing deduction line removed (now in route) |
| `functions/services/intentSignalService.js` | Import updated; credit guard moved BEFORE `fetchAndComputeSignals`; `creditBlocked` return |
| `functions/api/market.js` | `creditBlocked` null check added after `generateIntentSignals` resolves |
| `functions/__mocks__/firebase-admin.js` | Added `_increment` handling to `MockDocumentReference.update()` |
| `functions/tests/billing.test.js` | **NEW** — 10 billing tests (see below) |

---

### Test Coverage (`functions/tests/billing.test.js`)

10 new tests, all passing. Total suite: **882 passing, 0 failing** (was 872).

| # | Test | What it proves |
|---|------|----------------|
| 1 | Concurrent deduction | Serialized txns → exactly one allowed, balance never negative |
| 2 | Insufficient credits | `allowed:false`, balance unchanged, no ledger debit |
| 3 | Legacy account | No `credits` field → `allowed:true, Infinity`, logs "Legacy account" |
| 4 | Transaction failure (fail closed) | Firestore error → `allowed:false, error:'BILLING_TRANSACTION_FAILED'` |
| 5 | Refund credits | Balance restored + positive ledger entry written |
| 6 | Template Enrichment partial refund | Reserve 90, use 85, refund 5 → net charge 85, ledger shows -90 + +5 |
| 7 | Opportunity Brief failure refund | Deduct 145, simulate throw, refund 145 → balance restored |
| 8 | Intent Signals guard | 50 credits, need 150 → `creditBlocked:true`, paid work not triggered |
| 9 | Anonymous/null user | `allowed:true` without touching Firestore |
| 10 | Legacy exports | `checkCredits` and `deductCredits` still exported |

---

### Carry-Forward Rules

1. **NEVER fail open on billing transaction errors.** `checkAndDeductCredits` catch → `{ allowed: false, error: 'BILLING_TRANSACTION_FAILED' }`. Routes return 503.
2. **Any route/service that deducts before work MUST refund on hard generation failure.**
3. **Intent Signals: credit guard BEFORE paid work.** Never fire-and-forget after work completes.
4. **`creditBlocked` return from `generateIntentSignals`:** market.js nullifies it (omit from report, not an error).
5. **`checkCredits` and `deductCredits` NOT removed** — still exported for backward compat.
6. **`MockDocumentReference.update()` now handles `_increment`** — fix applies to all future tests using direct `.update()` calls with `FieldValue.increment()`.
