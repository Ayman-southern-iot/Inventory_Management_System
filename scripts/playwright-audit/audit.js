#!/usr/bin/env node
// Role audit: drives the real SPA as each role through at least ten operations and writes
// results.json plus a screenshot per failure. Usage and rules: .claude/skills/playwright-audit.
//
//   node scripts/playwright-audit/audit.js                  every phase, in order
//   node scripts/playwright-audit/audit.js general im       only phases of those roles, in order
//   node scripts/playwright-audit/audit.js general.a        one phase
//
// Order matters: GENERAL proposes a project, the IM accepts it, GENERAL borrows against it, and
// so on. Running a later phase alone needs the earlier ones to have run against the same data.
const { Audit, CONFIG, sleep } = require('./lib');

const general = require('./roles/general');
const im = require('./roles/im');
const admin = require('./roles/admin');
const approver = require('./roles/approver');

// [phase id, function]
const SEQUENCE = [
  ['general.a', general.a],
  ['im.a', im.a],
  ['admin.a', admin.a],
  ['general.b', general.b],
  ['im.b', im.b],
  ['approver.ayesha', approver.ayesha],
  ['approver.farhan', approver.farhan],
  ['im.c', im.c],
  ['general.c', general.c],
  ['admin.b', admin.b],
];

async function main() {
  const wanted = process.argv.slice(2);
  const chosen = wanted.length
    ? SEQUENCE.filter(([id]) => wanted.some((w) => id === w || id.startsWith(w + '.')))
    : SEQUENCE;
  if (chosen.length === 0) throw new Error(`nothing matches ${wanted.join(' ')}; phases: ${SEQUENCE.map(([id]) => id).join(', ')}`);
  const audit = new Audit();
  // AUDIT_RESUME=<path to a results.json> reuses that run's state (project, requisitions, loans), so a
  // later phase can be developed or re-run against data an earlier full run already created.
  const resumed = process.env.AUDIT_RESUME ? require(require('path').resolve(process.env.AUDIT_RESUME)).state : null;
  const state = resumed || { run: process.env.AUDIT_RUN || Date.now().toString(36).slice(-5) };
  await audit.launch();
  console.log(`audit run ${state.run} against ${CONFIG.base}`);
  try {
    for (const [index, [id, phase]] of chosen.entries()) {
      if (index > 0) await sleep(Number(process.env.AUDIT_ROLE_GAP_MS || 5000));
      console.log(`\n=== ${id}`);
      await phase(audit, state);
    }
  } finally {
    await audit.close();
  }
  const file = audit.save({ run: state.run, base: CONFIG.base, state });
  console.log('\n=== summary', JSON.stringify(audit.summary()));
  console.log('results:', file);
  process.exit(audit.results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

main().catch((error) => {
  console.error('AUDIT CRASHED', error);
  process.exit(2);
});
