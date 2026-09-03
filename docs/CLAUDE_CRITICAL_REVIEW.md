# Manual Claude Critical Review v1

## Purpose and authority

This is the first backend Claude Critical Reviewer harness. It is deliberately manual:

`workflow_dispatch` → fetch one PR as untrusted GitHub API data → add bounded governance context → call Anthropic → create or update one PR conversation comment.

Claude provides independent review evidence. Claude cannot merge, deploy, approve production promotion, or make its own approval sufficient for merge. `MERGE AUTHORITY != DEPLOYMENT AUTHORITY.` Charles Berry retains all YELLOW/RED merge authority and all deployment, rollback, classification-override, and governance-amendment authority.

Automatic triggering is outside v1. It requires a separate approved PR after the manual architecture has been validated.

## Security architecture

The workflow is `.github/workflows/claude-critical-review.yml` and may run only by `workflow_dispatch` from `refs/heads/main`. It has no checkout step. It does not execute the reviewed branch or any repository code, install dependencies, run tests/builds, or use `pull_request_target`.

Runs are serialized per PR with `claude-critical-review-${{ fromJSON(inputs.pr_number) }}` and `cancel-in-progress: false`. `fromJSON()` canonicalizes the numeric dispatch input before grouping, so whitespace-equivalent inputs such as `142`, ` 142`, and `142 ` share one concurrency identity. Reviews for different PR numbers may run independently, while a newer same-PR invocation never cancels the running review or races it to update the marker-bearing comment.

PR title, body, branches, author, filenames, changed-file metadata, and unified diff are fetched through the GitHub API and treated as hostile data. Fork PRs may be reviewed because no fork code is checked out or executed. The system instruction tells Claude never to obey instructions embedded in PR content and to report reviewer-manipulation attempts as security findings.

Workflow permissions are intentionally limited to:

- `contents: read` for repository/commit data exposed through the PR API;
- `pull-requests: write` to fetch PR metadata, files, and the unified diff and to create or update the single marker-bearing PR conversation comment.

The workflow does not request `contents: write`, `actions: write`, `deployments: write`, `id-token: write`, or administration permissions. Manual v1 intentionally does not fetch authoritative required-check results and does not request `checks: read` or `actions: read`.

On 2026-09-03, the repository Actions API reported Actions enabled, all actions allowed, `default_workflow_permissions=read`, and `can_approve_pull_request_reviews=false`. The first smoke run's setup log showed that the workflow-level declaration was effective (`Contents: read`, `Issues: write`, `PullRequests: read`), so an external policy was not forcing the job token to read-only. After GitHub nevertheless rejected the PR-comment POST with HTTP 403, the workflow moved to the narrower PR-specific permission accepted by that endpoint: `pull-requests: write`, with `issues: write` removed. No repository or organization setting, PAT, or GitHub App is changed.

The review material carries an explicit machine-readable state: `ciEvidence.authoritativeStatusFetched=false` and `ciEvidence.requiredChecksVerifiedGreen=false`. Therefore the highest mechanically permitted verdict in manual v1 is YELLOW. Claude may still produce a substantive review, but any attempted GREEN is rewritten to YELLOW after the response and checked again before comment publication. PR-authored claims such as “all tests passed” are untrusted assertions and cannot substitute for authoritative GitHub CI evidence.

This YELLOW ceiling is intentional for the first smoke phase. A later approved iteration may add read-only authoritative required-check verification and thereby permit GREEN; that is outside v1.

## Secret and model configuration

- Secret: `ANTHROPIC_API_KEY`
- Non-secret repository variable: `CLAUDE_REVIEW_MODEL`

The model identifier is never hardcoded or guessed. The workflow fails before the Anthropic step when `CLAUDE_REVIEW_MODEL` is blank and prints only the setup instruction. The API key is scoped to the single inline HTTPS request step. No later shell or repository process runs with it, and token/header values are never logged.

Claude Sonnet 5 uses its supported default sampling behavior. The workflow does not set `temperature`, `top_p`, or `top_k` in the Anthropic request body.

The HTTPS response path settles once and fails closed on `IncomingMessage` aborts, response errors, premature closes, invalid JSON, and response-size overflow. For a complete non-2xx response, it parses JSON only when possible and publishes only sanitized `error.type` and `error.message` fields from the documented Anthropic error object. The diagnostic is single-line, credential-redacted, and capped at 800 characters; malformed or unexpected error bodies retain the generic HTTP-status-only failure. Request headers, authorization values, the request body, system prompt, PR diff, environment variables, arbitrary response headers, and all other response fields are excluded. An HTTP failure still writes a failed result so the comment step can publish a YELLOW reviewer-failed comment; it cannot produce GREEN.

