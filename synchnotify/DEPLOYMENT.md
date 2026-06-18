# SynchNotify Deployment Runbook

## Pre-Deployment Checklist (GCP Console)

Before first deployment, verify/complete in GCP project `pathconnect-442522`:

1. **Cloud Run API** — already enabled (Entity360 deployed here)
2. **Cloud Tasks API** — enable if not already: `gcloud services enable cloudtasks.googleapis.com`
3. **Secret Manager API** — enable: `gcloud services enable secretmanager.googleapis.com`
4. **Create service account**: `synchnotify-sa@pathconnect-442522.iam.gserviceaccount.com`
5. **Assign IAM roles**:
   - `roles/datastore.user` on Firestore (project pathsynch-pitch-creation)
   - `roles/secretmanager.secretAccessor` on Secret Manager
   - `roles/cloudtasks.enqueuer` on Cloud Tasks queue
   - `roles/cloudtasks.taskRunner` on Cloud Tasks queue
6. **Create Cloud Tasks queue**: `gcloud tasks queues create synchnotify-delivery --location=us-central1`
7. **Create secrets in Secret Manager**:
   - `SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO` — generate: `openssl rand -hex 32`
   - `SYNCHNOTIFY_HMAC_KEY_PATHMANAGER` — generate: `openssl rand -hex 32`
   - `SLACK_BOT_TOKEN` (S2)
   - `SLACK_SIGNING_SECRET` (S2)

## Deploy to Cloud Run

```bash
# Build and deploy
gcloud run deploy synchnotify \
  --source=synchnotify/ \
  --project=pathconnect-442522 \
  --region=us-central1 \
  --service-account=synchnotify-sa@pathconnect-442522.iam.gserviceaccount.com \
  --set-env-vars="FIRESTORE_PROJECT_ID=pathsynch-pitch-creation" \
  --set-secrets="SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO=SYNCHNOTIFY_HMAC_KEY_SYNCHINTRO:latest,SYNCHNOTIFY_HMAC_KEY_PATHMANAGER=SYNCHNOTIFY_HMAC_KEY_PATHMANAGER:latest" \
  --memory=512Mi \
  --timeout=60 \
  --max-instances=10 \
  --allow-unauthenticated
```

## Rollback

```bash
# List revisions
gcloud run revisions list --service=synchnotify --project=pathconnect-442522

# Route traffic to previous revision
gcloud run services update-traffic synchnotify \
  --to-revisions=PREVIOUS_REVISION=100 \
  --project=pathconnect-442522
```

## Health Check

```bash
curl https://synchnotify-XXXXX.run.app/health
curl https://synchnotify-XXXXX.run.app/ready
```

## Firestore Collections (New in S1)

| Collection | Purpose | Indexes Needed |
|------------|---------|----------------|
| `eventLog` | Event receipt + idempotency | tenantId ASC + timestamp DESC; idempotencyKey ASC |
| `deadLetterEvents` | Failed delivery records | tenantId ASC + createdAt DESC |

These are purely additive — no existing collections are modified.

## Cloud Tasks Queue Path

After creating the queue, set the queue path as:
```
projects/pathconnect-442522/locations/us-central1/queues/synchnotify-delivery
```
