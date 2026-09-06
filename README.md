# Centric Bracket Pool

Company NCAA tournament bracket pool. Static front end on GitHub Pages,
Firestore behind it, results synced from ESPN with an admin override.

63 games, 192 points, one entry per bracket.

## Status

| Phase | What it covers | State |
| --- | --- | --- |
| 0 | Repo, Firebase wiring, Entra sign-in, security rules, deploy | Code done, needs a Firebase project |
| 1 | Bracket engine, scoring, ceilings, validation | **Done — 76 tests passing** |
| 2 | Bracket entry UI, desktop and mobile | **Done — runs against a local store** |
| 3 | Results sync job, admin override | Not started |
| 4 | Standings, bracket viewer, scoreboard, insights | Not started |
| 5 | Replay the 2026 tournament to prove the scoring | Not started |
| 6 | Dress rehearsal with real colleagues | Not started |
| 7 | Go live on Selection Sunday | Not started |

## How the bracket is modeled

Every game is a **slot**, numbered before anyone knows who is playing in it.
A pick is a `(slot, teamId)` pair. There are 63 slots: `R1-01`…`R1-32`,
`R2-01`…`R2-16`, `R3-01`…`R3-08`, `R4-01`…`R4-04`, `R5-01`, `R5-02`, `R6-01`.

The whole tournament tree comes from one rule:

```
R{n}-{k}  feeds into  R{n+1}-{ceil(k/2)}
```

Odd `k` lands in the destination's `teamA`, even `k` in `teamB`. That holds
across region boundaries and all the way to the title game, so there is no
adjacency table anywhere in this codebase.

Scoring is the doubling ladder — 1, 2, 4, 8, 16, 32 — which makes every round
worth exactly 32 points in aggregate, 192 for a perfect bracket.

## Layout

```
src/engine/     Pure tournament logic. No Firebase, no I/O, fully unit tested.
  types.ts        Shared types and constants
  bracket.ts      Slot arithmetic, seed lines, field seeding
  results.ts      Winner propagation, eliminations, admin override
  scoring.ts      Points, ceilings, ranking, pool-wide numbers
  validate.ts     Pick legality and downstream pruning
src/lib/        Firebase initialisation and Entra sign-in
firestore.rules Security rules
```

Everything in `src/engine` is pure so it can be unit tested in isolation and
run identically in the browser and in the results sync job.

## Local development

```bash
npm install
npm test          # 76 tests
npm run typecheck
npm run dev
```

### Local mode

Without Firebase settings the app still runs: entries are kept in `localStorage` and the bracket uses a sample field. Both are labelled on every screen that shows them. Copy `.env.example` to `.env.local` once the project exists to switch to the real thing.

The UI only ever talks to the `PoolStore` interface in `src/lib/store.ts`, so swapping `LocalStore` for a Firestore implementation is a one-file change.

## Setup still to do

1. **Create the Firebase project** and enable Firestore in Native mode.
2. **Register an app in Entra** (Azure portal → App registrations). Redirect
   URI is `https://<project-id>.firebaseapp.com/__/auth/handler`. Note the
   application (client) ID, a client secret, and the directory (tenant) ID.
3. **Enable Microsoft** in Firebase Auth → Sign-in method, pasting the client
   ID and secret.
4. **Add the Pages domain** to Firebase Auth → Settings → Authorised domains.
   Sign-in fails silently without this.
5. **Publish `firestore.rules`** to the project.
6. **Set repository variables** (Settings → Secrets and variables → Actions →
   Variables) for each `VITE_*` name in `.env.example`.
7. **Enable Pages** with source "GitHub Actions".

## Design decisions worth knowing

**Entries lock Thursday at first tip, not Selection Sunday.** The First Four
resolves Wednesday. Locking on Sunday would leave four slots holding
unresolved teams and invalidate picks through no fault of the entrant.

**Microsoft sign-in, not email magic links.** Defender for Office 365 Safe
Links pre-fetches URLs in inbound mail and can consume a one-time sign-in link
before the recipient clicks it.

**Standings live in one aggregated document, not one per entry.** A
per-entry layout puts a 100-person pool at roughly 240,000 Firestore reads a
day, five times the free tier. One document is 2,000.

**No client ever computes or writes a score.** `/tournament` is written only by
the sync job's service account and by admins. A browser that could write
standings could win the pool from the console.

**The repo is public by design.** Free Actions minutes require it, so no
secrets in code — the service account lives in Actions secrets and the
Firebase web config is public by design, protected by security rules.

## Open questions

- Entry fee, or free with a company-funded prize? A pot is an HR conversation
  first (Texas Penal Code §47.02).
- Entries per person: one, or up to three?
- A women's tournament pool alongside it? Same engine, one more config doc.
- Custom domain, or `compo-cf.github.io/centric-bracket-pool`?
