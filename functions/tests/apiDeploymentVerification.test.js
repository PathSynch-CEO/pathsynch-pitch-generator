'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyDeployment, digest, REQUIRED_ENV, REQUIRED_SECRETS, PREFIX } =
    require('../../scripts/lib/api-deployment-verification.cjs');
const { run } = require('../../scripts/verify-api-deployment.cjs');
const serviceName = PREFIX + '/services/api';
const expectedRevision = 'api-00416-hoc';
const revisionName = serviceName + '/revisions/' + expectedRevision;
function fixture() {
    const values = Object.fromEntries(REQUIRED_ENV.map(name => [name, 'synthetic-' + name]));
    values.NYLAS_MIN_BOOKING_NOTICE_MINUTES = '60';
    const e = {
        schemaVersion: 1, project: 'pathsynch-pitch-creation', location: 'us-central1', service: 'api',
        authorizedSha: 'a'.repeat(40), expectedRevision, previousRevision: 'api-00413-feq',
        deploymentStartedAt: '2026-09-08T15:19:00Z',
        revisionUid: '128f8c88-2ee4-49b1-8102-cda61565506a',
        image: 'us-central1-docker.pkg.dev/pathsynch-pitch-creation/gcf-artifacts/api@sha256:' + 'b'.repeat(64),
        build: 'projects/796921234100/locations/us-central1/builds/ca6f5952-2937-4594-ad94-b0bb3adc42ca',
        source: { bucket: 'gcf-v2-sources-796921234100-us-central1', object: 'api/function-source.zip', generation: '1788880755948413' },
        configSha256: Object.fromEntries(Object.entries(values).map(([k,v]) => [k,digest(v)])),
        secretVersions: Object.fromEntries(REQUIRED_SECRETS.map(name => [name, '1']))
    };
    const traffic = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: expectedRevision, percent: 100 }];
    const service = { name: serviceName, latestCreatedRevision: revisionName, latestReadyRevision: revisionName,
        generation: '419', observedGeneration: '419', etag: 'fixture-etag',
        terminalCondition: { state: 'CONDITION_SUCCEEDED' }, traffic, trafficStatuses: structuredClone(traffic) };
    const revision = { name: revisionName, service: 'api', uid: e.revisionUid,
        generation: '1', observedGeneration: '1', createTime: '2026-09-08T15:20:18.458302Z',
        conditions: ['Ready','Active','ContainerHealthy'].map(type => ({type,state:'CONDITION_SUCCEEDED'})),
        containers: [{ image: e.image, env: [
            ...Object.entries(values).map(([name,value])=>({name,value})),
            ...REQUIRED_SECRETS.map(name=>({name,valueSource:{secretKeyRef:{
                secret: 'projects/pathsynch-pitch-creation/secrets/' + name, version:'1'
            }}}))
        ] }] };
    const fn = {name: PREFIX + '/functions/api', environment: 'GEN_2', state:'ACTIVE',
        serviceConfig:{service:serviceName,revision:expectedRevision},
        buildConfig:{build:e.build,runtime:'nodejs22',entryPoint:'api',
            source:{storageSource:e.source}, sourceProvenance:{resolvedStorageSource:e.source}}};
    const build = {name:e.build,status:'SUCCESS',startTime:'2026-09-08T15:19:16Z',finishTime:'2026-09-08T15:20:14Z',
        sourceProvenance:{},results:{buildStepImages:[]}};
    return { e, data: {service,revision,fn,build} };
}
const negativeCases = [
    ['old traffic survives deploy', ({data})=>{data.service.traffic[0].revision='api-00413-feq';}, 'TRAFFIC_UNEXPECTED_REVISION'],
    ['desired updated but observed old', ({data})=>{data.service.trafficStatuses[0].revision='api-00413-feq';}, 'TRAFFIC_UNEXPECTED_REVISION'],
    ['unexpected split', ({data})=>{data.service.trafficStatuses[0].percent=90;data.service.trafficStatuses.push({type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',revision:'api-00415-bad',percent:10});}, 'TRAFFIC_UNEXPECTED_REVISION'],
    ['latest created raced', ({data})=>{data.service.latestCreatedRevision=serviceName+'/revisions/api-00417-new';}, 'LATEST_CREATED_MISMATCH'],
    ['latest ready remains old', ({data})=>{data.service.latestReadyRevision=serviceName+'/revisions/api-00413-feq';}, 'LATEST_READY_MISMATCH'],
    ['unknown reconciliation', ({data})=>{delete data.service.observedGeneration;}, 'SERVICE_NOT_RECONCILED'],
    ['generation pending', ({data})=>{data.service.observedGeneration='418';}, 'SERVICE_NOT_RECONCILED'],
    ['service reconciling', ({data})=>{data.service.reconciling=true;}, 'SERVICE_NOT_RECONCILED'],
    ['service not ready', ({data})=>{delete data.service.terminalCondition;}, 'SERVICE_NOT_READY'],
    ['missing traffic', ({data})=>{delete data.service.traffic;}, 'TRAFFIC_MISSING'],
    ['empty observed traffic', ({data})=>{data.service.trafficStatuses=[];}, 'TRAFFIC_MISSING'],
    ['partial traffic', ({data})=>{data.service.trafficStatuses[0].percent=99;}, 'TRAFFIC_NOT_100'],
    ['string traffic percentage', ({data})=>{data.service.trafficStatuses[0].percent='100';}, 'TRAFFIC_PERCENT'],
    ['NaN traffic percentage', ({data})=>{data.service.trafficStatuses[0].percent=NaN;}, 'TRAFFIC_PERCENT'],
    ['unresolved observed latest', ({data})=>{data.service.trafficStatuses[0].type='TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST';}, 'TRAFFIC_TYPE'],
    ['foreign zero-percent tag', ({data})=>{data.service.traffic.push({type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',revision:'api-00413-feq',tag:'old'});}, 'TRAFFIC_TAG'],
    ['same revision reused', ({e})=>{e.previousRevision=e.expectedRevision;}, 'EXPECTATION_NEW_REVISION'],
    ['foreign project', ({e})=>{e.project='other-project';}, 'EXPECTATION_TARGET'],
    ['revision path injection', ({e})=>{e.expectedRevision='../other';}, 'EXPECTATION_NEW_REVISION'],
    ['old revision creation time', ({data})=>{data.revision.createTime='2026-09-06T00:00:00Z';}, 'REVISION_PREDATES_DEPLOYMENT'],
    ['deleted revision', ({data})=>{data.revision.deleteTime='2026-09-08T17:00:00Z';}, 'REVISION_IDENTITY'],
    ['wrong immutable identity', ({data})=>{data.revision.uid='different';}, 'REVISION_IDENTITY'],
    ['retired revision', ({data})=>{data.revision.conditions[1].state='CONDITION_FAILED';}, 'REVISION_ACTIVE'],
    ['image imported without health', ({data})=>{data.revision.conditions.pop();}, 'REVISION_CONTAINERHEALTHY'],
    ['duplicate health conditions', ({data})=>{data.revision.conditions.push(data.revision.conditions[0]);}, 'REVISION_READY'],
    ['wrong image', ({data})=>{data.revision.containers[0].image+='changed';}, 'REVISION_IMAGE'],
    ['missing notice', ({data})=>{data.revision.containers[0].env=data.revision.containers[0].env.filter(v=>v.name!=='NYLAS_MIN_BOOKING_NOTICE_MINUTES');}, 'CONFIG_NYLAS_MIN_BOOKING_NOTICE_MINUTES'],
    ['wrong notice', ({data})=>{data.revision.containers[0].env.find(v=>v.name==='NYLAS_MIN_BOOKING_NOTICE_MINUTES').value='0';}, 'CONFIG_NYLAS_MIN_BOOKING_NOTICE_MINUTES'],
    ['weakened notice expectation', ({e})=>{e.configSha256.NYLAS_MIN_BOOKING_NOTICE_MINUTES=digest('0');}, 'EXPECTATION_NOTICE'],
    ['changed CORS', ({data})=>{data.revision.containers[0].env.find(v=>v.name==='SYNCHINTRO_ALLOWED_ORIGINS').value='*';}, 'CONFIG_SYNCHINTRO_ALLOWED_ORIGINS'],
    ['duplicate env', ({data})=>{data.revision.containers[0].env.push(data.revision.containers[0].env[0]);}, 'ENV_SHAPE'],
    ['plaintext provider key', ({data})=>{const env=data.revision.containers[0].env.find(v=>v.name==='NYLAS_API_KEY');delete env.valueSource;env.value='synthetic-not-a-key';}, 'SECRET_BINDING_SET'],
    ['missing secret', ({data})=>{data.revision.containers[0].env.pop();}, 'SECRET_BINDING_SET'],
    ['changed secret version', ({data})=>{data.revision.containers[0].env.at(-1).valueSource.secretKeyRef.version='2';}, 'SECRET_BINDING_NYLAS_API_KEY'],
    ['mutable secret expectation', ({e})=>{e.secretVersions.NYLAS_API_KEY='latest';}, 'EXPECTATION_SECRET_VERSIONS'],
    ['function revision old', ({data})=>{data.fn.serviceConfig.revision='api-00413-feq';}, 'FUNCTION_IDENTITY'],
    ['function source generation old', ({data})=>{data.fn.buildConfig.source={storageSource:{...data.fn.buildConfig.source.storageSource,generation:'1'}};}, 'FUNCTION_SOURCE'],
    ['missing resolved source', ({data})=>{delete data.fn.buildConfig.sourceProvenance;}, 'FUNCTION_SOURCE'],
    ['unrelated build', ({data})=>{data.build.name+='other';}, 'BUILD_NOT_SUCCESS'],
    ['build failed', ({data})=>{data.build.status='FAILURE';}, 'BUILD_NOT_SUCCESS'],
    ['old successful build', ({data})=>{data.build.startTime='2026-09-06T00:00:00Z';}, 'BUILD_TIMING']
];
test('accepts recovered explicit revision at 100%',()=>{const {e,data}=fixture();expect(verifyDeployment(e,data).status).toBe('PASS');});
test('accepts LATEST desired policy only when observed target is exact',()=>{const {e,data}=fixture();data.service.traffic=[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}];expect(verifyDeployment(e,data).status).toBe('PASS');});
test.each(negativeCases)('fails closed: %s',(_name,change,code)=>{const f=fixture();change(f);expect(()=>verifyDeployment(f.e,f.data)).toThrow(code);});
let dir;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'api-deploy-verifier-'));});
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
function expectationFile(e) { const file=path.join(dir,'expect.json');fs.writeFileSync(file,JSON.stringify(e));return file; }
test('runner emits only five fixed read-only requests and safe result',async()=>{
    const {e,data}=fixture();const responses=[data.service,data.revision,data.fn,data.build,data.service];
    const request=jest.fn(async options=>({data:responses.shift()}));
    const result=await run(['--expect',expectationFile(e)],{makeClient:async()=>({request})});
    expect(result.liveRead).toBe(true);
    expect(request).toHaveBeenCalledTimes(5);
    for(const [options] of request.mock.calls) {
        expect(options.method).toBe('GET');expect(options.timeout).toBe(30000);
        expect(options.maxRedirects).toBe(0);expect(options).not.toHaveProperty('data');
        expect(new URL(options.url).hostname).toMatch(/^(run|cloudfunctions|cloudbuild)\.googleapis\.com$/);
    }
    expect(JSON.stringify(result)).not.toContain('synthetic-');
});
test('service changes during read fail',async()=>{
    const {e,data}=fixture();const responses=[data.service,data.revision,data.fn,data.build,{...data.service,etag:'changed'}];
    await expect(run(['--expect',expectationFile(e)],{makeClient:async()=>({request:async()=>({data:responses.shift()})})})).rejects.toThrow('SERVICE_CHANGED_DURING_READ');
});
test('invalid expectation fails before authentication or network',async()=>{
    const {e}=fixture();e.project='other';const makeClient=jest.fn();
    await expect(run(['--expect',expectationFile(e)],{makeClient})).rejects.toThrow('EXPECTATION_TARGET');
    expect(makeClient).not.toHaveBeenCalled();
});
test('CLI failure is nonzero and never echoes input or SDK details',()=>{
    const file=path.join(dir,'invalid.json');fs.writeFileSync(file,'SENSITIVE_SENTINEL');
    const child=spawnSync(process.execPath,[path.resolve(__dirname,'../../scripts/verify-api-deployment.cjs'),'--expect',file],{encoding:'utf8'});
    expect(child.status).toBe(1);expect(child.stdout).toBe('');expect(child.stderr).not.toContain('SENSITIVE_SENTINEL');
    expect(child.stderr).toContain('DEPLOYMENT VERIFICATION FAILED');
});

test.each(['2026-09-08T15:19:00','2026-09-08','2026-02-30T15:19:00Z','2026-09-08T11:19:00-04:00'])('rejects noncanonical UTC deployment boundary: %s',value=>{const {e,data}=fixture();e.deploymentStartedAt=value;expect(()=>verifyDeployment(e,data)).toThrow('EXPECTATION_START');});
test('service map ordering is not a concurrent change',async()=>{const {e,data}=fixture();data.service.labels={a:'1',b:'2'};const after={...data.service,labels:{b:'2',a:'1'}};const responses=[data.service,data.revision,data.fn,data.build,after];await expect(run(['--expect',expectationFile(e)],{makeClient:async()=>({request:async()=>({data:responses.shift()})})})).resolves.toMatchObject({status:'PASS'});});
test('same-etag changed traffic still fails',async()=>{const {e,data}=fixture();const after=structuredClone(data.service);after.trafficStatuses[0].revision='api-00413-feq';const responses=[data.service,data.revision,data.fn,data.build,after];await expect(run(['--expect',expectationFile(e)],{makeClient:async()=>({request:async()=>({data:responses.shift()})})})).rejects.toThrow('SERVICE_CHANGED_DURING_READ');});
