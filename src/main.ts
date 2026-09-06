/**
 * App shell and hash router.
 *
 * Until the Firebase project exists the app runs against a browser-local
 * store and the sample field. Both are labelled wherever they are visible --
 * nothing here pretends to be the real pool.
 */

import './styles.css';
import {
  DEFAULT_WEIGHTS, PERFECT_SCORE, ROUND_NAMES, SLOTS_PER_ROUND, TOTAL_SLOTS,
  buildEmptyBracket, indexTeams, seedBracket, type Round,
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

let cleanup: (() => void) | null = null;

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
     <span class="meta">(${SLOTS_PER_ROUND[r]} games, ${SLOTS_PER_ROUND[r] * DEFAULT_WEIGHTS[r]} available)</span></li>`
  ).join('');

  root.className = 'shell';
  root.innerHTML = `
    <p class="eyebrow">Centric Fiber</p>
    <h1>Centric Bracket Pool</h1>
    <p class="lede">
      ${TOTAL_SLOTS} games, ${PERFECT_SCORE} points, one bracket. Pick every game
      before the first tip on Thursday.
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
      <h2>Deadlines</h2>
      <p>Entries open on Selection Sunday and lock at the first tip on Thursday,
      once the First Four has resolved. Edit as often as you like until then.</p>
    </div>
    <div class="panel">
      <h2>Tiebreaker</h2>
      <p>Predict the combined score of the championship game. Closest without
      going over wins.</p>
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
    <span class="meta">${made} of ${TOTAL_SLOTS} picks</span>
    <button type="button" class="secondary" data-delete="${escapeHtml(entry.id)}">Delete</button>
  </li>`;
}

async function renderEntries(): Promise<void> {
  const entries = await store.list();
  root.className = 'shell';
  root.innerHTML = `
    <p class="eyebrow">Centric Fiber</p>
    <h1>My entries</h1>
    ${localModeBanner()}
    ${nav('#/entries')}
    <div class="panel">
      <h2>Brackets</h2>
      ${entries.length
        ? `<ul class="entry-list">${entries.map(entryRow).join('')}</ul>`
        : '<p>No brackets yet. Start one below.</p>'}
    </div>
    <button type="button" id="new-entry">New bracket</button>
  `;

  root.querySelector<HTMLButtonElement>('#new-entry')!.addEventListener('click', async () => {
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
