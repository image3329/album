// ==========================================================================
// Memory Album — Unified Database Access Layer (Firestore + Resilient Fallback)
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { getFirestoreDb } = require('./firebase-admin');

// Local storage paths (used for fallback or offline test modes)
const isVercel = Boolean(process.env.VERCEL);
const SEED_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = isVercel ? '/tmp/data' : SEED_DATA_DIR;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function initLocalFile(filePath, seedName, defaultData) {
  if (!fs.existsSync(filePath)) {
    const seed = path.join(SEED_DATA_DIR, seedName);
    if (fs.existsSync(seed)) {
      try {
        fs.copyFileSync(seed, filePath);
        return;
      } catch {}
    }
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
    } catch {}
  }
}
initLocalFile(USERS_FILE, 'users.json', { users: [] });
initLocalFile(ALBUMS_FILE, 'albums.json', { albums: [] });

function readLocalUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || [];
  } catch {
    return [];
  }
}

function writeLocalUsers(users) {
  try {
    const tmp = `${USERS_FILE}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), 'utf8');
    fs.renameSync(tmp, USERS_FILE);
  } catch (err) {
    console.warn('Local users write note:', err.message);
  }
}

function readLocalAlbums() {
  try {
    return JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8')).albums || [];
  } catch {
    return [];
  }
}

function writeLocalAlbums(albums) {
  try {
    const tmp = `${ALBUMS_FILE}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ albums }, null, 2), 'utf8');
    fs.renameSync(tmp, ALBUMS_FILE);
  } catch (err) {
    console.warn('Local albums write note:', err.message);
  }
}

// --------------------------------------------------------------------------
// Firestore Helper
// --------------------------------------------------------------------------
function getDb() {
  return getFirestoreDb();
}

// --------------------------------------------------------------------------
// User Operations
// --------------------------------------------------------------------------
async function getUsers() {
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection('users').get();
      if (!snap.empty) {
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } catch (err) {
      console.warn('Firestore getUsers fallback to local:', err.message);
    }
  }
  return readLocalUsers();
}

async function getUserById(id) {
  if (!id) return null;
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection('users').doc(id).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
    } catch (err) {
      console.warn('Firestore getUserById fallback to local:', err.message);
    }
  }
  const users = readLocalUsers();
  return users.find(u => u.id === id || u.firebaseUid === id) || null;
}

async function getUserByEmail(email) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection('users').where('email', '==', cleanEmail).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() };
      }
    } catch (err) {
      console.warn('Firestore getUserByEmail fallback to local:', err.message);
    }
  }
  const users = readLocalUsers();
  return users.find(u => (u.email || '').toLowerCase() === cleanEmail) || null;
}

async function createUser(user) {
  const db = getDb();
  const userData = {
    ...user,
    email: (user.email || '').trim().toLowerCase(),
    updatedAt: user.updatedAt || new Date().toISOString()
  };

  if (db) {
    try {
      await db.collection('users').doc(user.id).set(userData, { merge: true });
    } catch (err) {
      console.warn('Firestore createUser write note:', err.message);
    }
  }

  // Also sync locally
  const users = readLocalUsers();
  const index = users.findIndex(u => u.id === user.id || u.email.toLowerCase() === userData.email);
  if (index !== -1) {
    users[index] = { ...users[index], ...userData };
  } else {
    users.push(userData);
  }
  writeLocalUsers(users);

  return userData;
}

async function updateUser(id, updates) {
  const db = getDb();
  const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };

  if (db) {
    try {
      await db.collection('users').doc(id).set(cleanUpdates, { merge: true });
    } catch (err) {
      console.warn('Firestore updateUser write note:', err.message);
    }
  }

  const users = readLocalUsers();
  const index = users.findIndex(u => u.id === id);
  if (index !== -1) {
    users[index] = { ...users[index], ...cleanUpdates };
    writeLocalUsers(users);
    return users[index];
  }
  return null;
}

// --------------------------------------------------------------------------
// Album Operations
// --------------------------------------------------------------------------
async function getAlbums() {
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection('albums').get();
      if (!snap.empty) {
        const albums = snap.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            ...d,
            photos: Array.isArray(d.photos) ? d.photos : []
          };
        });
        return albums;
      }
    } catch (err) {
      console.warn('Firestore getAlbums fallback to local:', err.message);
    }
  }
  return readLocalAlbums();
}

async function getAlbumById(id) {
  if (!id) return null;
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection('albums').doc(id).get();
      if (doc.exists) {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          photos: Array.isArray(d.photos) ? d.photos : []
        };
      }
    } catch (err) {
      console.warn('Firestore getAlbumById fallback to local:', err.message);
    }
  }
  const albums = readLocalAlbums();
  return albums.find(a => a.id === id) || null;
}

