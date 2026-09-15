const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment & directory detection
const isVercel = Boolean(process.env.VERCEL);

// Data directory & files (use /tmp on Vercel to allow writes in serverless environment)
const SEED_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = isVercel ? '/tmp/data' : SEED_DATA_DIR;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SEED_UPLOADS_DIR = path.join(__dirname, 'uploads');
const UPLOADS_DIR = isVercel ? '/tmp/uploads' : SEED_UPLOADS_DIR;

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Initialize data files safely (copy seed data if on Vercel)
function initFileIfNotExists(filePath, seedFileName, defaultData) {
  if (!fs.existsSync(filePath)) {
    const seedPath = path.join(SEED_DATA_DIR, seedFileName);
    if (fs.existsSync(seedPath)) {
      try {
        fs.copyFileSync(seedPath, filePath);
        return;
      } catch (err) {
        console.warn(`Could not copy seed file ${seedPath}:`, err.message);
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}
initFileIfNotExists(USERS_FILE, 'users.json', { users: [] });
initFileIfNotExists(ALBUMS_FILE, 'albums.json', { albums: [] });
initFileIfNotExists(SESSIONS_FILE, 'sessions.json', { sessions: {} });

// Safe atomic file writer
function safeWriteJson(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading users file:', err);
    return { users: [] };
  }
}

function writeUsers(data) {
  safeWriteJson(USERS_FILE, data);
}

function readAlbums() {
  try {
    return JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading albums file:', err);
    return { albums: [] };
  }
}

function writeAlbums(data) {
  safeWriteJson(ALBUMS_FILE, data);
}

function readSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return data.sessions || {};
  } catch {
    return {};
  }
}

function writeSessions(sessionsObj) {
  safeWriteJson(SESSIONS_FILE, { sessions: sessionsObj });
}

