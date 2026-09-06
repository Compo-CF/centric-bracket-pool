# Centric Bracket Pool

Company NCAA tournament bracket pool. Static front end on GitHub Pages,
Firestore behind it, results synced from ESPN with an admin override.

63 games, 192 points, one entry per bracket.

## Status

| Phase | What it covers | State |
| --- | --- | --- |
| 0 | Repo, Firebase wiring, Entra sign-in, security rules, deploy | Code done, needs a Firebase project |
| 1 | Bracket engine, scoring, ceilings, validation, prizes | **Done — 96 tests passing** |
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
npm test          # 96 tests
npm run typecheck
npm run dev
```

### Local mode

Without Firebase settings the app still runs: entries are kept in `localStorage` and the bracket uses a sample field. Both are labelled on every screen that shows them. Copy `.env.example` to `.env.local` once the project exists to switch to the real thing.

The UI only ever talks to the `PoolStore` interface in `src/lib/store.ts`, so swapping `LocalStore` for a Firestore implementation is a one-file change.

## Firebase setup

Roughly 30 minutes, except step 3, which waits on IT.

### 1. Firebase project and Firestore

[console.firebase.google.com](https://console.firebase.google.com) &rarr; Add project.
Google Analytics is not needed.

Build &rarr; Firestore Database &rarr; Create database:

- **Production mode.** The rules in this repo replace the defaults in step 6.
- **Location `us-south1` (Dallas)**, or `nam5` for US multi-region.
  **This cannot be changed later.**

### 2. Web app config

Project settings &rarr; General &rarr; Your apps &rarr; Web (`</>`) &rarr; register the app.
Firebase shows a `firebaseConfig` object. Copy `.env.example` to `.env.local`
and paste each value across:

| firebaseConfig key | `.env.local` |
| --- | --- |
| `apiKey` | `VITE_FIREBASE_API_KEY` |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `VITE_FIREBASE_APP_ID` |

Also set `projects.default` in `.firebaserc` to the project id.

### 3. Entra app registration (start this first, it waits on someone else)

Azure portal &rarr; Microsoft Entra ID &rarr; App registrations &rarr; New registration:

- Name: **Centric Bracket Pool**
- Account types: **Accounts in this organizational directory only (single tenant)**
- Redirect URI: **Web**, set to
  `https://<projectId>.firebaseapp.com/__/auth/handler`

From the overview page copy the **Application (client) ID** and the
**Directory (tenant) ID**. The tenant id goes in `VITE_MICROSOFT_TENANT_ID`.

Certificates & secrets &rarr; New client secret. **Copy the Value, not the Secret
ID** — the Value is shown once and cannot be retrieved afterwards.

### 4. Turn on Microsoft sign-in

Firebase console &rarr; Authentication &rarr; Sign-in method &rarr; Microsoft &rarr; Enable.
Paste the application (client) id and the client secret **Value**.

Confirm the callback URL Firebase displays matches the redirect URI from step 3.

### 5. Authorised domains

Authentication &rarr; Settings &rarr; Authorised domains &rarr; Add domain:
**`compo-cf.github.io`**

Miss this and sign-in fails silently in production, with nothing useful in the
console. It is the easiest step to skip and the hardest to diagnose.

### 6. Publish the security rules

```powershell
npm install -g firebase-tools
```

```powershell
cd C:\Users\anthony.compofelice\centric-bracket-pool; firebase login
```

```powershell
cd C:\Users\anthony.compofelice\centric-bracket-pool; firebase deploy --only firestore:rules
```

### 7. Push the config to GitHub

Reads `.env.local` and sets every `VITE_*` as an Actions repository variable, so
the deployed build reads the same configuration as local dev:

```powershell
cd C:\Users\anthony.compofelice\centric-bracket-pool; .\scripts\set-repo-vars.ps1
```

Variables rather than secrets on purpose: the Firebase web config is public by
design, and the security rules are what protect the data.

### 8. Make yourself an admin

`firestore.rules` gates every write to `/tournament` and `/config` on an `admin`
custom claim, so until this runs nobody can operate the pool — not even the
person who created the project.

Sign in to the app once so the account exists. Then Firebase console &rarr;
Project settings &rarr; Service accounts &rarr; Generate new private key, and save the
file as `serviceAccount.json` in the repo root (gitignored — never commit it):

```powershell
cd C:\Users\anthony.compofelice\centric-bracket-pool; node scripts/grant-admin.mjs anthony.compofelice@centricfiber.com
```

Sign out and back in for the new token to take effect.

### Check it worked

```powershell
cd C:\Users\anthony.compofelice\centric-bracket-pool; npm run dev
```

The setup checklist should be gone, replaced by a Microsoft sign-in button. If a
variable is still missing, the page names it.

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

## Pool rules

- **$10 per bracket**, up to 5 brackets per person. Each bracket stands on its
  own and can win its own prize.
- **Last place gets their $10 back**, taken off the top of the pot.
- **What remains is split 50 / 30 / 20** between 1st, 2nd and 3rd. At 30 paid
  entries that is $145 / $87 / $58, with $10 back to last.
- **Tiebreaker** is the total points scored in the championship game, both
  teams added together. Closest without going over wins. Because it settles the
  full ordering, it decides last place as well as first.
- Only paid brackets are eligible for prize money. Unpaid ones still appear on
  the leaderboard.

All prize arithmetic is in integer cents with largest-remainder apportionment,
so the payouts always sum to exactly the money collected. A property test
checks that from 4 to 120 entries.

Ties pool the places they occupy and split them evenly: two entries level for
the lead share 1st and 2nd money, and 3rd is still 3rd.

## Open questions

- Confirm the 50 / 30 / 20 split and the 5-bracket cap — both are single config
  values in `DEFAULT_PRIZE_RULES` and `DEFAULT_MAX_ENTRIES_PER_USER`.
- A women's tournament pool alongside it? Same engine, one more config doc.
- Custom domain, or `compo-cf.github.io/centric-bracket-pool`?
