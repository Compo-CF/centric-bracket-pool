/**
 * Recomputes tournament/standings from the entries and the current bracket.
 *
 * Run by hand now; called by the results sync job once that lands, in the same
 * pass that records a winner.
 *
 * Usage:
 *   npm run pool:standings
 */

import { getFirestore } from 'firebase-admin/firestore';

import { formatMoney } from '../src/engine/index.js';
import { initAdmin } from './lib/admin-app.js';
import { run } from './lib/exit.js';
import { writeStandings } from './lib/standings.js';

await run(async () => {
  const { projectId, via } = await initAdmin();
  console.log(`Using ${via} for ${projectId}.\n`);

  const doc = await writeStandings(getFirestore());

  console.log(`Wrote tournament/standings.`);
  console.log(`  submitted entries  ${doc.entryCount}`);
  console.log(`  paid               ${doc.paidCount}  (pot ${formatMoney(doc.potCents)})`);
  console.log(`  games decided      ${doc.gamesDecided} of 63`);
  console.log(`  points remaining   ${doc.pointsRemaining}`);

  if (doc.rows.length === 0) {
    console.log('\nNo submitted entries yet, so the leaderboard is empty.');
  } else {
    console.log('\n  rank  points  max  entry');
    for (const row of doc.rows.slice(0, 10)) {
      console.log(`  ${String(row.rank).padStart(4)}  ${String(row.points).padStart(6)}` +
        `  ${String(row.maxPossible).padStart(3)}  ${row.entryName} (${row.ownerName})`);
    }
  }

  if (doc.prizes.length > 0) {
    console.log('\n  projected payouts');
    for (const award of doc.prizes) {
      console.log(`  ${award.label.padEnd(16)} ${formatMoney(award.totalCents).padStart(9)}` +
        `  ${award.entryNames.join(', ')}`);
    }
  }

});
