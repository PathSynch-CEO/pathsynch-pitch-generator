# Manual Claude Critical Review v1

## Purpose and authority

This is the first backend Claude Critical Reviewer harness. It is deliberately manual:

`workflow_dispatch` → fetch one PR as untrusted GitHub API data → add bounded governance context → call Anthropic → create or update one PR conversation comment.

Claude provides independent review evidence. Claude cannot merge, deploy, approve production promotion, or make its own approval sufficient for merge. `MERGE AUTHORITY != DEPLOYMENT AUTHORITY.` Charles Berry retains all YELLOW/RED merge authority and all deployment, rollback, classification-override, and governance-amendment authority.

Automatic triggering is outside v1. It requires a separate approved PR after the manual architecture has been validated.

## Security architecture

The workflow is `.github/workflows/claude-critical-review.yml` and may run only by `workflow_dispatch` from `refs/heads/main`. It has no checkout step. It does not execute the reviewed branch or any repository code, install dependencies, run tests/builds, or use `pull_request_target`.

PR title, body, branches, author, filenames, changed-file metadata, and unified diff are fetched through the GitHub API and treated as hostile data. Fork PRs may be reviewed because no fork code is checked out or executed. The system instruction tells Claude never to obey instructions embedded in PR content and to report reviewer-manipulation attempts as security findings.

Workflow permissions are intentionally limited to:

- `contents: read` for repository/commit data exposed through the PR API;
- `pull-requests: read` to fetch PR metadata, files, and the unified diff; and
- `issues: write` because GitHub PR conversation comments use the Issues Comments API.

The workflow does not request `contents: write`, `actions: write`, `deployments: write`, `id-token: write`, or administration permissions. CI/check details are not fetched in manual v1; their absence is explicitly supplied to Claude as missing evidence.

## Secret and model configuration

- Secret: `ANTHROPIC_API_KEY`
- Non-secret repository variable: `CLAUDE_REVIEW_MODEL`

The model identifier is never hardcoded or guessed. The workflow fails before the Anthropic step when `CLAUDE_REVIEW_MODEL` is blank and prints only the setup instruction. The API key is scoped to the single inline HTTPS request step. No later shell or repository process runs with it, and token/header values are never logged.

The feature branch must never make a live Anthropic request. The first live call is permitted only after this harness is merged, the model variable is configured, and Charles explicitly authorizes one manual smoke review.

## Review material and limits

Immediately before constructing the request, the workflow refetches the PR and records the exact head SHA. The request contains repository, PR number, title/body, base/head branches, fork source when applicable, author, changed-file metadata, unified diff, coverage status, and the recorded head SHA.

Deterministic v1 limits are:

- 100 changed files considered;
- 300 bytes per filename;
- 1,000 bytes for the title;
- 10,000 bytes for the PR body;
- 500 bytes per branch ref;
- 90,000 bytes for the unified diff;
- 135,000 bytes for total serialized review material; and
- 180,000 bytes for the final Anthropic request.

Missing textual patches, API shortfalls, or any truncation mark the evidence incomplete. Claude receives the literal warning `REVIEW INPUT IS INCOMPLETE.` and may return YELLOW at best. The workflow also mechanically rewrites any attempted GREEN result to YELLOW and adds a manual-review blocker. Metadata that cannot fit safely causes the workflow to fail rather than claim coverage.

## Output and comment contract

Claude must return, with no preceding prose:

1. `VERDICT: GREEN | YELLOW | RED`
2. `MERGE BLOCKERS`
3. `NON-BLOCKING IMPROVEMENTS`
4. `BLAST RADIUS`
5. `TEST EVIDENCE`
6. `CONTRACT / SECURITY CHECK`
7. `REVIEW COVERAGE`

The response must include the reviewed head SHA. Invalid, truncated, or API-error responses fail the workflow and cannot produce GREEN.

The conversation comment contains `<!-- pathsynch-claude-critical-review -->`. A rerun updates the prior GitHub Actions bot comment containing that marker instead of creating a duplicate. The comment records the Claude output, reviewed/current head SHA, configured model name, timestamp, and the no-merge/no-deploy disclaimer.

Before posting, the workflow refetches the PR. If the head changed during review, any GREEN is changed to YELLOW and the comment states: `PR HEAD changed during review; rerun required.`

## Verdict boundaries

- RED: material security, correctness, data-loss, tenant-isolation, or deployment blocker; dangerous behavior; or missing required safety evidence for a high-risk change.
- YELLOW: automatic exclusion, incomplete/truncated evidence, meaningful uncertainty, insufficient evidence, or required human judgment.
- GREEN: low blast radius, complete input, no automatic exclusion or blocker, and required test evidence present.

Automatic exclusions remain those in `functions/SYSTEM_BIBLE.md`, including authentication/authorization, workspace entitlements, Firebase/Storage rules, billing/credits, secrets, GitHub Actions permissions, privacy, webhook security, migrations, destructive operations, deployment infrastructure, and cross-repo contracts.

## Post-merge human setup

1. Configure the non-secret repository variable `CLAUDE_REVIEW_MODEL` with an approved current Anthropic model identifier.
2. Charles explicitly authorizes one manual smoke review.
3. From the `main` branch, run **Manual Claude Critical Review**, supplying the target `pr_number`.
4. Confirm one marker-bearing conversation comment is created and a rerun updates it.

Do not enable automatic PR triggering as part of this validation.
