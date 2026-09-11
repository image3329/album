const http = require('http');

function apiRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
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

async function testFlow() {
  const authorizedMemberEmail = 'member@memoryalbum.com';
  const authorizedMemberUser = 'Authorized Member';
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

  console.log('=== Photo Album Firebase & Whitelist Member Access Test ===\n');

  // 1. Test Whitelist Enforcement (Unauthorized email blocked)
  console.log('1. Testing Whitelist Security (Unauthorized email attempt)...');
  try {
    const blocked = await apiRequest('POST', '/api/auth/login', {
      email: unauthorizedEmail,
      password: 'SomePassword123!',
    });
    assert(blocked.statusCode === 403, `Unauthorized email blocked: status ${blocked.statusCode} (expected 403)`);
    assert(blocked.body.error && blocked.body.error.toLowerCase().includes('restricted'), 'Whitelist rejection message received');
  } catch (e) {
    assert(false, `Whitelist check: error - ${e.message}`);
  }

  // 2. Test Firebase Login Bridge with Authorized Member
  console.log('\n2. Authenticating Authorized Member via Firebase Login Bridge...');
  try {
    const fbLogin = await apiRequest('POST', '/api/auth/firebase-login', {
      email: authorizedMemberEmail,
      username: authorizedMemberUser,
      idToken: 'mock_firebase_id_token_for_test'
    });
    assert(fbLogin.statusCode === 200, `Firebase Member Login: status ${fbLogin.statusCode}`);
    assert(fbLogin.body.sessionId, 'Firebase Member Login: received valid sessionId');
    sessionId = fbLogin.body.sessionId;
    assert(fbLogin.body.user.email === authorizedMemberEmail, `Firebase Member Login: email matches (${authorizedMemberEmail})`);
  } catch (e) {
    assert(false, `Firebase Member Login: error - ${e.message}`);
  }

  // 3. Get current member profile
  console.log('\n3. Getting authenticated member profile...');
  try {
    const me = await apiRequest('GET', '/api/auth/me', null, { 'x-session-id': sessionId });
    assert(me.statusCode === 200, `Get user: status ${me.statusCode}`);
    const email = me.body.email || (me.body.user && me.body.user.email);
    assert(email === authorizedMemberEmail, `Get user: email is ${email}`);
  } catch (e) {
    assert(false, `Get user: error - ${e.message}`);
  }

  // 4. Create album as authorized member
  console.log('\n4. Creating album...');
  try {
    const create = await apiRequest('POST', '/api/albums', {
      title: 'Private Dolomites Expedition',
      category: 'place',
      description: 'Private collection for authorized members only',
    }, { 'x-session-id': sessionId });
    assert(create.statusCode === 201, `Create album: status ${create.statusCode}`);
    assert(create.body.album.title === 'Private Dolomites Expedition', 'Create album: title correct');
    assert(create.body.album.category === 'place', 'Create album: category is place');
    createdAlbumId = create.body.album.id;
  } catch (e) {
    assert(false, `Create album: error - ${e.message}`);
  }

  // 5. Upload photo to album
  console.log('\n5. Uploading photo to album...');
  try {
    const base64Pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const upload = await apiRequest('POST', `/api/albums/${createdAlbumId}/photos`, {
      imageBase64: base64Pixel,
      title: 'Alpine Vista at Sunset',
      description: 'Sunset over mountain ridge',
      tags: ['dolomites', 'sunset', 'private', 'mountains'],
    }, { 'x-session-id': sessionId });
    assert(upload.statusCode === 201, `Upload photo: status ${upload.statusCode}`);
    assert(upload.body.photo.title === 'Alpine Vista at Sunset', 'Upload photo: title correct');
    createdPhotoId = upload.body.photo.id;
  } catch (e) {
    assert(false, `Upload photo: error - ${e.message}`);
  }

  // 6. Favorite and update photo
  console.log('\n6. Updating photo (favorite & tags)...');
  try {
    const updatePhoto = await apiRequest('PUT', `/api/albums/${createdAlbumId}/photos/${createdPhotoId}`, {
      title: 'Alpine Vista at Sunset (Starred)',
      isFavorite: true,
      tags: ['dolomites', 'sunset', 'favorite', 'private']
    }, { 'x-session-id': sessionId });
    assert(updatePhoto.statusCode === 200, `Update photo: status ${updatePhoto.statusCode}`);
    assert(updatePhoto.body.photo.isFavorite === true, 'Update photo: favorited successfully');
  } catch (e) {
    assert(false, `Update photo: error - ${e.message}`);
  }

  // 7. Get favorites
  console.log('\n7. Getting favorites...');
  try {
    const favs = await apiRequest('GET', '/api/favorites', null, { 'x-session-id': sessionId });
    assert(favs.statusCode === 200, `Get favorites: status ${favs.statusCode}`);
    assert(Array.isArray(favs.body.photos) && favs.body.photos.length >= 1, 'Get favorites: photo in favorites');
  } catch (e) {
    assert(false, `Get favorites: error - ${e.message}`);
  }

  // 8. Get tags
  console.log('\n8. Getting tag cloud...');
  try {
    const tagsRes = await apiRequest('GET', '/api/tags', null, { 'x-session-id': sessionId });
    assert(tagsRes.statusCode === 200, `Get tags: status ${tagsRes.statusCode}`);
    assert(Array.isArray(tagsRes.body.tags) && tagsRes.body.tags.length > 0, 'Get tags: returned tags array');
  } catch (e) {
    assert(false, `Get tags: error - ${e.message}`);
  }

  // 9. Get stats
  console.log('\n9. Getting stats...');
  try {
    const stats = await apiRequest('GET', '/api/stats', null, { 'x-session-id': sessionId });
    assert(stats.statusCode === 200, `Get stats: status ${stats.statusCode}`);
    assert(stats.body.totalPhotos >= 1, `Get stats: photos >= 1 (${stats.body.totalPhotos})`);
    assert(stats.body.totalAlbums >= 1, `Get stats: albums >= 1 (${stats.body.totalAlbums})`);
    assert(stats.body.totalFavorites >= 1, `Get stats: favorites >= 1 (${stats.body.totalFavorites})`);
  } catch (e) {
    assert(false, `Get stats: error - ${e.message}`);
  }

  // 10. Search
  console.log('\n10. Searching...');
  try {
    const search = await apiRequest('GET', '/api/search?q=Sunset&category=all', null, { 'x-session-id': sessionId });
    assert(search.statusCode === 200, `Search: status ${search.statusCode}`);
    assert(Array.isArray(search.body.photos) && search.body.photos.length >= 1, 'Search: found matching photo');
  } catch (e) {
    assert(false, `Search: error - ${e.message}`);
  }

  // 11. Logout
  console.log('\n11. Logging out...');
  try {
    const logout = await apiRequest('POST', '/api/auth/logout', null, { 'x-session-id': sessionId });
    assert(logout.statusCode === 200, `Logout: status ${logout.statusCode}`);
  } catch (e) {
    assert(false, `Logout: error - ${e.message}`);
  }

  // 12. Verify session cleared
  console.log('\n12. Verifying session cleared...');
  try {
    const me = await apiRequest('GET', '/api/auth/me', null, { 'x-session-id': sessionId });
    assert(me.statusCode === 401, `Session cleared: status ${me.statusCode} (expected 401)`);
  } catch (e) {
    assert(true, `Session cleared: rejected as expected`);
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed === 0) {
    console.log('\n🎉 All Firebase Auth & Member Whitelist flow tests passed successfully!');
  } else {
    console.log('\n⚠️  Some tests failed - check output above.');
    process.exit(1);
  }
}

testFlow();