const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('Memory Album Firebase Restricted Access & UI Flow', () => {
  test('should verify registration is removed, block unauthorized emails, allow member login, and manage collection', async ({ page }) => {
    // 1. Visit Login Portal
    await page.goto('http://localhost:3000/index.html');
    await expect(page).toHaveURL(/index.html/);
    await expect(page.locator('h1')).toHaveText('Memory Album');

    // 2. Verify Sign-up option is removed
    await expect(page.locator('#tabRegister')).toHaveCount(0);
    await expect(page.locator('#registerForm')).toHaveCount(0);
    await expect(page.locator('#showRegister')).toHaveCount(0);

    // 3. Test Theme Toggle on Login page
    const themeBtn = page.locator('#themeToggleBtn');
    await themeBtn.click();
    const currentTheme = await page.getAttribute('html', 'data-theme');
    expect(['dark', 'light']).toContain(currentTheme);

    // 4. Test Whitelist Enforcement (Unauthorized email attempt)
    await page.fill('#loginEmail', 'unauthorized_intruder@random.com');
    await page.fill('#loginPassword', 'anyPassword123');
    await page.click('#loginSubmit');

    // Expect access denied error to appear
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginError')).toContainText(/restricted|not on the authorized/i);

    // 5. Sign in as pre-approved authorized member
    await page.fill('#loginEmail', 'test@example.com');
    await page.fill('#loginPassword', 'testpass123');
    await page.click('#loginSubmit');

    // 6. Verify successful redirect to app.html
    await page.waitForURL(/app.html/, { timeout: 10000 });
    await expect(page.locator('#userBadge')).toBeVisible();

    // 7. Create New Album
    await page.click('#addAlbumBtn');
    await expect(page.locator('#albumModal')).toBeVisible();

    await page.fill('#albumTitle', 'Private Family Archive');
    await page.fill('#albumDescription', 'Confidential private memories for family members only');
    await page.click('input[name="category"][value="place"]');
    await page.click('#saveAlbumBtn');

    // Modal closes and album card appears
    await expect(page.locator('#albumModal')).toBeHidden();
    await expect(page.locator('.album-card').first()).toContainText('Private Family Archive');

    // 8. Open Photo Modal for this Album
    await page.click('.album-card .btn-add-photo');
    await expect(page.locator('#photoModal')).toBeVisible();

    // Fill photo form
    await page.fill('#photoTitle', 'Family Gathering Panorama');
    await page.fill('#photoTags', 'family, private, archive');

    // Upload test image
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#browseBtn');
    const fileChooser = await fileChooserPromise;

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const testImgPath = path.join(tmpDir, 'test-family.png');
    const base64Pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(testImgPath, Buffer.from(base64Pixel, 'base64'));

    await fileChooser.setFiles(testImgPath);
    await expect(page.locator('#imagePreview')).toBeVisible();

    // Submit upload
    await page.click('#uploadPhotoBtn');
    await expect(page.locator('#photoModal')).toBeHidden();

    // 9. Wait for stats to reflect photo upload
    await page.waitForFunction(() => {
      const el = document.getElementById('totalPhotos');
      return el && parseInt(el.textContent, 10) > 0;
    });

    // 10. Switch to "All Photos" view & launch Ultra Lightbox
    await page.click('#tabViewAllPhotos');
    await expect(page.locator('.photo-card').first()).toBeVisible();

    await page.click('.photo-card img');
    await expect(page.locator('#viewModal')).toBeVisible();
    await expect(page.locator('#viewerImage')).toBeVisible();
    await expect(page.locator('#viewerTitle')).toHaveText('Family Gathering Panorama');

    // 11. Close Lightbox
    await page.click('#closeViewModal');
    await expect(page.locator('#viewModal')).toBeHidden();

    // 12. Sign Out
    await page.click('#userBadgeBtn');
    await page.click('#logoutBtn');
    await page.waitForURL(/index.html/, { timeout: 10000 });
    await expect(page.locator('#loginForm')).toBeVisible();
  });
});