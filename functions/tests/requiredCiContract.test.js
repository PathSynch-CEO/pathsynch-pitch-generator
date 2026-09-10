'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

const EXPECTED_CHECKS = ['Test & Audit', 'Emulator Tests (rules)'];
const REQUIRED_SECTION_HEADING = '## Required CI Contract (September 3, 2026)';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function loadWorkflows() {
  return fs.readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => ({
      name,
      document: yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8')),
    }));
}

function extractRequiredCiSection(systemBible) {
  const start = systemBible.indexOf(REQUIRED_SECTION_HEADING);
  if (start === -1) throw new Error('Controlling Required CI Contract section is missing');

  const end = systemBible.indexOf('\n---\n', start);
  if (end === -1) throw new Error('Controlling Required CI Contract section is unterminated');
  return systemBible.slice(start, end);
}

function requiredChecksFromProse(section) {
  const block = section.match(
    /### Canonical required checks\n\n([\s\S]*?)(?=\n### |$)/,
  );
  if (!block) throw new Error('Canonical required-check list is missing from SYSTEM_BIBLE');

  return block[1]
    .split('\n')
    .map((line) => line.match(/^- `([^`]+)`$/)?.[1] || null)
    .filter(Boolean);
}

function triggersPullRequestsToMain(workflow) {
  const pullRequest = workflow?.on?.pull_request;
  if (!pullRequest) return false;

  const branches = pullRequest.branches;
  return Array.isArray(branches) && branches.includes('main');
}

function isDeployJob(jobId, job) {
  if (/deploy/i.test(jobId) || /deploy/i.test(String(job?.name || ''))) return true;

  return (job?.steps || []).some((step) =>
    /\bdeploy\b/i.test(`${String(step?.uses || '')}\n${String(step?.run || '')}`),
  );
}

function pullRequestJobs(workflows) {
  return workflows.flatMap(({ name: workflowName, document }) => {
    if (!triggersPullRequestsToMain(document)) return [];

    return Object.entries(document.jobs || {}).map(([jobId, job]) => ({
      workflowName,
      jobId,
      name: job.name || jobId,
      deploy: isDeployJob(jobId, job),
    }));
  });
}

function allWorkflowJobs(workflows) {
  return workflows.flatMap(({ name: workflowName, document }) =>
    Object.entries(document.jobs || {}).map(([jobId, job]) => ({
      workflowName,
      jobId,
      name: job.name || jobId,
      deploy: isDeployJob(jobId, job),
      disabled: job.if === false,
    })),
  );
}

function validateManualCiDispatch(workflows) {
  const matches = workflows.filter(({ document }) => document.name === 'CI');
  expect(matches).toHaveLength(1);
  const workflow = matches[0].document;

  expect(Object.keys(workflow.on).sort()).toEqual(
    ['pull_request', 'push', 'workflow_dispatch'].sort(),
  );
  expect(workflow.on.pull_request).toEqual({ branches: ['main'] });
  expect(workflow.on.push).toEqual({ branches: ['main'] });
  expect(workflow.on.pull_request_target).toBeUndefined();
  expect(workflow.on.workflow_dispatch).toEqual({
    inputs: {
      expected_sha: {
        description: 'Exact 40-character commit SHA expected at the dispatched branch or tag',
        required: true,
        type: 'string',
      },
    },
  });
  expect(workflow.permissions).toEqual({ contents: 'read' });

  for (const jobId of ['test', 'emulator-tests']) {
    const job = workflow.jobs[jobId];
    expect(job).toBeDefined();
    expect(job.if).toBeUndefined();
    expect(job.steps[0]).toEqual({ uses: 'actions/checkout@v4' });
    const verifier = job.steps.find(
      (step) => step.name === 'Verify manually dispatched source SHA',
    );
    expect(verifier).toBeDefined();
    expect(verifier.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(verifier.env).toEqual({
      EXPECTED_SHA: '${{ inputs.expected_sha }}',
      DISPATCH_SHA: '${{ github.sha }}',
    });
    expect(verifier.run).toContain('^[0-9a-f]{40}$');
    expect(verifier.run).toContain('ACTUAL_SHA="$(git rev-parse HEAD)"');
    expect(verifier.run).toContain('"$DISPATCH_SHA" != "$EXPECTED_SHA"');
    expect(verifier.run).toContain('"$ACTUAL_SHA" != "$EXPECTED_SHA"');
  }

  expect(workflow.jobs.test.name).toBe('Test & Audit');
  expect(workflow.jobs['emulator-tests'].name).toBe('Emulator Tests (rules)');
  expect(workflow.jobs.deploy.name).toBe('Deploy to Firebase');
  expect(workflow.jobs.deploy.if).toBe(false);
  expect(workflow.jobs.deploy.permissions).toEqual({
    contents: 'read',
    'id-token': 'write',
  });
}

function validateRequiredCiContract({ config, systemBible, workflows }) {
  expect(Object.keys(config).sort()).toEqual(
    ['requiredChecks', 'schemaVersion', 'targetBranch'].sort(),
  );
  expect(config.schemaVersion).toBe(1);
  expect(config.targetBranch).toBe('main');
  expect(Array.isArray(config.requiredChecks)).toBe(true);
  expect(config.requiredChecks.length).toBeGreaterThan(0);
  expect(new Set(config.requiredChecks).size).toBe(config.requiredChecks.length);

  const section = extractRequiredCiSection(systemBible);
  const proseChecks = requiredChecksFromProse(section);
  expect(proseChecks).toEqual(config.requiredChecks);

  const provisions = [
    'must complete successfully',
    'skipped, missing, pending, cancelled, timed-out, action-required, or failed',
    'Passing these checks is necessary but is not sufficient to make a PR GREEN',
    'PR-body claims, screenshots, badges, local test output, commit messages, or agent assertions cannot substitute',
    'GitHub branch protection or ruleset enforcement is a separate control',
    'active ruleset `main-required-ci`',
    'requires the exact contexts `Test & Audit` and `Emulator Tests (rules)`',
    'runtime reviewer remains dependent on `.github/required-checks.json`, not ruleset metadata',
    'must not request administration permission merely to read repository rulesets',
    'MERGE AUTHORITY != DEPLOYMENT AUTHORITY.',
  ];
  for (const provision of provisions) expect(section).toContain(provision);

  const jobs = pullRequestJobs(workflows);
  const everyWorkflowJob = allWorkflowJobs(workflows);
  expect(jobs.length).toBeGreaterThan(0);

  for (const requiredCheck of config.requiredChecks) {
    const matches = jobs.filter((job) => job.name === requiredCheck);
    expect(matches).toHaveLength(1);
    if (matches[0].deploy) {
      throw new Error(`Required check points to a deploy job: ${requiredCheck}`);
    }

    const repositoryMatches = everyWorkflowJob.filter((job) => job.name === requiredCheck);
    expect(repositoryMatches).toEqual([
      expect.objectContaining({ workflowName: 'ci.yml', deploy: false }),
    ]);
  }

  expect(everyWorkflowJob.filter((job) => job.name === 'Deploy to Firebase')).toEqual([
    expect.objectContaining({ workflowName: 'ci.yml', deploy: true, disabled: true }),
  ]);

  const mergeQualityChecks = jobs.filter((job) => !job.deploy).map((job) => job.name);
  expect(mergeQualityChecks).toEqual(config.requiredChecks);
  expect(config.requiredChecks).toEqual(EXPECTED_CHECKS);
}

function canonicalInputs() {
  return {
    config: JSON.parse(read('.github/required-checks.json')),
    systemBible: read('functions/SYSTEM_BIBLE.md'),
    workflows: loadWorkflows(),
  };
}

function replaceProseCheck(systemBible, from, to) {
  return systemBible.replace(`- \`${from}\``, `- \`${to}\``);
}