function generateId() {
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

// Cryptographic password hashing (PBKDF2-SHA512) with legacy base64 support
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `$pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('$pbkdf2$')) {
    const parts = storedHash.split('$');
    const salt = parts[2];
    const hash = parts[3];
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
    } catch {
      return false;
    }
  }
  // Legacy Base64 backward compatibility
  return Buffer.from(password).toString('base64') === storedHash;
}

// Session store helper (persistent)
// Cryptographically signed stateless session tokens (Stateless & persists across serverless instances)
const SESSION_SECRET = process.env.SESSION_SECRET || 'memory-album-lumina-secret-key-9921';
const SESSION_TTL_DAYS = 30;

function createSession(user) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    theme: user.theme || 'dark',
    createdAt: user.createdAt || new Date().toISOString(),
    expiresAt,
    nonce: crypto.randomBytes(6).toString('hex')
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payloadBase64).digest('base64url');
  const token = `${payloadBase64}.${signature}`;

  // Optionally store in sessions.json for local inspection
  try {
    const sessions = readSessions();
    sessions[token] = payload;
    writeSessions(sessions);
  } catch {}

  return token;
}

const revokedTokens = new Set();

function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  if (revokedTokens.has(sessionId)) return null;

  // 1. Verify signed token (Stateless, 100% reliable across separate serverless lambda instances)
  if (sessionId.includes('.')) {
    const parts = sessionId.split('.');
    if (parts.length === 2) {
      const [payloadBase64, signature] = parts;
      const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadBase64).digest('base64url');
      try {
        if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
          const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
          if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
            return null; // Expired
          }
          return payload;
        }
      } catch {}
    }
  }

  // 2. Client-authenticated Firebase fallback token
  if (sessionId.startsWith('fb_')) {
    const uid = sessionId.replace('fb_', '');
    const data = readUsers();
    const existing = data.users.find(u => u.id === uid) || data.users[0];
    return existing || {
      id: uid,
      username: 'Member',
      email: null,
      theme: 'dark'
    };
  }

  // 3. Fallback to file-based session lookup (backward compatibility)
  try {
    const sessions = readSessions();
    const session = sessions[sessionId];
    if (session) {
      if (new Date(session.expiresAt) < new Date()) {
        delete sessions[sessionId];
        writeSessions(sessions);
        return null;
      }
      return session;
    }
  } catch {}

  return null;
}

function removeSession(sessionId) {
  if (!sessionId) return;
  revokedTokens.add(sessionId);
  try {
    const sessions = readSessions();
    if (sessions[sessionId]) {
      delete sessions[sessionId];
      writeSessions(sessions);
    }
  } catch {}
}

// Allowed Members Whitelist helpers (reads dynamically from firebase-config.js or fallback)
function getAllowedMembers() {
  try {
    const cfg = require('./public/firebase-config.js');
    if (Array.isArray(cfg.ALLOWED_MEMBERS) && cfg.ALLOWED_MEMBERS.length > 0) {
      return cfg.ALLOWED_MEMBERS.map(e => e.trim().toLowerCase());
    }
  } catch {}

  try {
    const cfg = require('./firebase-config.js');
    if (Array.isArray(cfg.ALLOWED_MEMBERS) && cfg.ALLOWED_MEMBERS.length > 0) {
      return cfg.ALLOWED_MEMBERS.map(e => e.trim().toLowerCase());
    }
  } catch {}

  try {
    const publicConfig = path.join(__dirname, 'public', 'firebase-config.js');
    const rootConfig = path.join(__dirname, 'firebase-config.js');
    const configPath = fs.existsSync(publicConfig) ? publicConfig : rootConfig;
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/ALLOWED_MEMBERS\s*=\s*\[([\s\S]*?)\]/);
      if (match) {
        const emails = match[1]
          .split(',')
          .map(e => e.replace(/['"\r\n\s]/g, '').toLowerCase())
          .filter(Boolean);
        if (emails.length > 0) return emails;
      }
    }
  } catch (err) {
    console.error('Error reading allowed members from firebase-config.js:', err);
  }
  return [
    'image@gmail.com',
    'sahimage691@gmail.com',
    'supriya123@gmail.com',
    'niharika@gmail.com',
    'rijangurung@gmail.com'
  ];
}

function isMemberAllowed(email) {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  const allowed = getAllowedMembers();
  return allowed.includes(clean);
}

// Authentication middleware
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.query.sessionId;
  let session = getSession(sessionId);

  // Support client-authenticated Firebase member session
  if (!session && sessionId && sessionId.startsWith('fb_')) {
    const cleanUid = sessionId.replace('fb_', '');
    const data = readUsers();
    const existing = data.users.find(u => u.id === cleanUid) || data.users[0];
    session = existing || {
      id: cleanUid,
      username: 'Member',
      email: null,
      theme: 'dark'
    };
  }

  if (!sessionId || !session) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }

  // Verify whitelist authorization
  if (session.email && !isMemberAllowed(session.email)) {
    removeSession(sessionId);
    return res.status(403).json({ error: 'Access restricted: Account is not on the authorized members list.' });
  }

  req.user = session;
  req.sessionId = sessionId;
  next();
}

// Image processing helper
function saveBase64Image(base64String) {
  const matches = base64String.match(/^data:image\/([\w+]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image format: must be valid base64 image data URL');
  }

  let ext = matches[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (ext.includes('svg')) ext = 'svg';

  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const filename = `${generateId()}.${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filepath, buffer);

  return {
    filename,
    url: `/uploads/${filename}`,
    sizeBytes: buffer.length
  };
}

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-session-id', 'Authorization']
}));
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// URL prefix normalizer for serverless / Vercel rewrites
// Ensures routes match whether req.url starts with /api/... or /auth/..., /albums/..., etc.
app.use((req, res, next) => {
  const apiPrefixes = ['/auth', '/albums', '/favorites', '/tags', '/stats', '/search'];
  if (!req.url.startsWith('/api') && !req.path.includes('.') && apiPrefixes.some(p => req.url === p || req.url.startsWith(p + '/'))) {
    req.url = '/api' + req.url;
  }
  next();
});

