// ==========================================================================
// Memory Album — Firestore & Firebase Storage Migration Utility
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { admin, getFirestoreDb, PROJECT_ID } = require('../lib/firebase-admin');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

async function runMigration() {
  console.log('====================================================');
  console.log('Memory Album Firestore & Storage Migration');
  console.log(`Target Firebase Project: ${PROJECT_ID}`);
  console.log('====================================================\n');

  const db = getFirestoreDb();
  if (!db) {
    console.warn('⚠️  Could not initialize Firestore client.');
    console.warn('Please ensure FIREBASE_PROJECT_ID / service account credentials are provided.');
    console.warn('Migration aborted without modifying any local files.\n');
    process.exit(1);
  }

  // 1. Migrate Users
  let usersToMigrate = [];
  if (fs.existsSync(USERS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      usersToMigrate = data.users || [];
    } catch (e) {
      console.error('Error reading users.json:', e.message);
    }
  }

  console.log(`Found ${usersToMigrate.length} user(s) to migrate...`);
  let userSuccess = 0;
  for (const user of usersToMigrate) {
    try {
      const docId = user.id || user.email.replace(/[^a-zA-Z0-9]/g, '_');
      await db.collection('users').doc(docId).set({
        id: user.id,
        username: user.username,
        email: user.email.toLowerCase().trim(),
        passwordHash: user.passwordHash || 'firebase_managed',
        theme: user.theme || 'dark',
        createdAt: user.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      userSuccess++;
      console.log(`  ✓ Migrated user: ${user.email} (${user.username})`);
    } catch (err) {
      console.error(`  ✗ Failed migrating user ${user.email}:`, err.message);
    }
  }

  // 2. Migrate Albums & Photos
  let albumsToMigrate = [];
  if (fs.existsSync(ALBUMS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8'));
      albumsToMigrate = data.albums || [];
    } catch (e) {
      console.error('Error reading albums.json:', e.message);
    }
  }

  console.log(`\nFound ${albumsToMigrate.length} album(s) to migrate...`);
  let bucket = null;
  try {
    const apps = typeof admin.getApps === 'function' ? admin.getApps() : (admin.apps || []);
    if (apps.length > 0) {
      bucket = admin.storage().bucket();
    }
  } catch (err) {
    console.warn('Firebase Storage bucket not directly accessible via Admin SDK in current context:', err.message);
  }

  let albumSuccess = 0;
  let photosMigrated = 0;

  for (const album of albumsToMigrate) {
    try {
      const updatedPhotos = [];
      const photos = Array.isArray(album.photos) ? album.photos : [];

      for (const photo of photos) {
        let photoUrl = photo.url;

        // Check if photo is currently referencing local /uploads
        if (photoUrl && photoUrl.startsWith('/uploads/') && bucket) {
          const filename = photo.filename || path.basename(photoUrl);
          const localPath = path.join(UPLOADS_DIR, filename);

          if (fs.existsSync(localPath)) {
            try {
              const storageDestination = `migrated_uploads/${album.id}/${filename}`;
              console.log(`    Uploading ${filename} to Firebase Storage...`);
              await bucket.upload(localPath, {
                destination: storageDestination,
                public: true,
                metadata: {
                  contentType: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
                  metadata: {
                    originalName: photo.title || filename,
                    albumId: album.id
                  }
                }
              });

              // Public download URL
              photoUrl = `https://storage.googleapis.com/${bucket.name}/${storageDestination}`;
              photosMigrated++;
            } catch (upErr) {
              console.warn(`    Could not upload ${filename} to Storage:`, upErr.message);
            }
          }
        }

        updatedPhotos.push({
          ...photo,
          url: photoUrl
        });
      }

      let coverUrl = album.cover;
      if (coverUrl && coverUrl.startsWith('/uploads/') && updatedPhotos.length > 0) {
        coverUrl = updatedPhotos[0].url;
      }

      await db.collection('albums').doc(album.id).set({
        id: album.id,
        userId: album.userId,
        creatorName: album.creatorName || 'Member',
        title: album.title,
        category: album.category,
        description: album.description || '',
        cover: coverUrl,
        photos: updatedPhotos,
        createdAt: album.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      albumSuccess++;
      console.log(`  ✓ Migrated album: "${album.title}" (${updatedPhotos.length} photos)`);
    } catch (err) {
      console.error(`  ✗ Failed migrating album ${album.title}:`, err.message);
    }
  }

  console.log('\n====================================================');
  console.log(`Migration Finished!`);
  console.log(`Users Migrated: ${userSuccess}/${usersToMigrate.length}`);
  console.log(`Albums Migrated: ${albumSuccess}/${albumsToMigrate.length}`);
  console.log(`Local Photos Uploaded to Cloud: ${photosMigrated}`);
  console.log('Original local files have NOT been deleted.');
  console.log('====================================================');
}

if (require.main === module) {
  runMigration().then(() => process.exit(0)).catch(e => {
    console.error('Fatal migration error:', e);
    process.exit(1);
  });
}

module.exports = { runMigration };
