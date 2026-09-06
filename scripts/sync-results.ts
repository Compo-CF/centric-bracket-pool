/**
 * Pulls finished games from ESPN, records them, and recomputes standings.
 *
 * Defaults to yesterday through today in UTC, which covers late finishes
 * without re-reading the whole tournament every run.
 *
 * Usage:
 *   npm run pool:sync
 *   npm run pool:sync -- --dry-run
 *   npm run pool:sync -- --from 20270319 --to 20270322
 */

import { getFirestore } from 'firebase-admin/firestore';

import { initAdmin } from './lib/admin-app.js';
import { run } from './lib/exit.js';
import { dateStamp, runSync } from './lib/sync.js';

await run(async () => {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : undefined;
  };

  const from = flag('from') ?? dateStamp(-1);
  const to = flag('to') ?? dateStamp(0);
  const dryRun = args.includes('--dry-run');

  const { projectId, via } = await initAdmin();
  console.log(`Using ${via} for ${projectId}.`);

  const outcome = await runSync(getFirestore(), { from, to, dryRun });

  console.log(`\nESPN window        ${from}-${to}`);
  console.log(`events seen        ${outcome.eventsSeen}`);
  console.log(`newly recorded     ${outcome.recorded.length}`);
  console.log(`games decided      ${outcome.gamesDecided} of 63`);

  for (const r of outcome.recorded) {
    console.log(`  ${r.slot}  ${r.name}`);
  }

  if (outcome.report.skippedOverridden.length > 0) {
    console.log(`\nleft alone (admin override): ${outcome.report.skippedOverridden.join(', ')}`);
  }

  if (outcome.report.unplaced.length > 0) {
    console.log(`\ncould not place ${outcome.report.unplaced.length} finished game(s):`);
    for (const u of outcome.report.unplaced) {
      console.log(`  ${u.teams.join(' v ')} -- ${u.reason}`);
    }
    console.log('\nThese need an admin decision. Nothing was guessed at.');
  }

  if (outcome.dryRun) console.log('\nDRY RUN -- nothing was written.');

});
