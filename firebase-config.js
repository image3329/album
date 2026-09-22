// ==========================================================================
// Firebase Authentication & Restricted Members Configuration
// ==========================================================================

/**
 * 1. FIREBASE PROJECT CONFIG:
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
 * 2. CLOUDINARY CONFIGURATION FOR PHOTO UPLOADS:
 */
const CLOUDINARY_CONFIG = {
  cloudName: 'jovx23un',
  uploadPreset: 'memory_album_uploads',
  uploadUrl: 'https://api.cloudinary.com/v1_1/jovx23un/image/upload'
};

/**
 * 3. WHITELIST OF AUTHORIZED MEMBERS:
 *    Only users with emails in this list are allowed to access the website.
 *    Anyone else will be automatically denied access and signed out.
 */
const ALLOWED_MEMBERS = [
  "image@gmail.com",
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
let firebaseFirestore = null;

if (typeof firebase !== 'undefined') {
  if (isFirebaseConfigured) {
    try {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      firebaseAuth = firebase.auth();
      console.log('Firebase Authentication initialized successfully.');
      if (typeof firebase.firestore === 'function') {
        firebaseFirestore = firebase.firestore();
        console.log('Cloud Firestore initialized successfully.');
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

function waitForFirebaseAuth(timeoutMs = 1500) {
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

function isFirebaseUserSignedIn() {
  return Boolean(firebaseAuth && firebaseAuth.currentUser);
}

/**
 * Upload an image file directly to Cloudinary using unsigned upload preset with real-time progress reporting.
 * Returns the secure HTTPS URL from Cloudinary.
 *
 * @param {File} file 
 * @param {string} [albumId] 
 * @param {Function} [onProgress] Callback with percentage 0-100
 * @param {number} [timeoutMs] Max time before aborting (default 60000ms)
 * @returns {Promise<{ url: string, filename: string, sizeBytes: number, publicId: string }>}
 */
function uploadFileToCloudinary(file, albumId, onProgress, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!file) {
      return reject(new Error('No file provided for upload.'));
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    if (albumId) {
      formData.append('folder', `albums/${albumId}`);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', CLOUDINARY_CONFIG.uploadUrl, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function' && event.total > 0) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        try { xhr.abort(); } catch {}
        reject(new Error('Photo upload timed out after 60 seconds. Please check your network connection.'));
      }
    }, timeoutMs);

    xhr.onload = () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);

      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && (data.secure_url || data.url)) {
          resolve({
            url: data.secure_url || data.url,
            filename: file.name || data.original_filename || 'image',
            sizeBytes: data.bytes || file.size || 0,
            publicId: data.public_id
          });
        } else {
          const errorMsg = data.error?.message || `Upload failed with status ${xhr.status}`;
          reject(new Error(errorMsg));
        }
      } catch (err) {
        reject(new Error(`Invalid response from storage service: ${err.message}`));
      }
    };

    xhr.onerror = () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      reject(new Error('Network error during photo upload. Please check your internet connection.'));
    };

    xhr.send(formData);
  });
}

// Alias uploadFileToStorage directly to Cloudinary upload to guarantee no Firebase Storage upload is ever triggered
async function uploadFileToStorage(file, albumId, onProgress, timeoutMs = 60000) {
  return uploadFileToCloudinary(file, albumId, onProgress, timeoutMs);
}

// Expose configuration globally for browser and Node.js
if (typeof window !== 'undefined') {
  window.FirebaseConfig = {
    config: firebaseConfig,
    isConfigured: isFirebaseConfigured,
    allowedMembers: ALLOWED_MEMBERS,
    isMemberAllowed,
    isUserSignedIn: isFirebaseUserSignedIn,
    getApp: () => firebaseApp,
    getAuth: () => firebaseAuth,
    getFirestore: () => firebaseFirestore,
    hasFirestore: () => Boolean(firebaseFirestore),
    uploadFileToStorage: uploadFileToCloudinary,
    uploadFileToCloudinary,
    cloudinaryConfig: CLOUDINARY_CONFIG
  };
  window.CloudinaryConfig = CLOUDINARY_CONFIG;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    firebaseConfig,
    isFirebaseConfigured,
    ALLOWED_MEMBERS,
    isMemberAllowed,
    CLOUDINARY_CONFIG,
    uploadFileToCloudinary
  };
}