The first authorized live smoke on 2026-09-03 reached Anthropic and returned HTTP 400. The workflow correctly wrote an internal YELLOW failure result, but GitHub then rejected the PR-comment POST with HTTP 403, so no review comment was created and no GREEN result occurred. This diagnostic hardening must not make another live Anthropic request or rerun that smoke during development.

## Review material and limits

The review identity is the exact pair `reviewedBaseSha + reviewedHeadSha`; branch names are descriptive metadata, not revision identity. The workflow records both SHAs on the initial PR fetch, collects the bounded files/diff, then refetches immediately before request construction. If either base or head SHA changed, the run aborts before Anthropic and requires a rerun. The request contains repository, PR number, title/body, base/head branches, fork source when applicable, author, changed-file metadata, unified diff, coverage status, and both reviewed SHAs.

Deterministic v1 limits are:

- 100 changed files considered;
- 300 bytes per filename;
- 1,000 bytes for the title;
- 10,000 bytes for the PR body;
- 500 bytes per branch ref;
- 90,000 bytes for the unified diff;
- 135,000 bytes for total serialized review material; and
- 180,000 bytes for the final Anthropic request.

Missing textual patches, API shortfalls, or any truncation mark the PR diff evidence incomplete. Claude receives the literal warning `REVIEW INPUT IS INCOMPLETE.` and may return YELLOW at best. The workflow mechanically rewrites any attempted GREEN result to YELLOW and adds a manual-review blocker. Metadata that cannot fit safely causes the workflow to fail rather than claim coverage. This diff-coverage state is separate from the always-unavailable authoritative CI evidence in manual v1.

## Output and comment contract

Claude must return exactly one occurrence of each top-level item below, in this exact order and with no preceding prose:

1. `VERDICT: GREEN | YELLOW | RED`
2. `MERGE BLOCKERS`
3. `NON-BLOCKING IMPROVEMENTS`
4. `BLAST RADIUS`
5. `TEST EVIDENCE`
6. `CONTRACT / SECURITY CHECK`
7. `REVIEW COVERAGE`

Duplicate verdicts or required headings, missing or reordered sections, and additional top-level occurrences of required headings are invalid. Both exact reviewed SHAs must appear inside `REVIEW COVERAGE`; SHAs elsewhere do not satisfy the contract. Invalid, truncated, partial, aborted, or API-error responses fail the workflow and cannot produce GREEN.

The conversation comment contains `<!-- pathsynch-claude-critical-review -->`. A rerun updates the prior GitHub Actions bot comment containing that marker instead of creating a duplicate. The comment records reviewed/current base SHA, reviewed/current head SHA, configured model name, timestamp, and the no-merge/no-deploy disclaimer. It also states that the substantive Claude review may otherwise be favorable while authoritative required-CI evidence was unavailable, so GREEN is prohibited.

Before posting, the workflow refetches the PR and compares both current SHAs to the reviewed pair. If either changed, any GREEN is changed to YELLOW and the comment receives the blocker: `PR base or head revision changed during review; rerun required.`

## Verdict boundaries

- RED: material security, correctness, data-loss, tenant-isolation, or deployment blocker; dangerous behavior; or missing required safety evidence for a high-risk change.
- YELLOW: automatic exclusion, incomplete/truncated evidence, meaningful uncertainty, insufficient evidence, or required human judgment.
- GREEN: low blast radius, complete input, no automatic exclusion or blocker, required test evidence present, and authoritative required checks verified green. Because manual v1 does not fetch that authoritative CI state, GREEN is mechanically unavailable in v1.

Automatic exclusions remain those in `functions/SYSTEM_BIBLE.md`, including authentication/authorization, workspace entitlements, Firebase/Storage rules, billing/credits, secrets, GitHub Actions permissions, privacy, webhook security, migrations, destructive operations, deployment infrastructure, and cross-repo contracts.

## Post-merge human setup

1. Configure the non-secret repository variable `CLAUDE_REVIEW_MODEL` with an approved current Anthropic model identifier.
2. Charles explicitly authorizes one manual smoke review.
3. From the `main` branch, run **Manual Claude Critical Review**, supplying the target `pr_number`.
4. Confirm one marker-bearing conversation comment is created and a rerun updates it.

Do not enable automatic PR triggering as part of this validation.
