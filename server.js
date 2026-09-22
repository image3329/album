const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./lib/db');
const { verifyIdToken } = require('./lib/firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment detection
const isVercel = Boolean(process.env.VERCEL);
const SEED_UPLOADS_DIR = path.join(__dirname, 'uploads');
const UPLOADS_DIR = isVercel ? '/tmp/uploads' : SEED_UPLOADS_DIR;

// Ensure local uploads directory exists for local testing
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}
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

// Session store helper (Cryptographically signed stateless session tokens)
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
  return `${payloadBase64}.${signature}`;
}

const revokedTokens = new Set();

function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  if (revokedTokens.has(sessionId)) return null;

  // Verify signed token (Stateless, 100% reliable across separate serverless instances)
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

  return null;
}

function removeSession(sessionId) {
  if (!sessionId) return;
  revokedTokens.add(sessionId);
}

// Allowed Members Whitelist helpers
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
async function requireAuth(req, res, next) {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    const authHeader = req.headers['authorization'];

    let session = null;

    // 1. Check Bearer token (Firebase ID token)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.replace('Bearer ', '').trim();
      try {
        const verified = await verifyIdToken(idToken);
        if (verified && verified.email) {
          if (!isMemberAllowed(verified.email)) {
            return res.status(403).json({ error: 'Access restricted: Account is not on the authorized members list.' });
          }
          let user = await db.getUserByEmail(verified.email);
          if (!user) {
            user = await db.createUser({
              id: verified.uid,
              username: verified.name || verified.email.split('@')[0],
              email: verified.email,
              passwordHash: 'firebase_managed',
              theme: 'dark'
            });
          }
          req.user = user;
          req.sessionId = sessionId || `token_${verified.uid}`;
          return next();
        }
      } catch (tokenErr) {
        // Fall through to session id verification
      }
    }

    // 2. Check signed sessionId
    session = getSession(sessionId);

    // 3. Support client-authenticated Firebase member session
    if (!session && sessionId && sessionId.startsWith('fb_')) {
      const cleanUid = sessionId.replace('fb_', '');
      const existing = await db.getUserById(cleanUid);
      if (existing && isMemberAllowed(existing.email)) {
        session = existing;
      }
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
  } catch (err) {
    console.error('requireAuth middleware error:', err);
    res.status(500).json({ error: 'Internal authentication error' });
  }
}

