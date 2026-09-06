/**
 * Initialises firebase-admin for the local scripts.
 *
 * Two credential paths, tried in order:
 *
 *   1. serviceAccount.json in the repo root, if present.
 *   2. Application Default Credentials, from `gcloud auth application-default
 *      login`.
 *
 * ADC is the better path and often the only one: the subtlefoodie.com
 * organisation enforces iam.disableServiceAccountKeyCreation, which blocks
 * downloading a key file at all. Nothing long-lived lands on disk either way.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

/** Read the project id from .firebaserc so it is configured in one place. */
function projectIdFromFirebaserc() {
  const path = resolve(root, '.firebaserc');
  if (!existsSync(path)) return undefined;
  try {
    const id = JSON.parse(readFileSync(path, 'utf8'))?.projects?.default;
    return id && id !== 'REPLACE_WITH_PROJECT_ID' ? id : undefined;
  } catch {
    return undefined;
  }
}

function reportNoCredentials() {
  console.error('No usable credentials found.\n');
  console.error('Sign in with gcloud (recommended -- no key file, and the');
  console.error('subtlefoodie.com org policy blocks key creation anyway):\n');
  console.error('  gcloud auth application-default login\n');
  console.error('Or put a serviceAccount.json in the repo root, which needs the org');
  console.error('policy iam.disableServiceAccountKeyCreation relaxed for this project.');
}

/**
 * Async because ADC only fails when a token is first requested, not at
 * initializeApp. Fetching one up front turns a stack trace at some later line
 * into a clear message before any work starts.
 */
export async function initAdmin() {
  const keyPath = resolve(root, 'serviceAccount.json');
  const projectId = projectIdFromFirebaserc();

  if (existsSync(keyPath)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
    return { projectId, via: 'serviceAccount.json' };
  }

  if (!projectId) {
    console.error('No project id. Set projects.default in .firebaserc.');
    process.exit(1);
  }

  const credential = applicationDefault();
  initializeApp({ credential, projectId });

  try {
    await credential.getAccessToken();
  } catch {
    reportNoCredentials();
    process.exit(1);
  }

  return { projectId, via: 'application default credentials' };
}
