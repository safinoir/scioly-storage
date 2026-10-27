import { test, expect } from '@playwright/test';

test('real Firebase browser adapter seeds tags, saves photos atomically, renames tags, and deletes records', async ({ page, request }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST, 'Run with npm run test:integration.');
  const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-storage-inventory/databases/(default)/documents`;
  expect((await request.delete(endpoint)).ok()).toBe(true);
  const pageErrors = [];
  page.on('pageerror', error => {
    // WebKit reports canceled cross-origin emulator XHRs as page errors on reload.
    // Keep checking application exceptions and verify committed writes below.
    if (error.message.includes('/127.0.0.1:8080/google.firestore.v1.Firestore/') && error.message.endsWith('due to access control checks.')) return;
    pageErrors.push(error.message);
  });
  await page.route('**/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const firebaseConfig = { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-storage-inventory', appId: 'demo-app' }; export const firestoreEmulator = { host: '127.0.0.1', port: 8080 };`,
  }));
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Connected · Shared inventory', { timeout: 20000 });
  await expect(page.locator('#tag-filters .chip')).toHaveCount(4);
  await page.getByRole('button', { name: '➕ Add item', exact: true }).click();
  const form = page.locator('#add-form-host form');
  await form.locator('[name=name]').fill('Real Firebase item');
  await form.locator('[name=qty]').fill('0');
  await form.getByRole('button', { name: 'Used', exact: true }).click();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await form.locator('.library-input').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64') });
  await expect(form.locator('.photo-status')).toContainText('Ready');
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(page.locator('#tab-list')).toBeVisible();
  await expect(page.locator('.inv-card img')).toBeVisible();
  await page.reload();
  await expect(page.locator('.inv-card')).toHaveCount(1);
  await page.getByRole('button', { name: '🏷️ Tags', exact: true }).click();
  const rename = page.locator('.rename-form').filter({ has: page.getByRole('textbox', { name: 'Rename Used', exact: true }) });
  await rename.locator('input').fill('Pre-owned');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Rename Pre-owned', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '📋 Inventory', exact: true }).click();
  await expect(page.locator('.inv-card')).toContainText('Pre-owned');
  await page.locator('.inv-card').getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.locator('#edit-form-host form');
  await edit.locator('[name=qty]').fill('8');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
  await expect(page.locator('.inv-card')).toContainText('8 · Exact');
  await page.reload();
  await expect(page.locator('.inv-card img')).toBeVisible();
  await page.locator('.inv-card').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('.inv-card')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('Item deleted.');
  const data = await request.get(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-storage-inventory/databases/(default)/documents/photos`);
  expect((await data.json()).documents ?? []).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});