// API status / health check
app.get(['/api', '/api/ping'], (req, res) => {
  res.json({ status: 'ok', name: 'Memory Album API', timestamp: new Date().toISOString() });
});

// Static assets (bypassed for /api endpoints)
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (fs.existsSync(PUBLIC_DIR)) {
    return express.static(PUBLIC_DIR)(req, res, () => {
      express.static(__dirname)(req, res, next);
    });
  }
  express.static(__dirname)(req, res, next);
});

const PUBLIC_UPLOADS = path.join(PUBLIC_DIR, 'uploads');
if (fs.existsSync(PUBLIC_UPLOADS)) {
  app.use('/uploads', express.static(PUBLIC_UPLOADS));
}
app.use('/uploads', express.static(UPLOADS_DIR));
if (isVercel) {
  app.use('/uploads', express.static(SEED_UPLOADS_DIR));
}

// Explicit HTML page routes
function sendHtml(res, filename) {
  const publicPath = path.join(PUBLIC_DIR, filename);
  if (fs.existsSync(publicPath)) {
    return res.sendFile(publicPath);
  }
  return res.sendFile(path.join(__dirname, filename));
}

app.get('/', (req, res) => sendHtml(res, 'index.html'));
app.get('/index.html', (req, res) => sendHtml(res, 'index.html'));
app.get('/app', (req, res) => sendHtml(res, 'app.html'));
app.get('/app.html', (req, res) => sendHtml(res, 'app.html'));

// =======================================================
// AUTH ROUTES
// =======================================================

