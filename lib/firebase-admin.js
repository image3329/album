// ==========================================================================
// Firebase Admin & Token Verification Service
// ==========================================================================
const admin = require('firebase-admin');
const { initializeApp, getApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'album29-cc9c8';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
let PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;

if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
  PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
}

// Module-level cached instances
let firebaseApp = null;
let firebaseAuth = null;
let firestoreDb = null;
let storageBucket = null;
let hasLoggedMode = false;


function getActiveApps() {
  try {
    const apps = getApps();
    if (Array.isArray(apps) && apps.length > 0) return apps;
  } catch {}
  if (Array.isArray(admin.apps) && admin.apps.length > 0) return admin.apps;
  return [];
}

function hasCredentials() {
  return Boolean(
    (CLIENT_EMAIL && PRIVATE_KEY) ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT
  );
}

function initFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  const apps = getActiveApps();
  if (apps.length > 0) {
    firebaseApp = apps[0];
    return firebaseApp;
  }

  if (!hasCredentials()) {
    if (!hasLoggedMode) {
      console.log('Firebase Admin: Running with Google TokenInfo verification & local persistent store (Set FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY for live Firestore Admin writes).');
      hasLoggedMode = true;
    }
    return null;
  }

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      firebaseApp = initializeApp({
        credential: cert(sa),
        storageBucket: `${PROJECT_ID}.firebasestorage.app`
      });
    } else if (CLIENT_EMAIL && PRIVATE_KEY) {
      firebaseApp = initializeApp({
        credential: cert({
          projectId: PROJECT_ID,
          clientEmail: CLIENT_EMAIL,
          privateKey: PRIVATE_KEY
        }),
        storageBucket: `${PROJECT_ID}.firebasestorage.app`
      });
    } else {
      firebaseApp = initializeApp({
        projectId: PROJECT_ID,
        storageBucket: `${PROJECT_ID}.firebasestorage.app`
      });
    }

    console.log(`Firebase Admin initialized successfully for project ${PROJECT_ID}.`);
    return firebaseApp;
  } catch (err) {
    console.warn('Firebase Admin initialization note:', err.message);
    const existing = getActiveApps();
    if (existing.length > 0) {
      firebaseApp = existing[0];
      return firebaseApp;
    }
    return null;
  }
}

// Initialize on load
initFirebaseAdmin();

function getAdminAuth() {
  const app = initFirebaseAdmin();
  if (!app) return null;
  if (!firebaseAuth) {
    try {
      firebaseAuth = getAuth(app);
    } catch (err) {
      console.warn('Could not get Admin Auth instance:', err.message);
    }
  }
  return firebaseAuth;
}

/**
 * Verifies a Firebase ID token securely.
 * Uses Firebase Admin SDK if service account is configured,
 * or falls back to Google's public token verification endpoint.
 *
 * @param {string} idToken
 * @returns {Promise<{ uid: string, email: string, name?: string }>}
 */
async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing or invalid ID token');
  }

  // 1. Try Firebase Admin SDK verification using initialized Admin Auth instance
  const auth = getAdminAuth();
  if (auth) {
    try {
      const decoded = await auth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: (decoded.email || '').toLowerCase().trim(),
        name: decoded.name || decoded.displayName || ''
      };
    } catch (adminErr) {
      // If Admin verification fails (e.g. clock skew, mock token), try Google TokenInfo fallback
      console.warn('Admin token verification note:', adminErr.message);
    }
  }

  // 2. Cryptographic verification via Google Identity TokenInfo endpoint
  try {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google token verification failed (${res.status}): ${errText}`);
    }
    const tokenInfo = await res.json();

    // Verify audience matches our Firebase Project ID
    if (tokenInfo.aud !== PROJECT_ID && tokenInfo.app_id !== PROJECT_ID) {
      throw new Error(`Token audience mismatch: expected ${PROJECT_ID}, got ${tokenInfo.aud}`);
    }

    return {
      uid: tokenInfo.user_id || tokenInfo.sub,
      email: (tokenInfo.email || '').toLowerCase().trim(),
      name: tokenInfo.name || ''
    };
  } catch (err) {
    throw new Error(`Failed to verify Firebase ID token: ${err.message}`);
  }
}

function getFirestoreDb() {
  const app = initFirebaseAdmin();
  if (!app) return null;
  if (!firestoreDb) {
    try {
      firestoreDb = getFirestore(app);
    } catch (err) {
      console.warn('Could not get Firestore instance:', err.message);
    }
  }
  return firestoreDb;
}

function getStorageBucket() {
  const app = initFirebaseAdmin();
  if (!app) return null;
  if (!storageBucket) {
    try {
      storageBucket = getStorage(app).bucket();
    } catch (err) {
      console.warn('Could not get Storage bucket:', err.message);
    }
  }
  return storageBucket;
}

module.exports = {
  admin,
  initFirebaseAdmin,
  verifyIdToken,
  getFirestoreDb,
  getStorageBucket,
  getAdminAuth,
  PROJECT_ID
};
