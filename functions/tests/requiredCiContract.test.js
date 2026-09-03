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
    'governance-enforcement gap',
    'MERGE AUTHORITY != DEPLOYMENT AUTHORITY.',
  ];
  for (const provision of provisions) expect(section).toContain(provision);

  const jobs = pullRequestJobs(workflows);
  expect(jobs.length).toBeGreaterThan(0);

  for (const requiredCheck of config.requiredChecks) {
    const matches = jobs.filter((job) => job.name === requiredCheck);
    expect(matches).toHaveLength(1);
    if (matches[0].deploy) {
      throw new Error(`Required check points to a deploy job: ${requiredCheck}`);
    }
  }

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
    expect(() => validateRequiredCiContract(canonicalInputs())).not.toThrow();
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