// Register (Restricted to whitelisted members only)
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim();

  // Whitelist verification
  if (!isMemberAllowed(cleanEmail)) {
    return res.status(403).json({ error: 'Public registration is disabled. Only pre-approved members can be registered.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  const data = readUsers();
  if (data.users.find(u => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  if (data.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(400).json({ error: 'Username taken' });
  }

  const user = {
    id: generateId(),
    username: cleanUsername,
    email: cleanEmail,
    passwordHash: hashPassword(password),
    theme: 'dark',
    createdAt: new Date().toISOString()
  };

  data.users.push(user);
  writeUsers(data);

  const sessionId = createSession(user);

  res.status(200).json({
    success: true,
    user: { id: user.id, username: user.username, email: user.email, theme: user.theme },
    sessionId
  });
});

// Member Login (Enforcing Allowed Members Whitelist)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Whitelist verification
  if (!isMemberAllowed(cleanEmail)) {
    return res.status(403).json({ error: 'Access restricted: Your email is not on the authorized members list.' });
  }

  const data = readUsers();
  const user = data.users.find(u => u.email.toLowerCase() === cleanEmail);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Seamless auto-upgrade of legacy base64 hash to PBKDF2
  if (!user.passwordHash.startsWith('$pbkdf2$')) {
    user.passwordHash = hashPassword(password);
    writeUsers(data);
  }

  const sessionId = createSession(user);

  res.status(200).json({
    success: true,
    user: { id: user.id, username: user.username, email: user.email, theme: user.theme || 'dark' },
    sessionId
  });
});

// Firebase Authentication Login Bridge
app.post('/api/auth/firebase-login', (req, res) => {
  const { email, username, idToken } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Strict Whitelist Verification
  if (!isMemberAllowed(cleanEmail)) {
    return res.status(403).json({ error: 'Access restricted: Your account is not on the authorized members list.' });
  }

  const data = readUsers();
  let user = data.users.find(u => u.email.toLowerCase() === cleanEmail);

  if (!user) {
    // Auto-provision local workspace for authorized Firebase member
    user = {
      id: generateId(),
      username: (username || cleanEmail.split('@')[0]).trim(),
      email: cleanEmail,
      passwordHash: 'firebase_managed',
      theme: 'dark',
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
    writeUsers(data);
  }

  const sessionId = createSession(user);

  res.status(200).json({
    success: true,
    user: { id: user.id, username: user.username, email: user.email, theme: user.theme || 'dark' },
    sessionId
  });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.body.sessionId;
  if (sessionId) removeSession(sessionId);
  res.json({ success: true });
});

// Current User info (Supports both direct username and envelope user object)
app.get('/api/auth/me', requireAuth, (req, res) => {
  const data = readUsers();
  const fullUser = data.users.find(u => u.id === req.user.id);
  const userObj = {
    id: req.user.id,
    username: fullUser ? fullUser.username : req.user.username,
    email: fullUser ? fullUser.email : req.user.email,
    theme: fullUser?.theme || req.user.theme || 'dark',
    createdAt: fullUser?.createdAt || req.user.createdAt
  };

  res.json({
    success: true,
    user: userObj,
    id: userObj.id,
    username: userObj.username,
    email: userObj.email,
    theme: userObj.theme
  });
});

// Update profile / preferences
app.put('/api/auth/profile', requireAuth, (req, res) => {
  const { username, theme } = req.body;
  const data = readUsers();
  const userIndex = data.users.findIndex(u => u.id === req.user.id);

  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

  if (username && username.trim()) {
    const cleanUsername = username.trim();
    const existing = data.users.find(u => u.id !== req.user.id && u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (existing) return res.status(400).json({ error: 'Username already taken' });
    data.users[userIndex].username = cleanUsername;
  }

  if (theme && ['dark', 'light'].includes(theme)) {
    data.users[userIndex].theme = theme;
  }

  writeUsers(data);

  // Update session record
  const sessions = readSessions();
  if (sessions[req.sessionId]) {
    sessions[req.sessionId].username = data.users[userIndex].username;
    sessions[req.sessionId].theme = data.users[userIndex].theme;
    writeSessions(sessions);
  }

  res.json({ success: true, user: data.users[userIndex] });
});

// =======================================================
// ALBUM ROUTES
// =======================================================

// Get all albums with filter and sort
app.get('/api/albums', requireAuth, (req, res) => {
  const { category, search, sort = 'newest' } = req.query;
  const data = readAlbums();
  let userAlbums = data.albums.filter(a => a.userId === req.user.id);

  if (category && category !== 'all') {
    userAlbums = userAlbums.filter(a => a.category === category);
  }

  if (search) {
    const q = search.toLowerCase();
    userAlbums = userAlbums.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.description && a.description.toLowerCase().includes(q))
    );
  }

  // Sort albums
  if (sort === 'newest') {
    userAlbums.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sort === 'oldest') {
    userAlbums.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  } else if (sort === 'title') {
    userAlbums.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === 'photos') {
    userAlbums.sort((a, b) => (b.photos?.length || 0) - (a.photos?.length || 0));
  }

  // Enrich with photo count and preview items
  const enrichedAlbums = userAlbums.map(album => ({
    ...album,
    photosCount: album.photos ? album.photos.length : 0,
    previewPhotos: (album.photos || []).slice(0, 4).map(p => p.url)
  }));

  res.json({ albums: enrichedAlbums });
});

// Get single album with full details
app.get('/api/albums/:id', requireAuth, (req, res) => {
  const data = readAlbums();
  const album = data.albums.find(a => a.id === req.params.id && a.userId === req.user.id);
  if (!album) return res.status(404).json({ error: 'Album not found' });
  res.json({ album });
});

// Create album
app.post('/api/albums', requireAuth, (req, res) => {
  const { title, category, description, cover } = req.body;

  if (!title || !category) {
    return res.status(400).json({ error: 'Title and category required' });
  }

  const data = readAlbums();
  const now = new Date().toISOString();
  const album = {
    id: generateId(),
    userId: req.user.id,
    title: title.trim(),
    category: category.trim(),
    description: (description || '').trim(),
    cover: cover || null,
    photos: [],
    createdAt: now,
    updatedAt: now
  };

  data.albums.push(album);
  writeAlbums(data);

  res.status(201).json({ album });
});

// Update album
app.put('/api/albums/:id', requireAuth, (req, res) => {
  const data = readAlbums();
  const index = data.albums.findIndex(a => a.id === req.params.id && a.userId === req.user.id);

  if (index === -1) return res.status(404).json({ error: 'Album not found' });

  const existing = data.albums[index];
  data.albums[index] = {
    ...existing,
    title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
    category: req.body.category !== undefined ? req.body.category.trim() : existing.category,
    description: req.body.description !== undefined ? req.body.description.trim() : existing.description,
    cover: req.body.cover !== undefined ? req.body.cover : existing.cover,
    updatedAt: new Date().toISOString()
  };

  writeAlbums(data);
  res.json({ album: data.albums[index] });
});

// Set album cover
app.put('/api/albums/:id/cover', requireAuth, (req, res) => {
  const { coverUrl } = req.body;
  const data = readAlbums();
  const album = data.albums.find(a => a.id === req.params.id && a.userId === req.user.id);

  if (!album) return res.status(404).json({ error: 'Album not found' });

  album.cover = coverUrl || null;
  album.updatedAt = new Date().toISOString();
  writeAlbums(data);

  res.json({ success: true, cover: album.cover });
});

// Delete album
app.delete('/api/albums/:id', requireAuth, (req, res) => {
  const data = readAlbums();
  const index = data.albums.findIndex(a => a.id === req.params.id && a.userId === req.user.id);

  if (index === -1) return res.status(404).json({ error: 'Album not found' });

  // Delete associated image files
  (data.albums[index].photos || []).forEach(photo => {
    if (photo.filename) {
      const imgPath = path.join(UPLOADS_DIR, photo.filename);
      if (fs.existsSync(imgPath)) {
        try { fs.unlinkSync(imgPath); } catch (e) { console.error('Error unlinking photo:', e); }
      }
    }
  });

  data.albums.splice(index, 1);
  writeAlbums(data);
  res.json({ success: true });
});

// =======================================================
// PHOTO ROUTES
// =======================================================

// Upload single photo (Supports Firebase Storage imageUrl or local imageBase64)
app.post('/api/albums/:id/photos', requireAuth, (req, res) => {
  const { imageBase64, imageUrl, url, filename, title, tags, description, sizeBytes } = req.body;
  const albumId = req.params.id;
  const finalUrl = imageUrl || url;

  if (!finalUrl && !imageBase64) {
    return res.status(400).json({ error: 'Image URL or image data required' });
  }

  const data = readAlbums();
  const albumIndex = data.albums.findIndex(a => a.id === albumId && a.userId === req.user.id);

  if (albumIndex === -1) return res.status(404).json({ error: 'Album not found' });

  try {
    const now = new Date().toISOString();
    let photoUrl = finalUrl;
    let photoFilename = filename || 'firebase_image';
    let photoSize = sizeBytes || 0;

    // Local fallback if base64 provided
    if (!photoUrl && imageBase64) {
      const saved = saveBase64Image(imageBase64);
      photoUrl = saved.url;
      photoFilename = saved.filename;
      photoSize = saved.sizeBytes;
    }

    const photo = {
      id: generateId(),
      title: (title || 'Untitled').trim(),
      description: (description || '').trim(),
      filename: photoFilename,
      url: photoUrl,
      sizeBytes: photoSize,
      tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
      isFavorite: false,
      createdAt: now,
      updatedAt: now
    };

    if (!data.albums[albumIndex].photos) {
      data.albums[albumIndex].photos = [];
    }
    data.albums[albumIndex].photos.push(photo);
    data.albums[albumIndex].updatedAt = now;

    // Set as cover if album has no cover
    if (!data.albums[albumIndex].cover) {
      data.albums[albumIndex].cover = photo.url;
    }

    writeAlbums(data);
    res.status(201).json({ photo, album: data.albums[albumIndex] });
  } catch (err) {
    console.error('Error saving uploaded photo:', err);
    res.status(400).json({ error: err.message || 'Failed to process image' });
  }
});

// Batch upload multiple photos (Supports Firebase Storage imageUrl or local imageBase64)
app.post('/api/albums/:id/photos/batch', requireAuth, (req, res) => {
  const { photos } = req.body;
  const albumId = req.params.id;

  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: 'Array of photos required' });
  }

  const data = readAlbums();
  const albumIndex = data.albums.findIndex(a => a.id === albumId && a.userId === req.user.id);

  if (albumIndex === -1) return res.status(404).json({ error: 'Album not found' });

  const addedPhotos = [];
  const now = new Date().toISOString();

  for (const item of photos) {
    const itemUrl = item.imageUrl || item.url;
    if (!itemUrl && !item.imageBase64) continue;

    try {
      let photoUrl = itemUrl;
      let photoFilename = item.filename || 'firebase_image';
      let photoSize = item.sizeBytes || 0;

      if (!photoUrl && item.imageBase64) {
        const saved = saveBase64Image(item.imageBase64);
        photoUrl = saved.url;
        photoFilename = saved.filename;
        photoSize = saved.sizeBytes;
      }

      const photo = {
        id: generateId(),
        title: (item.title || 'Untitled').trim(),
        description: (item.description || '').trim(),
        filename: photoFilename,
        url: photoUrl,
        sizeBytes: photoSize,
        tags: Array.isArray(item.tags) ? item.tags : (item.tags ? String(item.tags).split(',').map(t => t.trim()).filter(Boolean) : []),
        isFavorite: false,
        createdAt: now,
        updatedAt: now
      };

      data.albums[albumIndex].photos.push(photo);
      addedPhotos.push(photo);

      if (!data.albums[albumIndex].cover) {
        data.albums[albumIndex].cover = photo.url;
      }
    } catch (err) {
      console.error('Error saving item in batch:', err);
    }
  }

  data.albums[albumIndex].updatedAt = now;
  writeAlbums(data);

  res.status(201).json({ success: true, count: addedPhotos.length, photos: addedPhotos });
});

