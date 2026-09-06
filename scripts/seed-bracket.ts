/**
 * Writes tournament/bracket: the field and all 63 game slots.
 *
 * Standings are computed server-side, so the bracket has to live in Firestore
 * rather than only being built in the browser. Otherwise the scoring would run
 * against a different field from the one people picked out of.
 *
 * One aggregated document, not 63: see the read-cost note in the README.
 *
 * Usage:
 *   npx tsx scripts/seed-bracket.ts
 *   npx tsx scripts/seed-bracket.ts --force     (overwrite, LOSES results)
 */


import { buildEmptyBracket, seedBracket } from '../src/engine/bracket.js';
import { sampleField } from '../src/data/sampleField.js';
import { firestore, initAdmin } from './lib/admin-app.js';
import { ScriptExit, run } from './lib/exit.js';

await run(async () => {
  const force = process.argv.includes('--force');

  const { projectId, via } = await initAdmin();
  console.log(`Using ${via} for ${projectId}.`);

  const db = firestore();
  const ref = db.doc('tournament/bracket');

  const existing = await ref.get();
  if (existing.exists && !force) {
    const data = existing.data();
    const decided = (data?.games ?? []).filter((g: { winner: string | null }) => g.winner).length;
    console.log(`tournament/bracket already exists: ${data?.teams?.length ?? 0} teams, ` +
      `${decided} of 63 games decided.`);
    console.log('\nPass --force to overwrite. That discards every recorded result.');
    throw new ScriptExit(0);
  }

  const teams = sampleField();
  const games = seedBracket(buildEmptyBracket(), teams);

  await ref.set({
    // Flipped to false when a real field is imported on Selection Sunday.
    isSampleField: true,
    updatedAt: new Date().toISOString(),
    teams,
    games,
  });

  console.log(`Wrote tournament/bracket${force && existing.exists ? ' (overwritten)' : ''}.`);
  console.log(`  teams   ${teams.length}`);
  console.log(`  games   ${games.length}`);
  console.log(`  sample  true  -- replace before the pool goes live`);

});
