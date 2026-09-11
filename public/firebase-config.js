// ==========================================================================
// Firebase Authentication & Restricted Members Configuration
// ==========================================================================

/**
 * 1. REPLACE THE PLACEHOLDERS BELOW WITH YOUR FIREBASE PROJECT CONFIG:
 *    You can find these in Firebase Console > Project Settings > General > Your Apps > Web App.
 */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

/**
 * 2. WHITELIST OF AUTHORIZED MEMBERS:
 *    Only users with emails in this list are allowed to access the website.
 *    Anyone else will be automatically denied access and signed out.
 *    Add or remove emails here as needed (in lowercase).
 */
const ALLOWED_MEMBERS = [
  "admin@memoryalbum.com",
  "family@memoryalbum.com",
  "member@memoryalbum.com",
  "owner@example.com",
  "test@example.com",
  "flowtest@example.com"
];

// Determine if Firebase is configured with real credentials or still has placeholders
const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== "YOUR_API_KEY_HERE" &&
  firebaseConfig.projectId !== "YOUR_PROJECT_ID"
);

// Initialize Firebase App if SDK is loaded and credentials are set
let firebaseApp = null;
let firebaseAuth = null;

if (typeof firebase !== 'undefined') {
  if (isFirebaseConfigured) {
    try {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      firebaseAuth = firebase.auth();
      console.log('Firebase Authentication initialized successfully.');
    } catch (err) {
      console.error('Error initializing Firebase:', err);
    }
  } else {
    console.warn(
      'Firebase is currently in Setup / Local Mode with sample allowed members.\n' +
      'To enable live Firebase Auth, paste your config credentials in firebase-config.js.'
    );
  }
}

/**
 * Check if a given email is on the authorized members whitelist.
 * @param {string} email 
 * @returns {boolean}
 */
function isMemberAllowed(email) {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return ALLOWED_MEMBERS.map(m => m.toLowerCase()).includes(clean);
}

// Expose configuration globally
window.FirebaseConfig = {
  config: firebaseConfig,
  isConfigured: isFirebaseConfigured,
  allowedMembers: ALLOWED_MEMBERS,
  isMemberAllowed,
  getApp: () => firebaseApp,
  getAuth: () => firebaseAuth
};
