#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { summarizeExperiments } = require('./session-ab-core');

function main(paths) {
    if (paths.length !== 3) {
        throw new Error('必须提供 cookie-only、minimal-compat、legacy-overlay 三个 evidence JSON');
    }
    const experiments = paths.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    const summary = summarizeExperiments(experiments);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.comparable) process.exitCode = 2;
}

try {
    main(process.argv.slice(2));
} catch (error) {
    console.error(JSON.stringify({ comparable: false, conclusion: 'INVALID_INPUT', error: error.message }));
    process.exitCode = 1;
}
