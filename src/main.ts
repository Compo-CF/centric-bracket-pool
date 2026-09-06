/**
 * App shell and hash router.
 *
 * Until the Firebase project exists the app runs against a browser-local
 * store and the sample field. Both are labelled wherever they are visible --
 * nothing here pretends to be the real pool.
 */

import './styles.css';
import {
  DEFAULT_MAX_ENTRIES_PER_USER, DEFAULT_PRIZE_RULES, DEFAULT_WEIGHTS, PERFECT_SCORE,
  PLACE_LABELS, ROUND_NAMES, SLOTS_PER_ROUND, TOTAL_SLOTS,
  apportion, buildEmptyBracket, effectiveSplit, formatMoney, indexTeams, prizePool,
  seedBracket, type Round,
} from './engine/index.js';
import { sampleField } from './data/sampleField.js';
import { isConfigured, missingConfig } from './lib/firebase.js';
import { LocalStore, newEntry, type StoredEntry } from './lib/store.js';
import { escapeHtml } from './ui/bracket.js';
import { mountEntryPage } from './ui/entryPage.js';

const root = document.querySelector<HTMLElement>('#app')!;

const field = sampleField();
const games = seedBracket(buildEmptyBracket(), field);
const teams = indexTeams(field);
const store = new LocalStore();

const prizeRules = DEFAULT_PRIZE_RULES;
const maxEntriesPerUser = DEFAULT_MAX_ENTRIES_PER_USER;

/** Example entry count for the prize table, so the structure is concrete. */
const EXAMPLE_ENTRIES = 30;

let cleanup: (() => void) | null = null;

function prizeTable(entries: number): string {
  const pool = prizePool(entries, prizeRules);
  const shares = apportion(pool.payoutPoolCents, effectiveSplit(entries, prizeRules.split));
  const rows = shares.map((cents, i) =>
    `<tr><td>${PLACE_LABELS[i]}</td><td class="pct">${prizeRules.split[i]}%</td>
     <td class="amt">${formatMoney(cents)}</td></tr>`).join('');
  const refund = pool.refundCents > 0
    ? `<tr class="refund"><td>Last place</td><td class="pct">refund</td>
       <td class="amt">${formatMoney(pool.refundCents)}</td></tr>`
    : '';
  return `<table class="prize-table">
    <thead><tr><th>Finish</th><th class="pct">Share</th><th class="amt">Pays</th></tr></thead>
    <tbody>${rows}${refund}</tbody>
    <tfoot><tr><td>${entries} entries</td><td class="pct"></td>
      <td class="amt">${formatMoney(pool.potCents)}</td></tr></tfoot>
  </table>`;
}

