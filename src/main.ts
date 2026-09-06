/**
 * Phase 0 shell: proves Entra sign-in works end to end. The bracket entry UI
 * is Phase 2 -- this page deliberately shows nothing it cannot actually do.
 */

import './styles.css';
import { ALLOWED_EMAIL_DOMAIN, isConfigured, missingConfig } from './lib/firebase.js';
import { AuthError, onUserChange, signIn, signOut, type User } from './lib/auth.js';
import { PERFECT_SCORE, TOTAL_SLOTS } from './engine/index.js';

const app = document.querySelector<HTMLElement>('#app')!;

function header(): string {
  return `
    <p class="eyebrow">Centric Fiber</p>
    <h1>Centric Bracket Pool</h1>
  `;
}

function renderSetupNeeded(): void {
  const missing = missingConfig();
  app.innerHTML = `
    ${header()}
    <p class="lede">
      The bracket engine is built and tested. Connecting it to Firebase is the
      next step.
    </p>
    <div class="panel">
      <h2>Setup still needed</h2>
      <ol>
        <li>Create the Firebase project and enable Firestore.</li>
        <li>Register an app in Entra and add Microsoft as a Firebase Auth provider.</li>
        <li>Add the Pages domain to Firebase&rsquo;s authorised domains.</li>
        <li>Publish <code>firestore.rules</code>.</li>
        <li>Set the repository variables listed below.</li>
      </ol>
      <div class="notice">
        Missing configuration: ${missing.map((m) => `<code>${m}</code>`).join(', ')}
      </div>
    </div>
  `;
}

function renderSignedOut(error?: string): void {
  app.innerHTML = `
    ${header()}
    <p class="lede">
      ${TOTAL_SLOTS} games, ${PERFECT_SCORE} points, one bracket. Sign in with your
      Centric account to get started.
    </p>
    <div class="panel">
      <h2>Sign in</h2>
      <p class="who">Open to ${ALLOWED_EMAIL_DOMAIN} accounts.</p>
      <button id="sign-in" type="button">Sign in with Microsoft</button>
      ${error ? `<div class="error">${error}</div>` : ''}
    </div>
  `;

  const button = app.querySelector<HTMLButtonElement>('#sign-in')!;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await signIn();
    } catch (caught) {
      const message = caught instanceof AuthError
        ? caught.message
        : 'Sign-in failed. Try again, or tell Anthony if it keeps happening.';
      renderSignedOut(message);
    }
  });
}

function renderSignedIn(user: User): void {
  app.innerHTML = `
    ${header()}
    <p class="who">Signed in as ${user.email}</p>
    <div class="panel">
      <h2>Not open yet</h2>
      <p>
        Bracket entry opens on Selection Sunday and locks at the first tip on
        Thursday, once the First Four has resolved.
      </p>
    </div>
    <button id="sign-out" class="secondary" type="button">Sign out</button>
  `;
  app.querySelector<HTMLButtonElement>('#sign-out')!
    .addEventListener('click', () => { void signOut(); });
}

function start(): void {
  if (!isConfigured()) {
    renderSetupNeeded();
    return;
  }
  onUserChange((user) => {
    if (user) renderSignedIn(user);
    else renderSignedOut();
  });
}

start();
