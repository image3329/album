// ==========================================================================
// Memory Album — Authentication Client (Firebase + Member Whitelist)
// ==========================================================================

const SESSION_KEY = 'memoryAlbumSession';
const THEME_KEY = 'memoryAlbumTheme';

// Determine API base URL dynamically
const API_BASE = (() => {
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return '';
  }
  return 'http://localhost:3000';
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
    if (response.status === 401) {
      clearSession();
      const isLoginPath = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || !window.location.pathname.includes('app.html');
      if (!isLoginPath) {
        window.location.href = 'index.html';
      }
    }
    return response;
  } catch (err) {
    if (err.name === 'TypeError' || (err.message && err.message.toLowerCase().includes('fetch'))) {
      throw new Error('Cannot connect to the server. Please make sure the backend is running at http://localhost:3000.');
    }
    throw err;
  }
}

async function getMe() {
  const sessionId = getSessionId();
  if (!sessionId) return null;
  try {
    const response = await apiFetch('/api/auth/me');
    if (!response.ok) return null;
    const data = await response.json();
    const user = data.user || data;

    // Verify member whitelist
    if (window.FirebaseConfig && user && user.email) {
      if (!window.FirebaseConfig.isMemberAllowed(user.email)) {
        await logoutUser();
        return null;
      }
    }

    return user;
  } catch {
    return null;
  }
}

/**
 * Sign in user using Firebase Authentication with Whitelist Verification
 */
async function loginUser({ email, password }) {
  const cleanEmail = (email || '').trim().toLowerCase();

  // 1. Strict Whitelist Check
  if (window.FirebaseConfig) {
    if (!window.FirebaseConfig.isMemberAllowed(cleanEmail)) {
      throw new Error('Access Restricted: Your email is not on the authorized members list. Please contact the album administrator.');
    }
  }

  // 2. Check if Firebase live credentials are provided
  if (window.FirebaseConfig && window.FirebaseConfig.isConfigured && typeof firebase !== 'undefined') {
    try {
      const auth = firebase.auth();
      const userCredential = await auth.signInWithEmailAndPassword(cleanEmail, password);
      const firebaseUser = userCredential.user;
      const idToken = await firebaseUser.getIdToken();

      // Sync session with backend
      const res = await apiFetch('/api/auth/firebase-login', {
        method: 'POST',
        body: JSON.stringify({
          idToken,
          email: firebaseUser.email,
          username: firebaseUser.displayName || firebaseUser.email.split('@')[0]
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Server authorization failed');
      }

      setSession(data.sessionId);
      return data.user;
    } catch (fbErr) {
      console.error('Firebase Auth Error:', fbErr);
      if (fbErr.code === 'auth/user-not-found' || fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential') {
        throw new Error('Invalid email or password. Please verify your member credentials.');
      } else if (fbErr.code === 'auth/too-many-requests') {
        throw new Error('Too many failed attempts. Please wait a few moments and try again.');
      }
      throw fbErr;
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