async function createAlbum(album) {
  const db = getDb();
  const now = new Date().toISOString();
  const albumData = {
    ...album,
    photos: Array.isArray(album.photos) ? album.photos : [],
    createdAt: album.createdAt || now,
    updatedAt: album.updatedAt || now
  };

  if (db) {
    try {
      await db.collection('albums').doc(album.id).set(albumData);
    } catch (err) {
      console.warn('Firestore createAlbum write note:', err.message);
    }
  }

  const albums = readLocalAlbums();
  albums.push(albumData);
  writeLocalAlbums(albums);

  return albumData;
}

async function updateAlbum(id, updates) {
  const db = getDb();
  const now = new Date().toISOString();
  const cleanUpdates = { ...updates, updatedAt: now };

  if (db) {
    try {
      await db.collection('albums').doc(id).set(cleanUpdates, { merge: true });
    } catch (err) {
      console.warn('Firestore updateAlbum write note:', err.message);
    }
  }

  const albums = readLocalAlbums();
  const index = albums.findIndex(a => a.id === id);
  if (index !== -1) {
    albums[index] = { ...albums[index], ...cleanUpdates };
    writeLocalAlbums(albums);
    return albums[index];
  }
  return null;
}

async function deleteAlbum(id) {
  const db = getDb();
  if (db) {
    try {
      await db.collection('albums').doc(id).delete();
    } catch (err) {
      console.warn('Firestore deleteAlbum write note:', err.message);
    }
  }

  const albums = readLocalAlbums();
  const index = albums.findIndex(a => a.id === id);
  if (index !== -1) {
    albums.splice(index, 1);
    writeLocalAlbums(albums);
    return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Photo Operations
// --------------------------------------------------------------------------
async function addPhotoToAlbum(albumId, photo) {
  const album = await getAlbumById(albumId);
  if (!album) return null;

  const now = new Date().toISOString();
  const newPhoto = {
    ...photo,
    createdAt: photo.createdAt || now,
    updatedAt: photo.updatedAt || now
  };

  const photos = Array.isArray(album.photos) ? [...album.photos] : [];
  photos.push(newPhoto);

  const updates = {
    photos,
    cover: album.cover || newPhoto.url,
    updatedAt: now
  };

  await updateAlbum(albumId, updates);
  return { photo: newPhoto, album: { ...album, ...updates } };
}

async function addPhotosBatch(albumId, newPhotosList) {
  const album = await getAlbumById(albumId);
  if (!album) return null;

  const now = new Date().toISOString();
  const added = newPhotosList.map(p => ({
    ...p,
    createdAt: p.createdAt || now,
    updatedAt: p.updatedAt || now
  }));

  const photos = Array.isArray(album.photos) ? [...album.photos] : [];
  photos.push(...added);

  const updates = {
    photos,
    cover: album.cover || (added[0] ? added[0].url : null),
    updatedAt: now
  };

  await updateAlbum(albumId, updates);
  return { added, album: { ...album, ...updates } };
}

async function updatePhoto(albumId, photoId, updates) {
  const album = await getAlbumById(albumId);
  if (!album) return null;

  const photos = Array.isArray(album.photos) ? [...album.photos] : [];
  const index = photos.findIndex(p => p.id === photoId);
  if (index === -1) return null;

  const now = new Date().toISOString();
  photos[index] = {
    ...photos[index],
    ...updates,
    updatedAt: now
  };

  await updateAlbum(albumId, { photos, updatedAt: now });
  return photos[index];
}

async function deletePhoto(albumId, photoId) {
  const album = await getAlbumById(albumId);
  if (!album) return null;

  const photos = Array.isArray(album.photos) ? [...album.photos] : [];
  const index = photos.findIndex(p => p.id === photoId);
  if (index === -1) return null;

  const deleted = photos[index];
  photos.splice(index, 1);

  const now = new Date().toISOString();
  let cover = album.cover;
  if (cover === deleted.url) {
    cover = photos.length > 0 ? photos[0].url : null;
  }

  await updateAlbum(albumId, { photos, cover, updatedAt: now });
  return deleted;
}

module.exports = {
  getUsers,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  getAlbums,
  getAlbumById,
  createAlbum,
  updateAlbum,
  deleteAlbum,
  addPhotoToAlbum,
  addPhotosBatch,
  updatePhoto,
  deletePhoto,
  readLocalUsers,
  readLocalAlbums
};