function nav(active: string): string {
  const links = [
    ['#/', 'Rules'],
    ['#/entries', 'My entries'],
  ];
  return `<nav class="topnav">${links.map(([href, label]) =>
    `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}</nav>`;
}

function localModeBanner(): string {
  if (isConfigured()) return '';
  return `<div class="notice">
    <strong>Local mode.</strong> Entries are saved in this browser only, and the
    bracket uses a sample field. Connecting Firebase turns on sign-in, shared
    entries and live scoring. Missing:
    ${missingConfig().map((m) => `<code>${m}</code>`).join(' ')}
  </div>`;
}

function renderHome(): void {
  const ladder = ([1, 2, 3, 4, 5, 6] as Round[]).map((r) =>
    `<li>${escapeHtml(ROUND_NAMES[r])} &mdash; <strong>${DEFAULT_WEIGHTS[r]}</strong>
     point${DEFAULT_WEIGHTS[r] === 1 ? '' : 's'} per game
     <span class="meta">(${SLOTS_PER_ROUND[r]} game${SLOTS_PER_ROUND[r] === 1 ? '' : 's'}, ${SLOTS_PER_ROUND[r] * DEFAULT_WEIGHTS[r]} available)</span></li>`
  ).join('');

  root.className = 'shell';
  root.innerHTML = `
    <p class="eyebrow">Centric Fiber</p>
    <h1>Centric Bracket Pool</h1>
    <p class="lede">
      ${TOTAL_SLOTS} games, ${PERFECT_SCORE} points,
      ${formatMoney(prizeRules.entryFeeCents)} a bracket. Pick every game before
      the first tip on Thursday.
    </p>
    ${localModeBanner()}
    ${nav('#/')}
    <div class="panel">
      <h2>Scoring</h2>
      <ul>${ladder}</ul>
      <p>Every round is worth 32 points in total, so the Final Four matters as
      much as the first weekend. A perfect bracket scores ${PERFECT_SCORE}.</p>
    </div>
    <div class="panel">
      <h2>Entry</h2>
      <p><strong>${formatMoney(prizeRules.entryFeeCents)} per bracket.</strong>
      Enter up to ${maxEntriesPerUser} brackets &mdash; each one costs
      ${formatMoney(prizeRules.entryFeeCents)}, stands on its own, and can win
      its own prize.</p>
      <p class="meta">Payment is recorded by the pool admin. Unpaid brackets
      appear on the leaderboard but are not eligible for prize money.</p>
    </div>
    <div class="panel">
      <h2>Prizes</h2>
      <p>Every entry fee goes back out. Last place gets their
      ${formatMoney(prizeRules.entryFeeCents)} back off the top; the rest is
      split ${prizeRules.split.join('/')} between the top three.</p>
      ${prizeTable(EXAMPLE_ENTRIES)}
      <p class="meta">Example at ${EXAMPLE_ENTRIES} entries. The real figures
      scale with however many brackets are paid up.</p>
    </div>
    <div class="panel">
      <h2>Tiebreaker</h2>
      <p>Predict the <strong>total points scored in the championship game</strong>
      &mdash; both teams added together. Closest without going over wins. It
      settles the top of the board and last place alike.</p>
    </div>
    <div class="panel">
      <h2>Deadlines</h2>
      <p>Entries open on Selection Sunday and lock at the first tip on Thursday,
      once the First Four has resolved. Edit as often as you like until then.</p>
    </div>
    <button type="button" id="go-entries">Go to my entries</button>
  `;

  root.querySelector<HTMLButtonElement>('#go-entries')!
    .addEventListener('click', () => { window.location.hash = '#/entries'; });
}

function entryRow(entry: StoredEntry): string {
  const made = Object.keys(entry.picks).length;
  const submitted = entry.status === 'submitted';
  return `<li>
    <span class="ename"><a href="#/entry/${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</a></span>
    <span class="status-pill${submitted ? ' submitted' : ''}">${submitted ? 'Submitted' : 'Draft'}</span>
    <span class="status-pill${entry.paid ? ' paid' : ' unpaid'}">${
      entry.paid ? 'Paid' : `${formatMoney(prizeRules.entryFeeCents)} due`}</span>
    <span class="meta">${made} of ${TOTAL_SLOTS} picks</span>
    <button type="button" class="secondary" data-delete="${escapeHtml(entry.id)}">Delete</button>
  </li>`;
}

async function renderEntries(): Promise<void> {
  const entries = await store.list();
  const atLimit = entries.length >= maxEntriesPerUser;
  const owed = entries.filter((e) => !e.paid).length * prizeRules.entryFeeCents;
  root.className = 'shell';
  root.innerHTML = `
    <p class="eyebrow">Centric Fiber</p>
    <h1>My entries</h1>
    ${localModeBanner()}
    ${nav('#/entries')}
    <div class="panel">
      <h2>Brackets</h2>
      ${entries.length
        ? `<ul class="entry-list">${entries.map(entryRow).join('')}</ul>
           <p class="meta">${entries.length} of ${maxEntriesPerUser} brackets used
           &middot; ${formatMoney(owed)} owed</p>`
        : '<p>No brackets yet. Start one below.</p>'}
    </div>
    ${atLimit
      ? `<div class="notice">You have used all ${maxEntriesPerUser} brackets.
         Delete one to start another.</div>`
      : `<button type="button" id="new-entry">New bracket</button>`}
  `;

  root.querySelector<HTMLButtonElement>('#new-entry')?.addEventListener('click', async () => {
    const entry = newEntry(`Bracket ${entries.length + 1}`);
    await store.save(entry);
    window.location.hash = `#/entry/${entry.id}`;
  });

  root.querySelector<HTMLElement>('.entry-list')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-delete]');
    if (!button) return;
    const id = button.dataset['delete']!;
    const entry = entries.find((e) => e.id === id);
    if (!window.confirm(`Delete ${entry?.name ?? 'this bracket'}? This cannot be undone.`)) return;
    await store.remove(id);
    void renderEntries();
  });
}

async function renderEntry(id: string): Promise<void> {
  const entry = await store.get(id);
  if (!entry) {
    root.className = 'shell';
    root.innerHTML = `
      <h1>Bracket not found</h1>
      ${nav('#/entries')}
      <div class="panel"><p>That bracket is not in this browser.</p></div>
    `;
    return;
  }
  root.className = 'shell wide';
  cleanup = mountEntryPage(root, {
    store,
    entry,
    games,
    teams,
    usingSampleField: !isConfigured(),
  });
}

function route(): void {
  cleanup?.();
  cleanup = null;
  const path = window.location.hash.replace(/^#/, '') || '/';
  if (path.startsWith('/entry/')) void renderEntry(path.slice('/entry/'.length));
  else if (path === '/entries') void renderEntries();
  else renderHome();
}

window.addEventListener('hashchange', route);
route();
