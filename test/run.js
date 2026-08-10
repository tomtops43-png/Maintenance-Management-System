#!/usr/bin/env node
/*
 * node test/run.js — runs every *.test.js in this folder.
 *
 * These cover the logic in gas/Code.gs that can't be checked by eye and that
 * nothing else guards: which sheet a job routes to, whether a claimed role is
 * believed, whether a CONFIG migration is safe to re-run, and the MTTR/MTBF
 * arithmetic people make decisions on. Apps Script can't run locally, so each
 * test eval's Code.gs with the Google services stubbed.
 *
 * They exercise pure functions only — nothing here touches a real spreadsheet.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;

for (const f of files) {
  process.stdout.write('\n=== ' + f + ' ===\n');
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' }));
  } catch (e) {
    failed++;
    process.stdout.write((e.stdout || '') + (e.stderr || ''));
  }
}

console.log('\n' + (failed
  ? failed + ' of ' + files.length + ' test files FAILED'
  : 'all ' + files.length + ' test files passed'));
process.exit(failed ? 1 : 0);