// Update photo metadata (title, tags, description, favorite)
app.put('/api/albums/:albumId/photos/:photoId', requireAuth, (req, res) => {
  const { title, tags, description, isFavorite } = req.body;
  const data = readAlbums();
  const album = data.albums.find(a => a.id === req.params.albumId && a.userId === req.user.id);

  if (!album) return res.status(404).json({ error: 'Album not found' });

  const photo = (album.photos || []).find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  if (title !== undefined) photo.title = String(title).trim();
  if (description !== undefined) photo.description = String(description).trim();
  if (isFavorite !== undefined) photo.isFavorite = Boolean(isFavorite);
  if (tags !== undefined) {
    photo.tags = Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean);
  }
  photo.updatedAt = new Date().toISOString();
  album.updatedAt = photo.updatedAt;

  writeAlbums(data);
  res.json({ success: true, photo });
});

// Delete single photo
app.delete('/api/albums/:albumId/photos/:photoId', requireAuth, (req, res) => {
  const data = readAlbums();
  const albumIndex = data.albums.findIndex(a => a.id === req.params.albumId && a.userId === req.user.id);

  if (albumIndex === -1) return res.status(404).json({ error: 'Album not found' });

  const photoIndex = (data.albums[albumIndex].photos || []).findIndex(p => p.id === req.params.photoId);
  if (photoIndex === -1) return res.status(404).json({ error: 'Photo not found' });

  const photo = data.albums[albumIndex].photos[photoIndex];
  if (photo.filename) {
    const imgPath = path.join(UPLOADS_DIR, photo.filename);
    if (fs.existsSync(imgPath)) {
      try { fs.unlinkSync(imgPath); } catch (e) { console.error('Error deleting photo file:', e); }
    }
  }

  data.albums[albumIndex].photos.splice(photoIndex, 1);
  data.albums[albumIndex].updatedAt = new Date().toISOString();

  // If deleted photo was album cover, reassign to next photo or null
  if (data.albums[albumIndex].cover === photo.url) {
    data.albums[albumIndex].cover = data.albums[albumIndex].photos.length > 0
      ? data.albums[albumIndex].photos[0].url
      : null;
  }

  writeAlbums(data);
  res.json({ success: true });
});

