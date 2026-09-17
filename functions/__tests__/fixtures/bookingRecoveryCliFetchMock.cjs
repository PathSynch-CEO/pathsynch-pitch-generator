'use strict';

const fixture = JSON.parse(process.env.SYNCHINTRO_CLI_TEST_RESPONSE || '{}');

global.fetch = async () => ({
    ok: fixture.status >= 200 && fixture.status < 300,
    status: fixture.status,
    async json() {
        if (fixture.invalidJson) throw new SyntaxError('invalid JSON');
        return fixture.body;
    }
});
