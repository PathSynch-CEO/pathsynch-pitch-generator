# Phase A external-review dispositions

Initial reviewed pair: backend c0ed7e96471a7ee66e4ec49c24a191feef0221ce; frontend f3d7925636dfc95a36761ccf247bb2f36edd20b4. Claude cold payload SHA256 d61849ecf5fdf7cf8d171f7d4dfc250b7b75abe776722bae9b689d7a53b9110e. One cold review completed; no P0/P1 reported by Claude. These are dispositions, not final-head approvals.

| Source/finding | Independent evidence and disposition |
|---|---|
| Devin/Codex: orphan workspace duplication | Actual creation with legacy workspace and missing owner anchor wrote a second workspace. Added denial-only creation gate and zero-write regressions; protected discovery remains unchanged. |
| Devin: admin typed errors | Actual modular/inline handlers collapsed known400/403/409 errors to500. Preserve operational statuses/codes; unexpected errors stay generic. |
| Codex: unbounded owner lookup | Synthetic1001-member store returned1001docs to find one owner. Active-owner filters plus limit2 return only candidates; ambiguity still denied. |
| Devin: legacy frontend plan gates | Cached Enterprise profile remained visible despite protected Scale; smart generation blocked Scale at stale Starter25. Fresh protected projection and current verified quota now govern all shared-user consumers and both generation paths. |
| Devin: invented credits | Exact unresolved getSubscription result became25credits. Credits now unavailable and cannot afford generation; previous Unlimited state is cleared. |
| Codex: toast stored XSS | Real role change decoded dataset member name into fallback toast innerHTML. Reproduced actual-handler/browser failure; toast now uses textContent and regression exercises real success path. |
| Devin/Codex: duplicate Settings snapshots | Separate responses could disagree. User/plan/seat projections share one promise/response; one-read regression passes. |
| Devin: catalog failure | Catalog failure hid otherwise loaded pricing. Seat data degrades to Unavailable; pricing remains usable. |
| Claude P2-1/P2-2/P2-3 | Astra reproduced missing-owner500, malformed-member409 and unresolved assignment. Accepted rollout prerequisites, now explicit in contract. No automatic repair/backfill performed. |
| Claude P3-1 cache growth | Astra reproduced101retained entries including100expired. Removed obsolete result-cache writes/storage; authority remains fresh. |
| Claude P3-2 / Devin stored snapshot drift | Astra reproduced persistedusage2/APIusage1 after removal. Document last-admission semantics; authoritative/API/offline computations never trust storedusage. |
| Claude P3-3 narrow getPlanLimits guard | Current authority resolver returns canonical plan or literal unresolved; no reachable escalation shown. Existing numeric/legacy fallback policy is unchanged outside that boundary; no new grant path added. |
| Claude P3-4 admin legacy-field divergence | Protected assignments agree; display fields remain non-authoritative. Fresh frontend projection eliminates legacy subscription precedence from gates. No billing mutation change. |
| Claude P3-5 packaged diagnostic | Bounded offline CLI is inert in runtime, included under existing package policy. No network/init/write/migration execution; inventory records its inclusion. |
| Claude P3-6 former owner/legacy role | Normal owner-protected flows prevent this state. Offboarding/disabled orphaned owners and foreign roles require operator reconciliation; no automatic authority restoration. Staff is supported. |
| Claude P3-7 unreachable free branches | Non-blocking legacy code; no authority grant or quota values changed. |
| Claude implicit-deny wording | Corrected catch-all wording. Emulator tests confirm direct browser assignment/snapshot/history writes denied. |
| Devin governance/billing lifecycle | YELLOW retained. Operator assignments are explicit attestations, not automatic Stripe lifecycle sync. Separate operator lifecycle/reconciliation review remains required before deployment. |

CI/test/package claims are established by exact-head logs and inventories, not by Claude's static review. No unresolved material disagreement between Astra and Claude. New candidates require fresh CI/Astra/Devin/Codex and the authorized one-time Claude follow-up before the foundation gate. No merge, deployment or production-data action authorized/performed.
