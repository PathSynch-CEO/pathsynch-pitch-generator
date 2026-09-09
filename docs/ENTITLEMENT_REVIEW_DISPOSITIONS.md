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

Second external review corrections: actual concurrent initial provisioning created two workspaces; an owner-payload failure stranded a workspace without membership. Corrected with one protected-team transaction and real Firestore concurrency/rollback regressions. Market/Bulk actual handlers converted unresolved-plan409 to500; corrected with the existing ApiError handler. The caller audit also corrects Market refresh and admin account detail. Market list intentionally returns creditInfo:null if quota display is unavailable; dormant updateSeatLimit has no caller. No billing lifecycle code changed.

OPEN gate: actual synthetic Stripe cancellation/downgrade updates subscriptions/users while an active protected operator assignment remains paid. This is documented operator-grant semantics, but the reviewer P1 remains unresolved pending Charles's explicit lifecycle/scope decision. Do not merge or proceed to Phase2. Separate protected agencyEntitlements branding capabilities predate this foundation and are intentionally preserved by the source matrix; removing such grants is not silently authorized by a general-plan downgrade. Target-project owner-query validation remains a predeployment prerequisite, unexecuted here.

The permitted Claude follow-up reviewed backend4551034/frontend6a29300 before these further corrections. No exact-final-head Claude approval is claimed; cold plus one follow-up budget is exhausted, with no third transmission. Fresh Astra, CI, Devin and GitHub Codex are required for the new code candidate while the billing gate remains open.

Final code-review corrections preserve operational unresolved-plan409 through the actual pitch handler, use bounded protected-owner/caller reads for plan-only resolution, and enforce the team invitation route's existing owner-only policy before side effects. A stale teams record cannot make a current nonowner admin an owner. The legacy memberCount mirror includes active plus offboarding rows until completion; protected seat usage still counts active members only. All three admission writers preserve this mirror invariant so completion cannot subtract the departing member twice.

Remaining policy gate: automatic Stripe cancellation/downgrade does not revise explicit operator assignments, and independent protected branding grants persist. No billing or branding lifecycle policy has been inferred or modified. No final-head Claude approval is claimed after the exhausted cold-plus-follow-up budget.

Final denial-response review: actual missing-profile pitch handling now uses typed USAGE_UNRESOLVED409. Both transcript entitlement guards use the shared forbidden response for verified Starter403 and typed unresolved409. requirePlan also distinguishes unresolved authority from an upgrade-required403. Red-to-green actual handler tests cover each case. The separate plan lookup infrastructure-error behavior remains fail-closed: transient lookup failures become unavailable authority and log a code, so operators must distinguish transient failure from missing reconciliation; no grant or automatic repair is performed.

Export caller audit: generatePPT, checkExportAvailable, checkAllExports and the PPTX branch of prepareCloudExport now preserve typed operational errors; unexpected errors retain their existing generic response. Four actual-handler regressions failed at500 before the correction; all unresolved409 and Starter compatibility cases now pass without export writes.

All direct throwing quota-helper consumers were reviewed together: Market/Bulk/Admin, transcript/seller/precall/landing/investor routes and the index pitchMetrics boundary preserve typed errors. Market list intentionally returns unavailable quota display; dormant updateSeatLimit has no runtime caller. Nonthrowing formatter/narrative/visitor/precall-form guards deny unavailable plans; they do not swallow a thrown409. This audit changes no unrelated validation errors, feature values, billing or grant policy.
