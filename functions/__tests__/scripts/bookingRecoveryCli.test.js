'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const SCRIPT = resolve(__dirname, '../../scripts/synchintro-synthetic-recovery.cjs');
const TOKEN = 'operator-token-must-never-be-printed';

function run(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { SYNCHINTRO_OPERATOR_ID_TOKEN: TOKEN })
    });
}

describe('governed synthetic recovery CLI', () => {
    test('pins bearer-token requests to the production API and rejects destination overrides', () => {
        const result = run(['inventory', '--base-url', 'https://attacker.invalid']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Unsupported --base-url argument');
        expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
        const source = readFileSync(SCRIPT, 'utf8');
        expect(source).toContain("const DEFAULT_BASE_URL = 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/v1'");
        expect(source).not.toContain("flags['base-url']");
    });

    test('rejects duplicate flags and requires exact per-record execute confirmation', () => {
        const duplicate = run(['inspect', '--reference', 'ONE', '--reference', 'TWO']);
        expect(duplicate.status).toBe(1);
        expect(duplicate.stderr).toContain('Duplicate --reference argument');
        const mismatch = run([
            'execute',
            '--reference', 'SYNCH-P2-0001_INITIAL',
            '--recovery-operation-id', 'recovery-operation-0001',
            '--confirm', 'SYNCH-P2-0001_REPLACEMENT'
        ]);
        expect(mismatch.status).toBe(1);
        expect(mismatch.stderr).toContain('--confirm must exactly match --reference');
        expect(`${duplicate.stdout}${duplicate.stderr}${mismatch.stdout}${mismatch.stderr}`).not.toContain(TOKEN);
    });
});
