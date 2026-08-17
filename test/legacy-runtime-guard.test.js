'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('legacy runtime guard', () => {
    it('exits before loading the legacy service unless explicitly unlocked', () => {
        const env = { ...process.env };
        delete env.ALLOW_LEGACY_RUNTIME;
        const result = spawnSync(process.execPath, ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env,
            encoding: 'utf8',
            timeout: 5000
        });

        expect(result.status).toBe(78);
        expect(result.stderr).toContain('Legacy runtime is locked');
        expect(result.stdout).toBe('');
    });
});
