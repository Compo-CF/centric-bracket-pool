/**
 * Imports the real 64-team field from ESPN's first-round games.
 *
 * The design assumed 68 teams would be mapped to ESPN ids by hand on Selection
 * Sunday. They do not need to be: the first-round games already carry every
 * team's ESPN id, seed and region, and they are only published once the First
 * Four has resolved -- which is exactly when the field is final.
 *
 * The one thing ESPN cannot tell us in advance is which regions meet in the
 * national semi-finals, because those games do not exist yet. That comes off
 * the published bracket and must be given explicitly: regions 1 and 2 feed
 * R5-01, regions 3 and 4 feed R5-02. Getting it wrong would put the wrong
 * teams in the Final Four, so there is no default.
 *
 * Usage:
 *   npm run pool:import-field -- --from 20270319 --to 20270320 \
 *     --semis "South,East|Midwest,West"
 *   ... add --write to actually store it.
 */

import { getFirestore } from 'firebase-admin/firestore';

import { buildEmptyBracket, seedBracket } from '../src/engine/bracket.js';
import type { RegionIndex, Team } from '../src/engine/types.js';
import { parseScoreboard } from '../src/sync/espn.js';
import { initAdmin } from './lib/admin-app.js';
import { ScriptExit, run } from './lib/exit.js';
import { fetchScoreboard } from './lib/sync.js';

await run(async () => {
  const args = process.argv.slice(2);
  const flag = (n: string): string | undefined => {
    const at = args.indexOf(`--${n}`);
    return at >= 0 ? args[at + 1] : undefined;
  };

  const from = flag('from');
  const to = flag('to');
  const semisArg = flag('semis');
  const write = args.includes('--write');

  if (!from || !semisArg) {
    console.error('Usage: npm run pool:import-field --');
    console.error('  --from YYYYMMDD [--to YYYYMMDD] --semis "South,East|Midwest,West" [--write]');
    console.error('\n--semis is the two national semi-final pairings, in bracket order.');
    throw new ScriptExit(1);
  }

  const semis = semisArg.split('|').map((p) => p.split(',').map((x) => x.trim()));
  if (semis.length !== 2 || semis.some((p) => p.length !== 2)) {
    console.error(`--semis must be two pairs, e.g. "South,East|Midwest,West". Got: ${semisArg}`);
    throw new ScriptExit(1);
  }

  const regionIndex = new Map<string, RegionIndex>();
  semis.forEach((pair, semi) => pair.forEach((name, side) => {
    regionIndex.set(name.toLowerCase(), ((semi * 2) + side + 1) as RegionIndex);
  }));

  const { projectId, via } = await initAdmin();
  console.log(`Using ${via} for ${projectId}.`);

  const espnGames = parseScoreboard(await fetchScoreboard(from, to));
  const firstRound = espnGames.filter((g) => g.round === 1);
  console.log(`\nESPN window        ${from}${to ? `-${to}` : ''}`);
  console.log(`first-round games  ${firstRound.length} (expected 32)`);

  const teams: Team[] = [];
  const problems: string[] = [];

  for (const game of firstRound) {
    if (!game.regionName) {
      problems.push(`${game.competitors.map((c) => c.name).join(' v ')}: no region in headline`);
      continue;
    }
    const region = regionIndex.get(game.regionName.toLowerCase());
    if (!region) {
      problems.push(`unknown region "${game.regionName}" -- check --semis spelling`);
      continue;
    }
    for (const c of game.competitors) {
      if (c.seed === null) {
        problems.push(`${c.name}: no seed`);
        continue;
      }
      teams.push({
        id: c.espnId, name: c.name, seed: c.seed, region, espnId: c.espnId, eliminated: false,
      });
    }
  }

  console.log(`teams found        ${teams.length} (expected 64)`);
  for (const [name, index] of [...regionIndex.entries()].sort((a, b) => a[1] - b[1])) {
    const count = teams.filter((t) => t.region === index).length;
    console.log(`  region ${index}  ${name.padEnd(10)} ${count} teams`);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
  }

  // Refuse rather than store a half-built field: a bad bracket going live is far
  // worse than an import that fails loudly on Selection Sunday.
  let games;
  try {
    games = seedBracket(buildEmptyBracket(), teams);
  } catch (error) {
    console.error(`\nField is not usable: ${(error as Error).message}`);
    throw new ScriptExit(1);
  }

  console.log('\nField seeds cleanly into all 32 round-one slots.');

  if (!write) {
    console.log('\nDry run. Add --write to store it.');
    throw new ScriptExit(0);
  }

  await getFirestore().doc('tournament/bracket').set({
    isSampleField: false,
    updatedAt: new Date().toISOString(),
    teams,
    games,
  });
  console.log('\nWrote tournament/bracket with the real field.');
  console.log('Now run: npm run pool:standings');

});
