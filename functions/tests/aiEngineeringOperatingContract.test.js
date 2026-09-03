const fs = require('fs');
const path = require('path');

const contractPath = path.join(__dirname, '..', 'SYSTEM_BIBLE.md');
const systemBible = fs.readFileSync(contractPath, 'utf8');

function extractOperatingContract(text) {
  const heading = '## AI Engineering Operating Contract (September 3, 2026)';
  const start = text.indexOf(heading);
  const end = text.indexOf('\n---\n', start);

  if (start === -1 || end === -1) {
    throw new Error('Canonical AI Engineering Operating Contract section is missing');
  }

  return text.slice(start, end);
}

const contract = extractOperatingContract(systemBible);

const AUTOMATIC_EXCLUSIONS = [
  'authentication / authorization',
  'workspace entitlements',
  'Firebase / Storage rules',
  'billing / Stripe / credits',
  'secrets / credentials',
  'GitHub Actions permissions',
  'OAuth',
  'Nylas',
  'Attio credentials or data authority',
  'SendGrid / Twilio consent or delivery',
  'Universal Tag ingest security',
  'PII / privacy / retention',
  'rate limiting',
  'webhook authentication',
  'dependency/security remediation',
  'schema migrations',
  'destructive data operations',
  'production/deployment infrastructure',
  'cross-repo contracts',
];

function validateOperatingContract(text) {
  const requiredStatements = [
    ['Codex prohibition', 'Codex may never merge or deploy.'],
    [
      'ChatGPT GREEN-only merge authority',
      "ChatGPT Merge Seat may merge only qualifying GREEN PRs under Charles Berry's standing authorization.",
    ],
    [
      'Charles YELLOW/RED authority',
      'Charles Berry retains final authority for all YELLOW / RED merges.',
    ],
    ['merge-deploy separation', 'MERGE AUTHORITY != DEPLOYMENT AUTHORITY.'],
  ];

  for (const [label, statement] of requiredStatements) {
    if (!text.includes(statement)) {
      throw new Error(`Missing required governance statement: ${label}`);
    }
  }

  for (const exclusion of AUTOMATIC_EXCLUSIONS) {
    if (!text.includes(`- ${exclusion}`)) {
      throw new Error(`Missing automatic exclusion: ${exclusion}`);
    }
  }
}

describe('AI engineering operating contract', () => {
  test('canonical governance preserves role authority, deployment separation, and exclusions', () => {
    expect(() => validateOperatingContract(contract)).not.toThrow();
  });

  test('rejects drift granting Codex merge authority', () => {
    const drifted = contract.replace('Codex may never merge', 'Codex may merge');

    expect(drifted).not.toBe(contract);
    expect(() => validateOperatingContract(drifted)).toThrow(/Codex prohibition/);
  });

  test('rejects drift equating merge and deployment authority', () => {
    const drifted = contract.replace(
      'MERGE AUTHORITY != DEPLOYMENT AUTHORITY.',
      'MERGE AUTHORITY == DEPLOYMENT AUTHORITY.',
    );

    expect(drifted).not.toBe(contract);
    expect(() => validateOperatingContract(drifted)).toThrow(/merge-deploy separation/);
  });

  test('rejects removal of an automatic exclusion', () => {
    const drifted = contract.replace('- webhook authentication', '');

    expect(drifted).not.toBe(contract);
    expect(() => validateOperatingContract(drifted)).toThrow(
      /automatic exclusion: webhook authentication/,
    );
  });
});
