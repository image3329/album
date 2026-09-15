const http = require('http');
const app = require('./server');

const TEST_PORT = process.env.TEST_PORT || 3099;

function apiRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: data ? JSON.parse(data) : {},
          });
        } catch {
          resolve({
            statusCode: res.statusCode,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runAllTests() {
  // Start server on dedicated test port
  const server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => {
      console.log(`Test server running on port ${TEST_PORT}\n`);
      resolve(s);
    });
  });

  const authorizedMemberEmail = 'sahimage691@gmail.com';
  const authorizedMemberUser = 'Sah Image';
  const unauthorizedEmail = 'intruder@randomdomain.com';

  let sessionId = '';
  let createdAlbumId = '';
  let createdPhotoId = '';
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${message}`);
    } else {
      failed++;
      console.log(`  ✗ ${message}`);
    }
  }

  console.log('=== Photo Album Firestore, Auth & Storage Test Suite ===\n');

  try {
    // 0. Test API Health & Database Status
    console.log('0. Testing Health & Status API...');
    const ping = await apiRequest('GET', '/api/ping');
    assert(ping.statusCode === 200, `Health check: status ${ping.statusCode}`);
    assert(ping.body.database === 'Cloud Firestore', 'Health check: database is Cloud Firestore');

    // 1. Test Whitelist Enforcement (Unauthorized email blocked)
    console.log('\n1. Testing Whitelist Security (Unauthorized email attempt)...');
    const blocked = await apiRequest('POST', '/api/auth/login', {
      email: unauthorizedEmail,
      password: 'SomePassword123!',
    });
    assert(blocked.statusCode === 403, `Unauthorized email blocked: status ${blocked.statusCode} (expected 403)`);
    assert(blocked.body.error && blocked.body.error.toLowerCase().includes('restricted'), 'Whitelist rejection message received');

    // 1b. Test Firebase login with unauthorized email
    console.log('\n1b. Testing Firebase Bridge with unauthorized email...');
    const fbBlocked = await apiRequest('POST', '/api/auth/firebase-login', {
      email: unauthorizedEmail,
      username: 'Intruder',
      idToken: 'mock_firebase_id_token_for_test'
    });
    assert(fbBlocked.statusCode === 403, `Unauthorized Firebase login blocked: status ${fbBlocked.statusCode} (expected 403)`);

    // 2. Test Firebase Login Bridge with Authorized Member
    console.log('\n2. Authenticating Authorized Member via Firebase Login Bridge...');
    const fbLogin = await apiRequest('POST', '/api/auth/firebase-login', {
      email: authorizedMemberEmail,
      username: authorizedMemberUser,
      idToken: 'mock_firebase_id_token_for_test'
    });
    assert(fbLogin.statusCode === 200, `Firebase Member Login: status ${fbLogin.statusCode}`);
    assert(fbLogin.body.sessionId, 'Firebase Member Login: received valid sessionId');
    sessionId = fbLogin.body.sessionId;
    assert(fbLogin.body.user.email === authorizedMemberEmail, `Firebase Member Login: email matches (${authorizedMemberEmail})`);

    // 3. Get current member profile (/api/auth/me)
    console.log('\n3. Getting authenticated member profile...');
    const me = await apiRequest('GET', '/api/auth/me', null, { 'x-session-id': sessionId });
    assert(me.statusCode === 200, `Get user: status ${me.statusCode}`);
    const email = me.body.email || (me.body.user && me.body.user.email);
    assert(email === authorizedMemberEmail, `Get user: email is ${email}`);

    // 4. Create album as authorized member
    console.log('\n4. Creating album in Firestore...');
    const create = await apiRequest('POST', '/api/albums', {
      title: 'Private Dolomites Expedition',
      category: 'place',
      description: 'Private collection for authorized members only',
    }, { 'x-session-id': sessionId });
    assert(create.statusCode === 201, `Create album: status ${create.statusCode}`);
    assert(create.body.album.title === 'Private Dolomites Expedition', 'Create album: title correct');
    assert(create.body.album.category === 'place', 'Create album: category is place');
    createdAlbumId = create.body.album.id;

    // 5. Upload photo via direct Firebase Storage Cloud URL
    console.log('\n5. Uploading photo via Firebase Storage Cloud URL...');
    const cloudUrl = 'https://firebasestorage.googleapis.com/v0/b/album29-cc9c8.firebasestorage.app/o/users%2Fmember%2Ftest.jpg?alt=media&token=123';
    const uploadCloud = await apiRequest('POST', `/api/albums/${createdAlbumId}/photos`, {
      imageUrl: cloudUrl,
      title: 'Cloud Stored Sunset Photo',
      filename: 'test.jpg',
      sizeBytes: 10240,
      tags: ['firebase', 'cloud', 'sunset'],
    }, { 'x-session-id': sessionId });
    assert(uploadCloud.statusCode === 201, `Upload cloud photo: status ${uploadCloud.statusCode}`);
    assert(uploadCloud.body.photo.url === cloudUrl, 'Upload cloud photo: URL correctly preserved as cloud URL');
    createdPhotoId = uploadCloud.body.photo.id;

    // 5b. Batch photo upload test
    console.log('\n5b. Batch photo upload via Firebase Storage Cloud URLs...');
    const batchRes = await apiRequest('POST', `/api/albums/${createdAlbumId}/photos/batch`, {
      photos: [
        {
          imageUrl: 'https://firebasestorage.googleapis.com/v0/b/album29-cc9c8.firebasestorage.app/o/batch1.jpg?alt=media',
          title: 'Batch Photo 1',
          filename: 'batch1.jpg',
          sizeBytes: 54321,
          tags: ['batch', 'sunset']
        },
        {
          imageUrl: 'https://firebasestorage.googleapis.com/v0/b/album29-cc9c8.firebasestorage.app/o/batch2.jpg?alt=media',
          title: 'Batch Photo 2',
          filename: 'batch2.jpg',
          sizeBytes: 65432,
          tags: ['batch', 'nature']
        }
      ]
    }, { 'x-session-id': sessionId });
    assert(batchRes.statusCode === 201, `Batch upload: status ${batchRes.statusCode}`);
    assert(batchRes.body.count === 2, 'Batch upload: 2 photos uploaded');

    // 6. Favorite and update photo
    console.log('\n6. Updating photo (favorite & tags)...');
    const updatePhoto = await apiRequest('PUT', `/api/albums/${createdAlbumId}/photos/${createdPhotoId}`, {
      title: 'Cloud Stored Sunset Photo (Starred)',
      isFavorite: true,
      tags: ['firebase', 'cloud', 'favorite', 'sunset']
    }, { 'x-session-id': sessionId });
    assert(updatePhoto.statusCode === 200, `Update photo: status ${updatePhoto.statusCode}`);
    assert(updatePhoto.body.photo.isFavorite === true, 'Update photo: favorited successfully');

    // 7. Get favorites
    console.log('\n7. Getting favorites...');
    const favs = await apiRequest('GET', '/api/favorites', null, { 'x-session-id': sessionId });
    assert(favs.statusCode === 200, `Get favorites: status ${favs.statusCode}`);
    assert(Array.isArray(favs.body.photos) && favs.body.photos.length >= 1, 'Get favorites: photo in favorites');

    // 8. Get tags
    console.log('\n8. Getting tag cloud...');
    const tagsRes = await apiRequest('GET', '/api/tags', null, { 'x-session-id': sessionId });
    assert(tagsRes.statusCode === 200, `Get tags: status ${tagsRes.statusCode}`);
    assert(Array.isArray(tagsRes.body.tags) && tagsRes.body.tags.length > 0, 'Get tags: returned tags array');

    // 9. Get stats
    console.log('\n9. Getting stats...');
    const stats = await apiRequest('GET', '/api/stats', null, { 'x-session-id': sessionId });
    assert(stats.statusCode === 200, `Get stats: status ${stats.statusCode}`);
    assert(stats.body.totalPhotos >= 3, `Get stats: photos >= 3 (${stats.body.totalPhotos})`);
    assert(stats.body.totalAlbums >= 1, `Get stats: albums >= 1 (${stats.body.totalAlbums})`);

    // 10. Search
    console.log('\n10. Searching...');
    const search = await apiRequest('GET', '/api/search?q=Sunset&category=all', null, { 'x-session-id': sessionId });
    assert(search.statusCode === 200, `Search: status ${search.statusCode}`);
    assert(Array.isArray(search.body.photos) && search.body.photos.length >= 1, 'Search: found matching photos');

    // 11. Delete single photo
    console.log('\n11. Deleting single photo...');
    const delPhoto = await apiRequest('DELETE', `/api/albums/${createdAlbumId}/photos/${createdPhotoId}`, null, { 'x-session-id': sessionId });
    assert(delPhoto.statusCode === 200, `Delete photo: status ${delPhoto.statusCode}`);

    // 12. Clean up test album
    console.log('\n12. Cleaning up test album...');
    const delAlbum = await apiRequest('DELETE', `/api/albums/${createdAlbumId}`, null, { 'x-session-id': sessionId });
    assert(delAlbum.statusCode === 200, `Delete album: status ${delAlbum.statusCode}`);

    // 13. Logout
    console.log('\n13. Logging out...');
    const logout = await apiRequest('POST', '/api/auth/logout', null, { 'x-session-id': sessionId });
    assert(logout.statusCode === 200, `Logout: status ${logout.statusCode}`);

    // 14. Verify session cleared
    console.log('\n14. Verifying session cleared...');
    const meAfterLogout = await apiRequest('GET', '/api/auth/me', null, { 'x-session-id': sessionId });
    assert(meAfterLogout.statusCode === 401, `Session cleared: status ${meAfterLogout.statusCode} (expected 401)`);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed === 0) {
    console.log('\n🎉 All backend API & Firestore tests passed successfully!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed - check output above.');
    process.exit(1);
  }
}

runAllTests();