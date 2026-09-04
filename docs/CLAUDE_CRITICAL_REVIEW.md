# Manual Claude Critical Review v2

## Purpose and authority

Manual Claude Critical Review v2 is a `workflow_dispatch`-only backend review harness:

`workflow_dispatch` → fetch one PR and its exact revision as untrusted GitHub API data → fetch authoritative GitHub CI for that reviewed head SHA → call Anthropic → create or update one PR conversation comment.

Claude provides independent review evidence. Claude cannot merge, deploy, approve production promotion, or make its own approval sufficient for merge. `MERGE AUTHORITY != DEPLOYMENT AUTHORITY.` Charles Berry retains all YELLOW/RED merge authority and all deployment, rollback, classification-override, and governance-amendment authority.

Automatic triggering remains future work and requires a separate approved change. V2 does not add `pull_request`, `pull_request_target`, or another automatic trigger.

## Security architecture

The workflow is `.github/workflows/claude-critical-review.yml` and may run only by `workflow_dispatch` from `refs/heads/main`. It has no checkout step. It does not execute reviewed code, install dependencies, run tests/builds, or use `pull_request_target`.

Runs are serialized per PR with `claude-critical-review-${{ fromJSON(inputs.pr_number) }}` and `cancel-in-progress: false`. Whitespace-equivalent numeric inputs share one concurrency identity. A newer same-PR invocation does not cancel the active review or race its marker-bearing comment.

PR titles, bodies, branch names, authors, filenames, changed-file metadata, and unified diffs are hostile data. Fork PRs remain reviewable because no fork code is checked out or executed. Prompt-injection defenses tell Claude never to obey reviewed content and to report reviewer-manipulation attempts as security findings.

Workflow permissions are exactly:

- `contents: read` for repository/PR data and the required-check contract;
- `pull-requests: write` for PR reads and one marker-bearing conversation comment; and
- `checks: read` for authoritative check runs on the reviewed head SHA.

The two enforced identities are GitHub Actions check runs, so no commit-status lookup or `statuses: read` permission is needed. The workflow does not request `contents: write`, `actions: write`, `deployments: write`, `id-token: write`, administration permissions, a PAT, a new GitHub App, or `AUDIT_REPO_TOKEN`.

## Authoritative required CI

`.github/required-checks.json` is the only repository machine-readable required-check contract. It contains exactly:

- `Test & Audit`
- `Emulator Tests (rules)`

After the initial PR fetch, bounded PR-data collection, and base/head refetch establish a coherent `reviewedBaseSha + reviewedHeadSha` identity, v2 loads the contract from the trusted workflow revision and calls GitHub's check-runs API with `ref: reviewedHeadSha`. It does not substitute a base SHA, current `main` SHA, branch name, PR claim, local output, screenshot, or badge.

The evidence records the fetched SHA, each exact required name, status, conclusion, and match count, plus missing, pending, failing, ambiguous, unknown, and retrieval-failure reasons. A required check succeeds only when exactly one matching check run is `completed` with conclusion `success`.

These states do not satisfy GREEN:

- queued, in progress, pending, requested, or waiting;
- skipped, cancelled, timed out, action required, neutral, stale, startup failure, or failure;
- missing or duplicate/ambiguous results;
- unknown statuses or conclusions;
- API/contract retrieval failure; or
- evidence returned for any SHA other than `reviewedHeadSha`.

Unknown states fail closed. CI retrieval failure may still allow the bounded substantive Claude review to run, but the final verdict cannot be GREEN and the comment states the reason.

PR-authored assertions such as “all tests passed” remain untrusted. The authoritative CI block is supplied to Claude outside the untrusted PR-content block. Claude may recommend GREEN only when that block verifies every required check green, and final machine enforcement controls regardless of Claude output.

## External GitHub ruleset control

The active GitHub ruleset `main-required-ci` (ruleset id `22234285`) was separately verified through GitHub's read-only repository API on September 3, 2026. It targets the default branch and requires the exact same two contexts:

- `Test & Audit`
- `Emulator Tests (rules)`

It also requires a pull request, zero approvals, conversation resolution, branches up to date before merge, blocks force pushes, restricts deletions, and has no bypass actors.

Ruleset enforcement is an external repository control, not runtime reviewer input. The workflow intentionally does not request administration permission to read rulesets. Its runtime source of truth remains `.github/required-checks.json`; any future mismatch between that contract and GitHub settings must be resolved outside this workflow before authoritative GREEN review is relied on.

## Revision identity and stale protection

Review identity is the exact `reviewedBaseSha + reviewedHeadSha` pair. The sequence is:

1. fetch the initial PR;
2. collect bounded PR files and diff;
3. refetch the PR and verify both SHAs are unchanged;
4. fetch CI for `reviewedHeadSha`;
5. construct the Claude request and run the review;
6. refetch before comment publication and verify both SHAs again.

Any base/head drift makes the result non-GREEN and adds `PR base or head revision changed during review; rerun required.` Branch names remain descriptive metadata and never replace SHA identity.

## Secret, model, and response handling

- Secret: `ANTHROPIC_API_KEY`
- Non-secret repository variable: `CLAUDE_REVIEW_MODEL`

The model is not hardcoded. The workflow fails before Anthropic when the variable is absent or invalid. The API key is scoped to the single inline HTTPS process. No later shell or repository process runs after that credentialed step.

Claude Sonnet 5 uses default sampling behavior; the request sets none of `temperature`, `top_p`, or `top_k`. The HTTPS path fails closed on aborted, errored, partial, oversized, malformed, or non-2xx responses. Public diagnostics use only sanitized documented Anthropic error fields and cannot produce GREEN.

## Review limits and GREEN gate

Deterministic limits remain 100 changed files, 300 bytes per filename, 1,000 bytes for title, 10,000 bytes for PR body, 500 bytes per branch ref, 90,000 bytes for unified diff, 135,000 bytes for serialized review material, and 180,000 bytes for the Anthropic request.

Missing patches, API shortfalls, or truncation make review coverage incomplete and cap the result at YELLOW independently of CI.

GREEN is mechanically possible in v2 only when all existing GREEN requirements hold and:

- `ciEvidence.authoritativeStatusFetched === true`;
- `ciEvidence.requiredChecksVerifiedGreen === true`; and
- `ciEvidence.fetchedForSha === reviewedHeadSha`.

If Claude returns GREEN without that state, the workflow rewrites it to YELLOW after the Anthropic response and checks the gate again immediately before comment publication. Claude YELLOW or RED is never mechanically upgraded.

## Output and comment contract

Claude must return exactly one ordered top-level `VERDICT`, `MERGE BLOCKERS`, `NON-BLOCKING IMPROVEMENTS`, `BLAST RADIUS`, `TEST EVIDENCE`, `CONTRACT / SECURITY CHECK`, and `REVIEW COVERAGE` section. Both reviewed SHAs must appear inside `REVIEW COVERAGE`. Invalid or incomplete output fails closed.

The single updateable comment retains `<!-- pathsynch-claude-critical-review -->` and reports:

- concise authoritative CI status for each required check;
- whether all required checks are verified;
- reviewed/current base and head SHAs;
- current PR state;
- model and timestamp; and
- explicit no-merge/no-deploy authority language.

Raw GitHub API payloads are never dumped into the comment.

## Validation boundary

The focused guard executes mocked fetch, reviewer, and comment scripts. It preserves injected drifts A–K and adds L–Q for PR-body CI substitution, missing authoritative-state enforcement, wrong-SHA lookup, omitted required-check verification, and acceptance of non-success conclusions.

Development validation must not invoke Anthropic or dispatch the manual reviewer. No deployment, IAM/WIF/Firebase change, secret change, repository-setting mutation, merge, or production promotion is part of this workflow change.