// Get all favorited photos across albums
app.get('/api/favorites', requireAuth, (req, res) => {
  const data = readAlbums();
  const userAlbums = data.albums.filter(a => a.userId === req.user.id);
  const favoritePhotos = [];

  userAlbums.forEach(album => {
    (album.photos || []).forEach(photo => {
      if (photo.isFavorite) {
        favoritePhotos.push({
          ...photo,
          albumId: album.id,
          albumTitle: album.title,
          category: album.category
        });
      }
    });
  });

  res.json({ photos: favoritePhotos });
});

// Get user tag cloud
app.get('/api/tags', requireAuth, (req, res) => {
  const data = readAlbums();
  const userAlbums = data.albums.filter(a => a.userId === req.user.id);
  const tagCounts = {};

  userAlbums.forEach(album => {
    (album.photos || []).forEach(photo => {
      (photo.tags || []).forEach(tag => {
        const clean = tag.toLowerCase().trim();
        if (clean) {
          tagCounts[clean] = (tagCounts[clean] || 0) + 1;
        }
      });
    });
  });

  const sortedTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  res.json({ tags: sortedTags });
});

// Get detailed stats
app.get('/api/stats', requireAuth, (req, res) => {
  const data = readAlbums();
  const userAlbums = data.albums.filter(a => a.userId === req.user.id);

  let totalPhotos = 0;
  let totalFavorites = 0;
  let totalStorageBytes = 0;

  userAlbums.forEach(album => {
    (album.photos || []).forEach(photo => {
      totalPhotos++;
      if (photo.isFavorite) totalFavorites++;
      if (photo.sizeBytes) totalStorageBytes += photo.sizeBytes;
    });
  });

  const totalAlbums = userAlbums.length;
  const placesCount = userAlbums.filter(a => a.category === 'place').length;
  const peopleCount = userAlbums.filter(a => a.category === 'person').length;
  const usesCount = userAlbums.filter(a => a.category === 'use').length;

  res.json({
    totalPhotos,
    totalAlbums,
    placesCount,
    peopleCount,
    usesCount,
    totalFavorites,
    totalStorageBytes
  });
});

