// ==========================================================================
// Firebase Authentication & Restricted Members Configuration
// ==========================================================================

/**
 * 1. REPLACE THE PLACEHOLDERS BELOW WITH YOUR FIREBASE PROJECT CONFIG:
 *    You can find these in Firebase Console > Project Settings > General > Your Apps > Web App.
 */
const firebaseConfig = {
  apiKey: "AIzaSyCXGXKpQYM0lkinbcG8xKyLnmjXFgD-si4",
  authDomain: "album29-cc9c8.firebaseapp.com",
  projectId: "album29-cc9c8",
  storageBucket: "album29-cc9c8.firebasestorage.app",
  messagingSenderId: "894089529786",
  appId: "1:894089529786:web:ae364e16251bbb6fd33583",
  measurementId: "G-5K0WQFZL46"
};

/**
 * 2. WHITELIST OF AUTHORIZED MEMBERS:
 *    Only users with emails in this list are allowed to access the website.
 *    Anyone else will be automatically denied access and signed out.
 *    Add or remove emails here as needed (in lowercase).
 */
const ALLOWED_MEMBERS = [
  "sahimage691@gmail.com",
  "supriya123@gmail.com",
  "niharika@gmail.com",
  "rijangurung@gmail.com"

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
let firebaseStorage = null;

if (typeof firebase !== 'undefined') {
  if (isFirebaseConfigured) {
    try {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      firebaseAuth = firebase.auth();
      console.log('Firebase Authentication initialized successfully.');
      if (typeof firebase.storage === 'function') {
        firebaseStorage = firebase.storage();
        console.log('Firebase Storage initialized successfully.');
      }
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

function waitForFirebaseAuth(timeoutMs = 3000) {
  return new Promise(resolve => {
    if (!firebaseAuth) return resolve(null);
    if (firebaseAuth.currentUser) return resolve(firebaseAuth.currentUser);
    let resolved = false;
    const unsub = firebaseAuth.onAuthStateChanged(user => {
      if (!resolved) {
        resolved = true;
        try { unsub(); } catch {}
        resolve(user);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { unsub(); } catch {}
        resolve(firebaseAuth.currentUser || null);
      }
    }, timeoutMs);
  });
}

/**
 * Upload an image file directly to Firebase Storage.
 * Returns a permanent, fast-loading HTTPS URL.
 * @param {File} file 
 * @param {string} albumId 
 * @param {Function} [onProgress] Callback with percentage 0-100
 * @returns {Promise<{ url: string, filename: string, sizeBytes: number }>}
 */
async function uploadFileToStorage(file, albumId, onProgress) {
  if (!firebaseStorage) {
    throw new Error('Firebase Storage is not initialized');
  }

  await waitForFirebaseAuth();
  const user = firebaseAuth?.currentUser;
  let userPrefix = user ? user.uid : null;
  if (!userPrefix) {
    try {
      const cached = JSON.parse(localStorage.getItem('memoryAlbumUser') || '{}');
      userPrefix = cached.id || cached.uid;
    } catch {}
  }
  userPrefix = userPrefix || 'member';

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `users/${userPrefix}/albums/${albumId || 'general'}/${timestamp}_${safeName}`;
  const storageRef = firebaseStorage.ref().child(storagePath);

  const metadata = {
    contentType: file.type || 'image/jpeg',
    customMetadata: {
      originalName: file.name,
      albumId: albumId || 'general',
      uploadedAt: new Date().toISOString()
    }
  };

  const uploadTask = storageRef.put(file, metadata);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      snapshot => {
        if (typeof onProgress === 'function' && snapshot.totalBytes > 0) {
          const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(percent);
        }
      },
      err => {
        console.error('Firebase Storage upload error:', err);
        reject(err);
      },
      async () => {
        try {
          const downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();
          resolve({
            url: downloadUrl,
            filename: safeName,
            sizeBytes: file.size
          });
        } catch (urlErr) {
          reject(urlErr);
        }
      }
    );
  });
}

// Expose configuration globally for browser and Node.js
if (typeof window !== 'undefined') {
  window.FirebaseConfig = {
    config: firebaseConfig,
    isConfigured: isFirebaseConfigured,
    allowedMembers: ALLOWED_MEMBERS,
    isMemberAllowed,
    getApp: () => firebaseApp,
    getAuth: () => firebaseAuth,
    getStorage: () => firebaseStorage,
    hasStorage: () => Boolean(firebaseStorage),
    uploadFileToStorage
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    firebaseConfig,
    isFirebaseConfigured,
    ALLOWED_MEMBERS,
    isMemberAllowed
  };
}
