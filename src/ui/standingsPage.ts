/**
 * The leaderboard.
 *
 * Reads ONE aggregated document, tournament/standings, on a live listener --
 * so a viewer costs a single Firestore read and the board updates itself when
 * the sync job recomputes it. Ranking, ceilings and prize allocation are all
 * computed server-side; nothing here recalculates a score.
 */

import { doc, getFirestore, onSnapshot } from 'firebase/firestore';

import { PERFECT_SCORE, formatMoney } from '../engine/index.js';
import type { StandingsDoc } from '../lib/documents.js';
import { escapeHtml } from './bracket.js';

function summary(data: StandingsDoc): string {
  const cells: [string, string][] = [
    ['Brackets in', String(data.entryCount)],
    ['Paid', `${data.paidCount} of ${data.entryCount}`],
    ['Pot', formatMoney(data.potCents)],
    ['Games decided', `${data.gamesDecided} of 63`],
    ['Points left', String(data.pointsRemaining)],
  ];
  return `<dl class="decisions">${cells.map(([k, v]) =>
    `<div class="decision"><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

function board(data: StandingsDoc): string {
  if (data.rows.length === 0) {
    return `<div class="panel"><h2>Leaderboard</h2>
      <p>No submitted brackets yet. Drafts do not appear here &mdash; a
      half-finished bracket would read as someone doing badly rather than
      someone not being done.</p></div>`;
  }

  const showChampion = data.locked;
  const rows = data.rows.map((row) => `<tr>
    <td class="rank">${row.rank}</td>
    <td>${escapeHtml(row.entryName)}<span class="owner">${escapeHtml(row.ownerName)}</span></td>
    <td class="num">${row.points}</td>
    <td class="num soft">${row.maxPossible}</td>
    ${showChampion
      ? `<td>${row.champion
          ? `<span class="${row.championAlive ? 'alive' : 'out'}">${escapeHtml(row.champion)}</span>`
          : '&mdash;'}</td>`
      : ''}
  </tr>`).join('');

  return `<div class="panel">
    <h2>Leaderboard</h2>
    ${data.gamesDecided === 0
      ? `<p class="meta">No games played yet, so everyone is level on 0 with all
         ${PERFECT_SCORE} points still reachable.</p>`
      : ''}
    <div class="scroller">
      <table class="board">
        <thead><tr>
          <th class="rank">#</th><th>Bracket</th>
          <th class="num">Points</th><th class="num">Ceiling</th>
          ${showChampion ? '<th>Champion</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${showChampion ? '' : '<p class="meta">Champion picks are hidden until entries lock.</p>'}
  </div>`;
}

function prizes(data: StandingsDoc): string {
  if (data.paidCount === 0) {
    return `<div class="panel"><h2>Prizes</h2>
      <p>No brackets are paid up yet, so there is nothing to pay out. Only paid
      brackets are eligible.</p></div>`;
  }
  const rows = data.prizes.map((award) => `<tr>
    <td>${escapeHtml(award.label)}</td>
    <td>${escapeHtml(award.entryNames.join(', '))}</td>
    <td class="num">${formatMoney(award.totalCents)}</td>
  </tr>`).join('');
  return `<div class="panel">
    <h2>Projected payouts</h2>
    <div class="scroller"><table class="board">
      <thead><tr><th>Finish</th><th>Bracket</th><th class="num">Pays</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="meta">Based on ${data.paidCount} paid bracket${data.paidCount === 1 ? '' : 's'}.
    Moves as more people pay in.</p>
  </div>`;
}

export function mountStandingsPage(
  root: HTMLElement,
  header: (data: StandingsDoc | null) => string,
): () => void {
  root.innerHTML = header(null) + '<p class="loading">Loading standings…</p>';

  return onSnapshot(
    doc(getFirestore(), 'tournament', 'standings'),
    (snapshot) => {
      if (!snapshot.exists()) {
        root.innerHTML = header(null) + `<div class="panel"><h2>Leaderboard</h2>
          <p>Standings have not been built yet.</p>
          <p class="meta">An admin runs <code>npm run pool:standings</code>.</p></div>`;
        return;
      }
      const data = snapshot.data() as StandingsDoc;
      root.innerHTML = header(data) + summary(data) + board(data) + prizes(data) +
        `<p class="meta">Updated ${new Date(data.updatedAt).toLocaleString()}</p>`;
    },
    (error) => {
      root.innerHTML = header(null) +
        `<div class="error">Could not load standings: ${escapeHtml(error.message)}</div>`;
    },
  );
}