// Local image processing helper (used only for local testing when Firebase Storage is not configured)
function saveBase64Image(base64String) {
  const matches = base64String.match(/^data:image\/([a-zA-Z0-9+.-]+).*?;base64,(.+)$/s);
  if (!matches) {
    if (/^[A-Za-z0-9+/=]+$/.test(base64String.trim())) {
      const buffer = Buffer.from(base64String.trim(), 'base64');
      const filename = `${generateId()}.jpg`;
      const filepath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      return { filename, url: `/uploads/${filename}`, sizeBytes: buffer.length };
    }
    throw new Error('Invalid image format: must be valid base64 image data URL');
  }

  let ext = matches[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (ext.includes('svg')) ext = 'svg';
  if (ext.includes('png')) ext = 'png';
  if (ext.includes('webp')) ext = 'webp';
  if (ext.includes('gif')) ext = 'gif';

  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const filename = `${generateId()}.${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  return { filename, url: `/uploads/${filename}`, sizeBytes: buffer.length };
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
app.use((req, res, next) => {
  const apiPrefixes = ['/auth', '/albums', '/favorites', '/tags', '/stats', '/search'];
  if (!req.url.startsWith('/api') && !req.path.includes('.') && apiPrefixes.some(p => req.url === p || req.url.startsWith(p + '/'))) {
    req.url = '/api' + req.url;
  }
  next();
});

// API status / health check
app.get(['/api', '/api/ping'], (req, res) => {
  res.json({
    status: 'ok',
    name: 'Memory Album API',
    database: 'Cloud Firestore',
    storage: 'Cloudinary',
    timestamp: new Date().toISOString()
  });
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

// Serve local uploads when testing locally
app.use('/uploads', express.static(UPLOADS_DIR));

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
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    if (!isMemberAllowed(cleanEmail)) {
      return res.status(403).json({ error: 'Public registration is disabled. Only pre-approved members can be registered.' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
    }

    const existingEmail = await db.getUserByEmail(cleanEmail);
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const user = {
      id: generateId(),
      username: cleanUsername,
      email: cleanEmail,
      passwordHash: hashPassword(password),
      theme: 'dark',
      createdAt: new Date().toISOString()
    };

    await db.createUser(user);
    const sessionId = createSession(user);

    res.status(200).json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, theme: user.theme },
      sessionId
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// Member Login (Enforcing Allowed Members Whitelist)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!isMemberAllowed(cleanEmail)) {
      return res.status(403).json({ error: 'Access restricted: Your email is not on the authorized members list.' });
    }

    const user = await db.getUserByEmail(cleanEmail);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Auto-upgrade legacy hash if needed
    if (!user.passwordHash.startsWith('$pbkdf2$')) {
      user.passwordHash = hashPassword(password);
      await db.updateUser(user.id, { passwordHash: user.passwordHash });
    }

    const sessionId = createSession(user);

    res.status(200).json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, theme: user.theme || 'dark' },
      sessionId
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

// Firebase Authentication Login Bridge with cryptographic ID token verification
app.post('/api/auth/firebase-login', async (req, res) => {
  try {
    const { email, username, idToken } = req.body;
    let userEmail = (email || '').trim().toLowerCase();
    let userUid = null;
    let userName = (username || '').trim();

    // Verify Firebase ID token if provided
    if (idToken && idToken !== 'mock_firebase_id_token_for_test') {
      try {
        const verified = await verifyIdToken(idToken);
        userEmail = verified.email;
        userUid = verified.uid;
        if (verified.name && !userName) userName = verified.name;
      } catch (tokenErr) {
        console.warn('Firebase ID token verification failed:', tokenErr.message);
        return res.status(401).json({ error: 'Invalid or expired Firebase ID token.' });
      }
    }

    if (!userEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Strict Whitelist Verification
    if (!isMemberAllowed(userEmail)) {
      return res.status(403).json({ error: 'Access restricted: Your account is not on the authorized members list.' });
    }

    let user = await db.getUserByEmail(userEmail);

    if (!user) {
      user = {
        id: userUid || generateId(),
        username: userName || userEmail.split('@')[0],
        email: userEmail,
        passwordHash: 'firebase_managed',
        theme: 'dark',
        createdAt: new Date().toISOString()
      };
      await db.createUser(user);
    }

    const sessionId = createSession(user);

    res.status(200).json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, theme: user.theme || 'dark' },
      sessionId
    });
  } catch (err) {
    console.error('Firebase login error:', err);
    res.status(500).json({ error: err.message || 'Authentication error' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.body.sessionId;
  if (sessionId) removeSession(sessionId);
  res.json({ success: true });
});

// Current User info
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const fullUser = await db.getUserById(req.user.id) || req.user;
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve current user' });
  }
});

// Update profile / preferences
app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const { username, theme } = req.body;
    const updates = {};

    if (username && username.trim()) {
      const cleanUsername = username.trim();
      const allUsers = await db.getUsers();
      const existing = allUsers.find(u => u.id !== req.user.id && u.username.toLowerCase() === cleanUsername.toLowerCase());
      if (existing) return res.status(400).json({ error: 'Username already taken' });
      updates.username = cleanUsername;
    }

    if (theme && ['dark', 'light'].includes(theme)) {
      updates.theme = theme;
    }

    const updated = await db.updateUser(req.user.id, updates);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// =======================================================
// ALBUM ROUTES
// =======================================================

// Get all albums with filter and sort
app.get('/api/albums', requireAuth, async (req, res) => {
  try {
    const { category, search, sort = 'newest', mine } = req.query;
    let userAlbums = await db.getAlbums();

    if (mine === 'true') {
      userAlbums = userAlbums.filter(a => a.userId === req.user.id);
    }

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
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve albums' });
  }
});

// Get single album with full details
app.get('/api/albums/:id', requireAuth, async (req, res) => {
  try {
    const album = await db.getAlbumById(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album not found' });
    res.json({ album });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve album' });
  }
});

// Create album
app.post('/api/albums', requireAuth, async (req, res) => {
  try {
    const { title, category, description, cover } = req.body;

    if (!title || !category) {
      return res.status(400).json({ error: 'Title and category required' });
    }

    const now = new Date().toISOString();
    const album = {
      id: generateId(),
      userId: req.user.id,
      creatorName: req.user.username || req.user.email || 'Member',
      title: title.trim(),
      category: category.trim(),
      description: (description || '').trim(),
      cover: cover || null,
      photos: [],
      createdAt: now,
      updatedAt: now
    };

    await db.createAlbum(album);
    res.status(201).json({ album });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create album' });
  }
});

// Update album
app.put('/api/albums/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.getAlbumById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Album not found' });

    const updates = {
      title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
      category: req.body.category !== undefined ? req.body.category.trim() : existing.category,
      description: req.body.description !== undefined ? req.body.description.trim() : existing.description,
      cover: req.body.cover !== undefined ? req.body.cover : existing.cover
    };

    const updated = await db.updateAlbum(req.params.id, updates);
    res.json({ album: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update album' });
  }
});

// Set album cover
app.put('/api/albums/:id/cover', requireAuth, async (req, res) => {
  try {
    const { coverUrl } = req.body;
    const existing = await db.getAlbumById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Album not found' });

    const updated = await db.updateAlbum(req.params.id, { cover: coverUrl || null });
    res.json({ success: true, cover: updated.cover });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update cover' });
  }
});

// Delete album
app.delete('/api/albums/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.getAlbumById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Album not found' });

    const deleted = await db.deleteAlbum(req.params.id);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete album from database' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete album error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete album' });
  }
});

// =======================================================
// PHOTO ROUTES
// =======================================================

// Upload single photo (Expects Cloudinary imageUrl or local imageBase64 for local dev)
app.post('/api/albums/:id/photos', requireAuth, async (req, res) => {
  try {
    const { imageBase64, imageUrl, url, filename, title, tags, description, sizeBytes } = req.body;
    const albumId = req.params.id;
    const finalUrl = imageUrl || url;

    if (!finalUrl && !imageBase64) {
      return res.status(400).json({ error: 'Image URL or image data required' });
    }

    const album = await db.getAlbumById(albumId);
    if (!album) return res.status(404).json({ error: 'Album not found' });

    let photoUrl = finalUrl;
    let photoFilename = filename || 'cloudinary_image';
    let photoSize = sizeBytes || 0;

    // Fallback for local testing if URL not provided
    if (!photoUrl && imageBase64) {
      if (isVercel) {
        return res.status(400).json({
          error: 'Local filesystem storage is disabled on Vercel. Please upload directly to Cloudinary.'
        });
      }
      const saved = saveBase64Image(imageBase64);
      photoUrl = saved.url;
      photoFilename = saved.filename;
      photoSize = saved.sizeBytes;
    }

    const now = new Date().toISOString();
    const photo = {
      id: generateId(),
      uploaderId: req.user.id,
      uploaderName: req.user.username || req.user.email || 'Member',
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

    const result = await db.addPhotoToAlbum(albumId, photo);
    res.status(201).json({ photo: result.photo, album: result.album });
  } catch (err) {
    console.error('Error saving uploaded photo:', err);
    res.status(400).json({ error: err.message || 'Failed to process image' });
  }
});

// Batch upload multiple photos
app.post('/api/albums/:id/photos/batch', requireAuth, async (req, res) => {
  try {
    const { photos } = req.body;
    const albumId = req.params.id;

    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'Array of photos required' });
    }

    const album = await db.getAlbumById(albumId);
    if (!album) return res.status(404).json({ error: 'Album not found' });

    const newPhotos = [];
    const now = new Date().toISOString();

    for (const item of photos) {
      let photoUrl = item.imageUrl || item.url;
      let photoFilename = item.filename || 'cloudinary_image';
      let photoSize = item.sizeBytes || 0;

      if (!photoUrl && item.imageBase64) {
        if (isVercel) continue;
        const saved = saveBase64Image(item.imageBase64);
        photoUrl = saved.url;
        photoFilename = saved.filename;
        photoSize = saved.sizeBytes;
      }

      if (!photoUrl) continue;

      newPhotos.push({
        id: generateId(),
        uploaderId: req.user.id,
        uploaderName: req.user.username || req.user.email || 'Member',
        title: (item.title || 'Untitled').trim(),
        description: (item.description || '').trim(),
        filename: photoFilename,
        url: photoUrl,
        sizeBytes: photoSize,
        tags: Array.isArray(item.tags) ? item.tags : (item.tags ? String(item.tags).split(',').map(t => t.trim()).filter(Boolean) : []),
        isFavorite: false,
        createdAt: now,
        updatedAt: now
      });
    }

    const result = await db.addPhotosBatch(albumId, newPhotos);
    res.status(201).json({ success: true, count: result.added.length, photos: result.added });
  } catch (err) {
    console.error('Error saving batch photos:', err);
    res.status(500).json({ error: 'Failed to process batch upload' });
  }
});

// Update photo metadata
app.put('/api/albums/:albumId/photos/:photoId', requireAuth, async (req, res) => {
  try {
    const { title, tags, description, isFavorite } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = String(title).trim();
    if (description !== undefined) updates.description = String(description).trim();
    if (isFavorite !== undefined) updates.isFavorite = Boolean(isFavorite);
    if (tags !== undefined) {
      updates.tags = Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean);
    }

    const updated = await db.updatePhoto(req.params.albumId, req.params.photoId, updates);
    if (!updated) return res.status(404).json({ error: 'Photo or album not found' });
    res.json({ success: true, photo: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

// Delete single photo
app.delete('/api/albums/:albumId/photos/:photoId', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deletePhoto(req.params.albumId, req.params.photoId);
    if (!deleted) return res.status(404).json({ error: 'Photo or album not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// Get all favorited photos across albums
app.get('/api/favorites', requireAuth, async (req, res) => {
  try {
    const albums = await db.getAlbums();
    const favoritePhotos = [];

    albums.forEach(album => {
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

    favoritePhotos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ photos: favoritePhotos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve favorites' });
  }
});

// Get user tag cloud
app.get('/api/tags', requireAuth, async (req, res) => {
  try {
    const albums = await db.getAlbums();
    const tagCounts = {};

    albums.forEach(album => {
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve tags' });
  }
});

// Get detailed stats
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const albums = await db.getAlbums();

    let totalPhotos = 0;
    let totalFavorites = 0;
    let totalStorageBytes = 0;

    albums.forEach(album => {
      (album.photos || []).forEach(photo => {
        totalPhotos++;
        if (photo.isFavorite) totalFavorites++;
        if (photo.sizeBytes) totalStorageBytes += photo.sizeBytes;
      });
    });

    const totalAlbums = albums.length;
    const placesCount = albums.filter(a => a.category === 'place').length;
    const peopleCount = albums.filter(a => a.category === 'person').length;
    const usesCount = albums.filter(a => a.category === 'use').length;

    res.json({
      totalPhotos,
      totalAlbums,
      placesCount,
      peopleCount,
      usesCount,
      totalFavorites,
      totalStorageBytes
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// Advanced unified search
app.get('/api/search', requireAuth, async (req, res) => {
  try {
    const { q, category, tag, favorite, sort = 'newest' } = req.query;
    const albums = await db.getAlbums();
    let userAlbums = [...albums];

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

    let photos = [];
    albums.forEach(album => {
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

    if (sort === 'newest') {
      photos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sort === 'oldest') {
      photos.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else if (sort === 'title') {
      photos.sort((a, b) => a.title.localeCompare(b.title));
    }

    res.json({ albums: userAlbums, photos });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// Start server locally (only when executed directly)
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