'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const testFiles = [
  'shared-sqlite-write-lock.test.js',
  'priority3-race-condition.test.js',
  'priority4-sla-escalation.test.js',
  'priority4-cron.test.js',
  'priority4-integration.test.js',
  'priority4-lifecycle.test.js',
  'priority5-grievance-foundation.test.js',
  'priority5-grievance-workflow.test.js'
];

let failed = false;

for (const file of testFiles) {
  console.log(`\n\n>>> Running ${file}...\n`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n>>> TEST FAILED: ${file}`);
    failed = true;
    break;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('\n>>> ALL PERMANENT TEST SUITES PASSED.');
  process.exit(0);
}
