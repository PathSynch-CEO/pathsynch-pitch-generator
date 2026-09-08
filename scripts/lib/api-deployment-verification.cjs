'use strict';

const crypto = require('node:crypto');
const PROJECT = 'pathsynch-pitch-creation';
const LOCATION = 'us-central1';
const SERVICE = 'api';
const PREFIX = `projects/${PROJECT}/locations/${LOCATION}`;
const REQUIRED_ENV = [
    'NYLAS_GRANT_ID', 'NYLAS_SCHEDULER_CONFIGURATION_ID', 'NYLAS_EXPECTED_ORGANIZER',
    'NYLAS_EXPECTED_EVENT_TITLE', 'NYLAS_EXPECTED_TIMEZONE',
    'NYLAS_EXPECTED_DURATION_MINUTES', 'NYLAS_MIN_BOOKING_NOTICE_MINUTES',
    'SYNCHINTRO_ALLOWED_ORIGINS'
];
const REQUIRED_SECRETS = ['IMAGEN_API_ENDPOINT', 'THEORG_API_KEY', 'SPYFU_API_KEY', 'NYLAS_API_KEY'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revisionId = value => typeof value === 'string' && /^api-\d{5}-[a-z0-9]+$/.test(value);
const positiveInteger = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
function requireThat(ok, code) {
    if (!ok) throw new Error(code); // Fixed diagnostic codes only: never echo cloud/config payloads.
}
function validateExpectation(e) {
    requireThat(plain(e) && e.schemaVersion === 1, 'EXPECTATION_SCHEMA');
    requireThat(e.project === PROJECT && e.location === LOCATION && e.service === SERVICE, 'EXPECTATION_TARGET');
    requireThat(typeof e.authorizedSha === 'string' && /^[a-f0-9]{40}$/.test(e.authorizedSha), 'EXPECTATION_SHA');
    requireThat(revisionId(e.expectedRevision) && revisionId(e.previousRevision) &&
        e.expectedRevision !== e.previousRevision, 'EXPECTATION_NEW_REVISION');
    requireThat(typeof e.deploymentStartedAt === 'string' && Number.isFinite(Date.parse(e.deploymentStartedAt)), 'EXPECTATION_START');
    requireThat(typeof e.revisionUid === 'string' && /^[a-f0-9-]{36}$/.test(e.revisionUid), 'EXPECTATION_UID');
    requireThat(typeof e.image === 'string' &&
        /^us-central1-docker\.pkg\.dev\/pathsynch-pitch-creation\/gcf-artifacts\/[a-z0-9_-]+@sha256:[a-f0-9]{64}$/.test(e.image), 'EXPECTATION_IMAGE');
    requireThat(typeof e.build === 'string' &&
        /^projects\/796921234100\/locations\/us-central1\/builds\/[a-f0-9-]{36}$/.test(e.build), 'EXPECTATION_BUILD');
    requireThat(plain(e.source) && e.source.bucket === 'gcf-v2-sources-796921234100-us-central1' &&
        e.source.object === 'api/function-source.zip' && positiveInteger(e.source.generation), 'EXPECTATION_SOURCE');
    requireThat(plain(e.configSha256) && REQUIRED_ENV.every(name =>
        typeof e.configSha256[name] === 'string' && /^[a-f0-9]{64}$/.test(e.configSha256[name])), 'EXPECTATION_CONFIG');
    requireThat(e.configSha256.NYLAS_MIN_BOOKING_NOTICE_MINUTES === digest('60'), 'EXPECTATION_NOTICE');
    requireThat(plain(e.secretVersions) && REQUIRED_SECRETS.every(name =>
        positiveInteger(e.secretVersions[name])), 'EXPECTATION_SECRET_VERSIONS');
    return e;
}
function checkTraffic(rows, expected, allowLatest) {
    requireThat(Array.isArray(rows) && rows.length > 0, 'TRAFFIC_MISSING');
    let total = 0;
    for (const row of rows) {
        requireThat(plain(row), 'TRAFFIC_SHAPE');
        const percent = row.percent === undefined ? 0 : row.percent;
        requireThat(Number.isInteger(percent) && percent >= 0 && percent <= 100, 'TRAFFIC_PERCENT');
        // Even a zero-percent tag can expose another revision. This acceptance gate allows none.
        requireThat(!row.tag, 'TRAFFIC_TAG');
        requireThat(row.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' ||
            (allowLatest && row.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST'), 'TRAFFIC_TYPE');
        if (row.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION') {
            requireThat(revisionId(row.revision), 'TRAFFIC_REVISION');
            requireThat(row.revision === expected, 'TRAFFIC_UNEXPECTED_REVISION');
        } else {
            requireThat(!row.revision || row.revision === expected, 'TRAFFIC_LATEST_CONFLICT');
        }
        total += percent;
    }
    requireThat(total === 100, 'TRAFFIC_NOT_100');
}
function verifyDeployment(e, { service: s, revision: r, fn: f, build: b }) {
    validateExpectation(e);
    const serviceName = `${PREFIX}/services/api`;
    const revisionName = `${serviceName}/revisions/${e.expectedRevision}`;
    requireThat(plain(s) && s.name === serviceName && !s.deleteTime, 'SERVICE_IDENTITY');
    requireThat(s.latestCreatedRevision === revisionName, 'LATEST_CREATED_MISMATCH');
    requireThat(s.latestReadyRevision === revisionName, 'LATEST_READY_MISMATCH');
    requireThat(positiveInteger(s.generation) && s.generation === s.observedGeneration &&
        s.reconciling !== true, 'SERVICE_NOT_RECONCILED');
    requireThat(s.terminalCondition?.state === 'CONDITION_SUCCEEDED', 'SERVICE_NOT_READY');
    checkTraffic(s.traffic, e.expectedRevision, true);
    checkTraffic(s.trafficStatuses, e.expectedRevision, false);
    requireThat(plain(r) && r.name === revisionName && r.service === SERVICE &&
        r.uid === e.revisionUid && !r.deleteTime, 'REVISION_IDENTITY');
    requireThat(Number.isFinite(Date.parse(r.createTime)) &&
        Date.parse(r.createTime) >= Date.parse(e.deploymentStartedAt), 'REVISION_PREDATES_DEPLOYMENT');
    requireThat(positiveInteger(r.generation) && r.generation === r.observedGeneration, 'REVISION_NOT_RECONCILED');
    for (const type of ['Ready', 'Active', 'ContainerHealthy']) {
        const conditions = (r.conditions || []).filter(c => c.type === type);
        requireThat(conditions.length === 1 && conditions[0].state === 'CONDITION_SUCCEEDED' &&
            conditions[0].revisionReason !== 'RETIRED', 'REVISION_' + type.toUpperCase());
    }
    requireThat(Array.isArray(r.containers) && r.containers.length === 1 &&
        r.containers[0].image === e.image, 'REVISION_IMAGE');
    const env = r.containers[0].env;
    requireThat(Array.isArray(env) && env.every(v => plain(v) && typeof v.name === 'string') &&
        new Set(env.map(v => v.name)).size === env.length, 'ENV_SHAPE');
    for (const name of REQUIRED_ENV) {
        const item = env.find(v => v.name === name);
        requireThat(item && typeof item.value === 'string' && item.value.length > 0 &&
            !item.valueSource && digest(item.value) === e.configSha256[name], 'CONFIG_' + name);
    }
    const secretNames = env.filter(v => v.valueSource).map(v => v.name).sort();
    requireThat(JSON.stringify(secretNames) === JSON.stringify([...REQUIRED_SECRETS].sort()), 'SECRET_BINDING_SET');
    for (const name of REQUIRED_SECRETS) {
        const item = env.find(v => v.name === name);
        const ref = item?.valueSource?.secretKeyRef;
        requireThat(item && item.value === undefined && ref &&
            ref.secret === `projects/${PROJECT}/secrets/${name}` &&
            ref.version === e.secretVersions[name], 'SECRET_BINDING_' + name);
    }
    requireThat(plain(f) && f.name === `${PREFIX}/functions/api` &&
        f.environment === 'GEN_2' && f.state === 'ACTIVE' &&
        f.serviceConfig?.service === serviceName &&
        f.serviceConfig?.revision === e.expectedRevision, 'FUNCTION_IDENTITY');
    requireThat(f.buildConfig?.build === e.build && f.buildConfig?.runtime === 'nodejs22' &&
        f.buildConfig?.entryPoint === 'api', 'FUNCTION_BUILD');
    for (const src of [f.buildConfig.source?.storageSource,
        f.buildConfig.sourceProvenance?.resolvedStorageSource]) {
        requireThat(src && ['bucket', 'object', 'generation'].every(k => src[k] === e.source[k]), 'FUNCTION_SOURCE');
    }
    requireThat(plain(b) && b.name === e.build && b.status === 'SUCCESS', 'BUILD_NOT_SUCCESS');
    requireThat(Number.isFinite(Date.parse(b.startTime)) && Number.isFinite(Date.parse(b.finishTime)) &&
        Date.parse(b.startTime) >= Date.parse(e.deploymentStartedAt) &&
        Date.parse(b.finishTime) >= Date.parse(b.startTime), 'BUILD_TIMING');
    // Firebase's buildpack build does not return results.images or resolvedStorageSource.
    // The operator must independently bind archive contents and image buildInfo to this build.
    return { status: 'PASS', scope: 'deployment-metadata-only', authorizedSha: e.authorizedSha,
        expectedRevision: e.expectedRevision, desiredTraffic: 100, observedTraffic: 100,
        generation: s.generation, build: e.build, sourceGeneration: e.source.generation,
        requiredConfigPresentAndMatched: true, secretBindingsMatched: true };
}
module.exports = { PROJECT, PREFIX, REQUIRED_ENV, REQUIRED_SECRETS, digest, validateExpectation, verifyDeployment };
