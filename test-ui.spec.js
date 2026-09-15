const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('Memory Album Firebase Restricted Access & Production UI Flow', () => {

  test('1. Whitelist Security: block unauthorized emails and prevent registration', async ({ page }) => {
    await page.goto('http://localhost:3000/index.html');
    await expect(page).toHaveURL(/index.html/);
    await expect(page.locator('h1')).toHaveText('Memory Album');

    // Verify Sign-up option is strictly removed
    await expect(page.locator('#tabRegister')).toHaveCount(0);
    await expect(page.locator('#registerForm')).toHaveCount(0);
    await expect(page.locator('#showRegister')).toHaveCount(0);

    // Test Theme Toggle
    const themeBtn = page.locator('#themeToggleBtn');
    await themeBtn.click();
    const currentTheme = await page.getAttribute('html', 'data-theme');
    expect(['dark', 'light']).toContain(currentTheme);

    // Attempt login with unauthorized email
    await page.fill('#loginEmail', 'unauthorized_intruder@random.com');
    await page.fill('#loginPassword', 'anyPassword123');
    await page.click('#loginSubmit');

    // Expect access denied error to appear
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginError')).toContainText(/restricted|not on the authorized/i);
  });

  test('2. Member Login, Album Creation, Photo Upload, and Lightbox', async ({ page }) => {
    await page.goto('http://localhost:3000/index.html');

    // Sign in as pre-approved authorized member
    await page.fill('#loginEmail', 'sahimage691@gmail.com');
    await page.fill('#loginPassword', 'password123');
    await page.click('#loginSubmit');

    // Verify successful redirect to app.html
    await page.waitForURL(/app.html/, { timeout: 10000 });
    await expect(page.locator('#userBadge')).toBeVisible();

    // Create New Album
    await page.click('#addAlbumBtn');
    await expect(page.locator('#albumModal')).toBeVisible();

    const albumTitle = 'Private Dolomites Archive ' + Date.now().toString(36);
    await page.fill('#albumTitle', albumTitle);
    await page.fill('#albumDescription', 'Confidential private memories for family members only');
    await page.click('input[name="category"][value="place"]');
    await page.click('#saveAlbumBtn');

    // Modal closes and album card appears
    await expect(page.locator('#albumModal')).toBeHidden();
    await expect(page.locator('.album-card').first()).toBeVisible();

    // Open Photo Modal for this Album
    await page.click('.album-card .btn-add-photo');
    await expect(page.locator('#photoModal')).toBeVisible();

    // Fill photo form
    const photoTitle = 'Alpine Vista Peak';
    await page.fill('#photoTitle', photoTitle);
    await page.fill('#photoTags', 'dolomites, private, alpine');

    // Create a temporary test image
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#browseBtn');
    const fileChooser = await fileChooserPromise;

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const testImgPath = path.join(tmpDir, 'test-alpine.png');
    const base64Pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(testImgPath, Buffer.from(base64Pixel, 'base64'));

    await fileChooser.setFiles(testImgPath);
    await expect(page.locator('#imagePreview')).toBeVisible();

    // Submit upload
    await page.click('#uploadPhotoBtn');
    await expect(page.locator('#photoModal')).toBeHidden();

    // Switch to "All Photos" view
    await page.click('#tabViewAllPhotos');
    await expect(page.locator('.photo-card').first()).toBeVisible();

    // Launch Ultra Lightbox
    await page.click('.photo-card img');
    await expect(page.locator('#viewModal')).toBeVisible();
    await expect(page.locator('#viewerImage')).toBeVisible();
    await expect(page.locator('#viewerTitle')).toContainText('Alpine');

    // Close Lightbox
    await page.click('#closeViewModal');
    await expect(page.locator('#viewModal')).toBeHidden();

    // 3. Test Refresh Persistence: Page refresh while logged in
    await page.reload();
    await expect(page.locator('#userBadge')).toBeVisible();
    await expect(page).toHaveURL(/app.html/);

    // Photos still load after refresh
    await page.click('#tabViewAllPhotos');
    await expect(page.locator('.photo-card').first()).toBeVisible();

    // 4. Test Search
    await page.fill('#searchInput', 'Alpine');
    await expect(page.locator('.photo-card').first()).toBeVisible();

    // Clear search
    await page.click('#searchClearBtn');

    // Clean up created album
    await page.evaluate(async (titleToClean) => {
      const res = await window.MemoryAlbumAuth.apiFetch('/api/albums');
      if (res.ok) {
        const data = await res.json();
        const albums = (data.albums || []).filter(a => a.title === titleToClean);
        for (const a of albums) {
          await window.MemoryAlbumAuth.apiFetch(`/api/albums/${a.id}`, { method: 'DELETE' });
        }
      }
    }, albumTitle);

    // 5. Sign Out
    await page.click('#userBadgeBtn');
    await page.click('#logoutBtn');
    await page.waitForURL(/index.html/, { timeout: 10000 });
    await expect(page.locator('#loginForm')).toBeVisible();
  });
});