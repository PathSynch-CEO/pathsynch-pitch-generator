# Gate 1 Strategy Review — PR-B: Migrate CI deploy auth off FIREBASE_TOKEN (F-702) + F-701 posture

**The last remediation item.** Gate 1 STOP: strategy + the decisions/provisioning you need to make. Nothing built yet. On approval (and once you provision the secret) I build → Gate 2 → PR.

---

## Context — why

`FIREBASE_TOKEN` (from the deprecated `firebase login:ci`) has **expired twice this session** — once on the backend deploy, once on the frontend hosting deploy — each time causing a red deploy until you manually refreshed it. That's finding **F-702**. The fix is to stop using expiring tokens and authenticate CI with a **service account** (or Workload Identity Federation) instead.

Related: **F-701** (the backend CI functions deploy) is currently disabled (`if: false`, #49) because a CI deploy has no `functions/.env`. That's a separate posture decision (below).

## What actually needs fixing (scope)

Only **one deploy job actually runs today: the frontend hosting deploy** (backend functions deploy is disabled and deploys are manual per F-704). So the token pain is entirely on the frontend. **Recommended PR-B = migrate the frontend hosting deploy auth off `FIREBASE_TOKEN` to a service account.** Small, clean, and it fully ends the recurring-token problem.

## Two decisions for you

**Decision 1 — auth mechanism:**
- **(A) Service-account JSON key** *(recommended — simplest)*: create a purpose-scoped deploy SA, store its JSON key as a GitHub Secret; the workflow authenticates with it. Doesn't expire. ~5 min setup.
- **(B) Workload Identity Federation** *(most secure — no stored key)*: GitHub OIDC → GCP, no long-lived key. ~20–30 min more setup (pool + provider + bindings).

I recommend **(A)** to get you off the expiry treadmill fast; **(B)** is the gold standard if you want to invest. Either way the SA is **purpose-scoped to deploy only** (least privilege — deliberately *not* reusing the broad on-disk key, which is F-103's concern).

**Decision 2 — backend functions CI deploy posture (F-701 proper):**
- **(1) Keep manual** *(recommended)*: leave the backend deploy job disabled; manual/local functions deploys stay canonical (documented in F-704, and you did one successfully this session). Nothing more to build. No `.env` injection needed.
- **(2) Re-enable CI auto-deploy**: requires injecting `functions/.env` from a GitHub Secret **and** SA auth — larger, and it means every merge redeploys all 16 functions. Only if you want that.

I recommend **(1)** — functions auto-deploy on every merge is heavier and riskier than hosting, and manual already works well.

**Net recommended path: (A) + (1)** → PR-B is a small frontend-only auth swap.

## What you provision (owner actions — I can't create/handle credentials)

For the recommended **(A)**:
1. **Create a service account** in GCP (project `pathsynch-pitch-creation`), e.g. `github-hosting-deploy@…`.
2. **Grant least-privilege roles** for hosting deploy: **Firebase Hosting Admin** (`roles/firebasehosting.admin`) + **Firebase Viewer** (`roles/firebase.viewer`). (I'll confirm the minimal set during build.)
3. **Create a JSON key** for it, and add it as a GitHub **Secret** named **`FIREBASE_SERVICE_ACCOUNT`** in the **`synchintro-app`** repo (Settings → Secrets and variables → Actions → New repository secret) — paste the full JSON.
4. After the new deploy is verified green, **delete the old `FIREBASE_TOKEN` secret**.

(If you pick WIF or backend auto-deploy, the provisioning differs — I'll respell it in a revised Gate 1.)

## What I build (after approval + secret exists)

Frontend `synchintro-app/.github/workflows/ci.yml` `deploy` job:
- Add a `google-github-actions/auth@v2` step using `credentials_json: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}` (writes the key to a file, sets `GOOGLE_APPLICATION_CREDENTIALS`).
- Change the deploy step to rely on `GOOGLE_APPLICATION_CREDENTIALS` and **remove the `FIREBASE_TOKEN` env**. `firebase-tools` honors `GOOGLE_APPLICATION_CREDENTIALS` natively.
- `--only hosting`, `--project pathsynch-pitch-creation` unchanged; the `test`/smoke gate unchanged.

## Safe order (never leaves the pipeline broken)

1. You create the SA + `FIREBASE_SERVICE_ACCOUNT` secret (leave `FIREBASE_TOKEN` in place for now).
2. I open the PR swapping auth to the SA.
3. Merge → the deploy runs on the SA; confirm green.
4. Only then delete the old `FIREBASE_TOKEN` secret.

## Blast radius / rollback
- Frontend `ci.yml` `deploy` job only. No product code, no rules, no functions.
- If the SA auth misbehaves, revert the workflow change (falls back to `FIREBASE_TOKEN`, still present until step 4). Hosting itself is unaffected.

## Merge routing
Frontend CI/infra → **Williams** (or Charles as infra). I do not merge. **I never see or handle the key** — you create it and store it as a secret; the workflow references it by name.

---

**Your call at this gate:** confirm **(A)+(1)** (or pick WIF / backend-auto-deploy), then provision the `FIREBASE_SERVICE_ACCOUNT` secret. Once it's in place, tell me and I build the PR. If you'd rather not set up a service account right now, the alternative is to keep refreshing `FIREBASE_TOKEN` when it expires — functional, just the recurring pain F-702 exists to remove.