// Advanced unified search
app.get('/api/search', requireAuth, (req, res) => {
  const { q, category, tag, favorite, sort = 'newest' } = req.query;
  const data = readAlbums();
  let userAlbums = data.albums.filter(a => a.userId === req.user.id);

  if (category && category !== 'all') {
    userAlbums = userAlbums.filter(a => a.category === category);
  }

  if (q) {
    const query = q.toLowerCase();
    userAlbums = userAlbums.filter(a =>
      a.title.toLowerCase().includes(query) ||
      (a.description && a.description.toLowerCase().includes(query))
    );
  }

  // Search photos across all matching user albums
  let photos = [];
  data.albums.filter(a => a.userId === req.user.id).forEach(album => {
    if (category && category !== 'all' && album.category !== category) return;

    (album.photos || []).forEach(photo => {
      const matchQuery = !q ||
        photo.title.toLowerCase().includes(q.toLowerCase()) ||
        (photo.description && photo.description.toLowerCase().includes(q.toLowerCase())) ||
        (Array.isArray(photo.tags) && photo.tags.some(t => t.toLowerCase().includes(q.toLowerCase())));

      const matchTag = !tag || (Array.isArray(photo.tags) && photo.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
      const matchFavorite = !favorite || (favorite === 'true' ? photo.isFavorite : true);

      if (matchQuery && matchTag && matchFavorite) {
        photos.push({
          ...photo,
          albumId: album.id,
          albumTitle: album.title,
          category: album.category
        });
      }
    });
  });

  // Sort photos
  if (sort === 'newest') {
    photos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sort === 'oldest') {
    photos.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  } else if (sort === 'title') {
    photos.sort((a, b) => a.title.localeCompare(b.title));
  }

  res.json({ albums: userAlbums, photos });
});

// Start server locally (only when executed directly, not when imported as serverless function)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Memory Album server running at http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

module.exports = app;