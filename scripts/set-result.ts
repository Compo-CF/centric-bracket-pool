/**
 * Admin override: set or clear a game's winner by hand.
 *
 * Stamps overriddenBy, which the sync job checks and never touches again --
 * the season ESPN changes shape or gets a result wrong is the season this is
 * the only way to run the pool.
 *
 * Usage:
 *   npm run pool:set-result -- --slot R1-07 --winner duke --score 78-74
 *   npm run pool:set-result -- --slot R1-07 --clear
 */

import { getFirestore } from 'firebase-admin/firestore';

import { applyEliminations, recordResult } from '../src/engine/results.js';
import type { BracketDoc } from '../src/lib/documents.js';
import { initAdmin } from './lib/admin-app.js';
import { ScriptExit, run } from './lib/exit.js';
import { writeStandings } from './lib/standings.js';

await run(async () => {
  const args = process.argv.slice(2);
  const flag = (n: string): string | undefined => {
    const at = args.indexOf(`--${n}`);
    return at >= 0 ? args[at + 1] : undefined;
  };

  const slot = flag('slot');
  const winnerArg = flag('winner');
  const scoreArg = flag('score');
  const clear = args.includes('--clear');

  if (!slot || (!winnerArg && !clear)) {
    console.error('Usage: npm run pool:set-result -- --slot R1-07 --winner <teamId> [--score 78-74]');
    console.error('       npm run pool:set-result -- --slot R1-07 --clear');
    throw new ScriptExit(1);
  }

  const { projectId, via } = await initAdmin();
  console.log(`Using ${via} for ${projectId}.`);

  const db = getFirestore();
  const ref = db.doc('tournament/bracket');
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    console.error('tournament/bracket is missing. Run npm run pool:seed-bracket.');
    throw new ScriptExit(1);
  }

  const bracket = snapshot.data() as BracketDoc;
  const before = bracket.games.find((g) => g.slot === slot);
  if (!before) {
    console.error(`No such slot: ${slot}`);
    throw new ScriptExit(1);
  }

  const named = new Map(bracket.teams.map((t) => [t.id, t.name]));
  console.log(`\n${slot}: ${named.get(before.teamA ?? '') ?? 'TBD'} v ` +
    `${named.get(before.teamB ?? '') ?? 'TBD'}`);
  console.log(`currently: ${before.winner ? named.get(before.winner) : 'undecided'}`);

  let scoreA: number | null = null;
  let scoreB: number | null = null;
  if (scoreArg) {
    const [a, b] = scoreArg.split('-').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      console.error(`Score must look like 78-74, got ${scoreArg}`);
      throw new ScriptExit(1);
    }
    scoreA = a!;
    scoreB = b!;
  }

  let games;
  try {
    games = recordResult(bracket.games, slot, {
      winner: clear ? null : winnerArg!,
      scoreA,
      scoreB,
      status: clear ? 'scheduled' : 'final',
      // Marks this game as an admin decision for good; the sync job skips it.
      overriddenBy: 'admin-cli',
    }, { source: 'admin' });
  } catch (error) {
    console.error(`\n${(error as Error).message}`);
    console.error('\nTeam ids for this slot are shown above. Use the id, not the name.');
    throw new ScriptExit(1);
  }

  await ref.set({
    ...bracket,
    updatedAt: new Date().toISOString(),
    teams: applyEliminations(bracket.teams, games),
    games,
  });

  await db.collection('audit').add({
    at: new Date().toISOString(),
    action: clear ? 'clear-result' : 'set-result',
    slot,
    winner: clear ? null : winnerArg,
    score: scoreArg ?? null,
    by: 'admin-cli',
  });

  const standings = await writeStandings(db);

  console.log(`\n${clear ? 'Cleared' : 'Set'} ${slot}` +
    `${clear ? '' : ` to ${named.get(winnerArg!) ?? winnerArg}`}.`);
  console.log(`games decided      ${standings.gamesDecided} of 63`);
  console.log('This game is now marked as an admin override; the sync job will leave it alone.');

});