describe('required CI governance contract', () => {
  test('pins the exact non-deploy checks produced for pull requests targeting main', () => {
    const inputs = canonicalInputs();
    expect(() => validateRequiredCiContract(inputs)).not.toThrow();
    expect(() => validateManualCiDispatch(inputs.workflows)).not.toThrow();
  });

  test('manual dispatch preserves main triggers and verifies the dispatched SHA', () => {
    expect(() => validateManualCiDispatch(canonicalInputs().workflows)).not.toThrow();
  });

  test('injected manual drift: rejects privileged triggers or permissions', () => {
    for (const mutate of [
      (workflow) => { workflow.on.pull_request_target = {}; },
      (workflow) => { workflow.permissions = { contents: 'write' }; },
    ]) {
      const inputs = canonicalInputs();
      const workflow = inputs.workflows.find(({ document }) => document.name === 'CI').document;
      mutate(workflow);
      expect(() => validateManualCiDispatch(inputs.workflows)).toThrow();
    }
  });

  test('injected manual drift: rejects missing dispatch, verifier, or disabled-deploy guard', () => {
    for (const mutate of [
      (workflow) => { delete workflow.on.workflow_dispatch; },
      (workflow) => {
        workflow.jobs.test.steps = workflow.jobs.test.steps.filter(
          (step) => step.name !== 'Verify manually dispatched source SHA',
        );
      },
      (workflow) => { workflow.jobs.deploy.if = true; },
    ]) {
      const inputs = canonicalInputs();
      const workflow = inputs.workflows.find(({ document }) => document.name === 'CI').document;
      mutate(workflow);
      expect(() => validateManualCiDispatch(inputs.workflows)).toThrow();
    }
  });

  test('injected manual drift: rejects required-check naming collisions from another workflow', () => {
    const inputs = canonicalInputs();
    inputs.workflows.push({
      name: 'unrelated.yml',
      document: {
        name: 'Unrelated',
        on: { workflow_dispatch: {} },
        jobs: {
          collision: {
            name: 'Test & Audit',
            runsOn: 'ubuntu-latest',
            steps: [{ run: 'true' }],
          },
        },
      },
    });

    expect(() => validateRequiredCiContract(inputs)).toThrow();
  });

  test('injected drift A: rejects a governance check renamed without workflow support', () => {
    const inputs = canonicalInputs();
    inputs.config.requiredChecks[0] = 'Renamed Test & Audit';
    inputs.systemBible = replaceProseCheck(
      inputs.systemBible,
      'Test & Audit',
      'Renamed Test & Audit',
    );

    expect(() => validateRequiredCiContract(inputs)).toThrow();
  });

  test('injected drift B: rejects removal from the machine-readable contract', () => {
    const inputs = canonicalInputs();
    inputs.config.requiredChecks = ['Test & Audit'];

    expect(() => validateRequiredCiContract(inputs)).toThrow();
  });

  test('injected drift C: rejects a deploy job used as a required check', () => {
    const inputs = canonicalInputs();
    inputs.config.requiredChecks[1] = 'Deploy to Firebase';
    inputs.systemBible = replaceProseCheck(
      inputs.systemBible,
      'Emulator Tests (rules)',
      'Deploy to Firebase',
    );

    expect(() => validateRequiredCiContract(inputs)).toThrow(
      /Required check points to a deploy job/,
    );
  });

  test('injected drift D: rejects an empty required-check list', () => {
    const inputs = canonicalInputs();
    inputs.config.requiredChecks = [];

    expect(() => validateRequiredCiContract(inputs)).toThrow();
  });

  test('injected drift E: rejects duplicate required-check names', () => {
    const inputs = canonicalInputs();
    inputs.config.requiredChecks = ['Test & Audit', 'Test & Audit'];

    expect(() => validateRequiredCiContract(inputs)).toThrow();
  });
});
