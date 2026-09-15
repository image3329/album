// ==========================================================================
// Memory Album — Authentication Client (Firebase + Member Whitelist)
// ==========================================================================

const SESSION_KEY = 'memoryAlbumSession';
const THEME_KEY = 'memoryAlbumTheme';

// Determine API base URL dynamically:
// - If running on Live Server (:5500, etc.) on localhost, point to Express on http://localhost:3000
// - If served on :3000 or on Vercel production, use relative paths ('')
const API_BASE = (() => {
  if (
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    window.location.port !== '3000' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return 'http://localhost:3000';
  }
  return '';
})();

function getSessionId() {
  return localStorage.getItem(SESSION_KEY);
}

function setSession(sessionId) {
  localStorage.setItem(SESSION_KEY, sessionId);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

// Apply stored theme on initial evaluation
document.documentElement.setAttribute('data-theme', getStoredTheme());

function resolveMediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return API_BASE ? `${API_BASE}${url}` : url;
}

async function apiFetch(path, options = {}) {
  const sessionId = getSessionId();
  const headers = {
    ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
    ...(options.headers || {})
  };

  const targetUrl = (path.startsWith('http://') || path.startsWith('https://'))
    ? path
    : `${API_BASE}${path}`;

  try {
    const response = await fetch(targetUrl, { ...options, headers });
    return response;
  } catch (err) {
    if (err.name === 'TypeError' || (err.message && err.message.toLowerCase().includes('fetch'))) {
      throw new Error('Cannot connect to the server. Please check your network connection.');
    }
    throw err;
  }
}

async function getMe() {
  const sessionId = getSessionId();
  if (!sessionId) return null;

  // 1. Try server verification
  try {
    const response = await apiFetch('/api/auth/me');
    if (response.ok) {
      const data = await response.json();
      const user = data.user || data;

      // Verify member whitelist
      if (window.FirebaseConfig && user && user.email) {
        if (!window.FirebaseConfig.isMemberAllowed(user.email)) {
          await logoutUser();
          return null;
        }
      }
      localStorage.setItem('memoryAlbumUser', JSON.stringify(user));
      return user;
    }
  } catch {
    // Backend offline or starting up
  }

  // 2. Client cached user fallback
  try {
    const cached = localStorage.getItem('memoryAlbumUser');
    if (cached) {
      const u = JSON.parse(cached);
      if (window.FirebaseConfig && u && u.email) {
        if (!window.FirebaseConfig.isMemberAllowed(u.email)) {
          await logoutUser();
          return null;
        }
      }
      return u;
    }
  } catch {}

  // 3. Firebase client currentUser fallback
  if (typeof firebase !== 'undefined' && firebase.auth) {
    try {
      const fbUser = firebase.auth().currentUser;
      if (fbUser && fbUser.email) {
        if (window.FirebaseConfig && !window.FirebaseConfig.isMemberAllowed(fbUser.email)) {
          await logoutUser();
          return null;
        }
        const userObj = {
          id: fbUser.uid,
          username: fbUser.displayName || fbUser.email.split('@')[0],
          email: fbUser.email,
          theme: getStoredTheme()
        };
        localStorage.setItem('memoryAlbumUser', JSON.stringify(userObj));
        return userObj;
      }
    } catch {}
  }

  return null;
}

/**
 * Sign in user using Firebase Authentication with Whitelist Verification & Server Fallback
 */
async function loginUser({ email, password }) {
  const cleanEmail = (email || '').trim().toLowerCase();

  // 1. Strict Whitelist Check
  if (window.FirebaseConfig) {
    if (!window.FirebaseConfig.isMemberAllowed(cleanEmail)) {
      throw new Error('Access Restricted: Your email is not on the authorized members list. Please contact the album administrator.');
    }
  }

  // 2. Try Firebase Auth if configured
  if (window.FirebaseConfig && window.FirebaseConfig.isConfigured && typeof firebase !== 'undefined') {
    try {
      const auth = firebase.auth();
      const userCredential = await auth.signInWithEmailAndPassword(cleanEmail, password);
      const firebaseUser = userCredential.user;
      const idToken = await firebaseUser.getIdToken();

      // Sync session with backend
      let backendUser = null;
      try {
        const res = await apiFetch('/api/auth/firebase-login', {
          method: 'POST',
          body: JSON.stringify({
            idToken,
            email: firebaseUser.email,
            username: firebaseUser.displayName || firebaseUser.email.split('@')[0]
          })
        });

        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          console.warn('Backend returned non-JSON response:', res.status);
        }

        if (res.ok && data && data.sessionId) {
          setSession(data.sessionId);
          backendUser = data.user;
          localStorage.setItem('memoryAlbumUser', JSON.stringify(backendUser));
        } else if (data && data.error) {
          throw new Error(data.error);
        }
      } catch (syncErr) {
        if (syncErr.message && syncErr.message.includes('Access restricted')) {
          throw syncErr;
        }
        console.warn('Backend sync note (continuing with Firebase verified session):', syncErr.message);
      }

      if (backendUser) {
        return backendUser;
      }

      // Verified Firebase user session
      const clientUser = {
        id: firebaseUser.uid,
        username: firebaseUser.displayName || cleanEmail.split('@')[0],
        email: cleanEmail,
        theme: getStoredTheme()
      };
      setSession('fb_' + firebaseUser.uid);
      localStorage.setItem('memoryAlbumUser', JSON.stringify(clientUser));
      return clientUser;
    } catch (fbErr) {
      console.warn('Firebase Auth note, attempting local server login:', fbErr.message || fbErr.code);

      // Attempt local server verification fallback for whitelisted user
      try {
        const fallbackRes = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: cleanEmail, password })
        });
        const fallbackData = await fallbackRes.json();
        if (fallbackRes.ok && fallbackData.sessionId) {
          setSession(fallbackData.sessionId);
          localStorage.setItem('memoryAlbumUser', JSON.stringify(fallbackData.user));
          return fallbackData.user;
        }
      } catch {
        // Fall through to standard error reporting
      }

      if (
        fbErr.code === 'auth/user-not-found' ||
        fbErr.code === 'auth/wrong-password' ||
        fbErr.code === 'auth/invalid-credential' ||
        fbErr.code === 'auth/invalid-login-credentials'
      ) {
        throw new Error('Invalid email or password. Please verify your member credentials.');
      } else if (fbErr.code === 'auth/too-many-requests') {
        throw new Error('Too many failed attempts. Please wait a few moments and try again.');
      }
      throw new Error(fbErr.message || 'Login failed. Please verify your credentials.');
    }
  }

  // 3. Fallback Mode (For local development/testing before live Firebase credentials are set)
  const response = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: cleanEmail, password })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Login failed. Please check your credentials.');
  setSession(data.sessionId);
  return data.user;
}

/**
 * Sign out from both Firebase and Express session
 */
async function logoutUser() {
  if (typeof firebase !== 'undefined' && window.FirebaseConfig?.isConfigured) {
    try {
      await firebase.auth().signOut();
    } catch (e) {
      console.warn('Firebase sign out error:', e);
    }
  }

  const sessionId = getSessionId();
  if (sessionId) {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({ sessionId }) });
    } catch {
      // Ignore network errors on logout
    }
  }
  clearSession();
}

window.MemoryAlbumAuth = {
  API_BASE,
  resolveMediaUrl,
  getSessionId,
  setSession,
  clearSession,
  getStoredTheme,
  setStoredTheme,
  apiFetch,
  getMe,
  loginUser,
  logoutUser
};