#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { validateExpectation, verifyDeployment, PREFIX } = require('./lib/api-deployment-verification.cjs');

/** The only resource requests this command issues are the five fixed GETs below.
 * ADC may refresh its own access token. No service update, deploy, provider request,
 * secret payload access, or traffic mutation exists in this command.
 */
async function run(argv, dependencies = {}) {
    if (argv.length !== 2 || argv[0] !== '--expect') throw new Error('USAGE_EXPECT_FILE');
    const e = validateExpectation(JSON.parse(fs.readFileSync(argv[1], 'utf8')));
    const makeClient = dependencies.makeClient || (async () => {
        const { GoogleAuth } = require('../functions/node_modules/google-auth-library');
        return new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
    });
    const client = await makeClient();
    const get = async url => (await client.request({
        url, method: 'GET', timeout: 30000, retry: false, maxRedirects: 0
    })).data;
    const serviceUrl = `https://run.googleapis.com/v2/${PREFIX}/services/api`;
    // Read service before and after the dependent resources; reject concurrent changes.
    const service = await get(serviceUrl);
    const revision = await get(`${serviceUrl}/revisions/${e.expectedRevision}`);
    const fn = await get(`https://cloudfunctions.googleapis.com/v2/${PREFIX}/functions/api`);
    const build = await get(`https://cloudbuild.googleapis.com/v1/${e.build}`);
    const after = await get(serviceUrl);
    if (!service.etag || service.etag !== after.etag ||
        !isDeepStrictEqual(service, after)) throw new Error('SERVICE_CHANGED_DURING_READ');
    return { ...verifyDeployment(e, { service: after, revision, fn, build }),
        capturedAt: new Date().toISOString(), liveRead: true,
        applicationHealth: 'SEPARATE_REQUIRED_GATE', gitToArchiveProof: 'SEPARATE_REQUIRED_GATE' };
}
if (require.main === module) {
    run(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
        // SDK errors can contain Authorization headers and full resource bodies. Never print them.
        console.error('DEPLOYMENT VERIFICATION FAILED. STOP; inspect sanitized gates with an authorized operator.');
        process.exitCode = 1;
    });
}
module.exports = { run };
