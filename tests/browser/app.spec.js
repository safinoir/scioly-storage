import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const base = { desc: '', qty: 1, qtyType: 'exact', location: '', notes: '', tagIds: [], hasPhoto: false, createdAt: { seconds: 1700000000 }, updatedAt: { seconds: 1700000000 } };
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const pageErrors = []; errors.set(page, pageErrors);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/firebase-store.js', route => route.fulfill({ path: 'tests/browser/fake-store.js', contentType: 'text/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', route => route.fulfill({ path: 'node_modules/exceljs/dist/exceljs.min.js', contentType: 'text/javascript' }));
  await page.goto('/');
  await expect(page.locator('#connection')).toHaveText('Connected · Shared inventory');
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

async function newItem(page, name, qty = '0') {
  await page.getByRole('button', { name: '➕ Add item', exact: true }).click();
  const form = page.locator('#add-form-host form');
  await form.locator('[name=name]').fill(name);
  await form.locator('[name=qty]').fill(qty);
  return form;
}
async function jpeg(page, color = '#1a56db') {
  const data = await page.evaluate(color => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1200;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1000, 1200);
    return canvas.toDataURL('image/jpeg');
  }, color);
  return { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data.split(',')[1], 'base64') };
}

test('create, edit, tag globally, filter, and delete an item with a photo', async ({ page }) => {
  const form = await newItem(page, 'Safety goggles', '0');
  await form.getByRole('button', { name: 'Used', exact: true }).click();
  await form.locator('.library-input').setInputFiles(await jpeg(page));
  await expect(form.locator('.photo-status')).toContainText('Ready');
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  const card = page.locator('.inv-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('0 · Exact');
  await expect(card.locator('img')).toBeVisible();
  await page.getByRole('button', { name: '🏷️ Tags', exact: true }).click();
  await page.locator('#new-tag-name').fill('Fragile');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Rename Fragile', exact: true })).toBeVisible();
  await page.locator('#new-tag-name').fill(' used ');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(page.locator('#tag-error')).toContainText('already exists');
  const rename = page.locator('.rename-form').filter({ has: page.getByRole('textbox', { name: 'Rename Used', exact: true }) });
  await rename.locator('input').fill('Pre-owned');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('button', { name: '📋 Inventory', exact: true }).click();
  await page.getByRole('searchbox').fill('pre-owned');
  await expect(card).toHaveCount(1);
  await page.locator('#tag-filters').getByRole('button', { name: 'Broken', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.locator('#edit-form-host form');
  await edit.locator('[name=qty]').fill('12');
  await edit.locator('[name=qtyType]').selectOption('approx');
  await edit.locator('.remove-photo').click();
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
  await expect(card).toContainText('~12 · Estimate');
  await expect(card.locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: '📊 Stats', exact: true }).click();
  await expect(page.locator('#stat-estimated')).toHaveText('~12');
  await page.getByRole('button', { name: '📋 Inventory', exact: true }).click();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.testStore.getPhotos()).length)).toBe(0);
});

test('draft recovery, failed-save retry, and repeated submission use one document ID', async ({ page }) => {
  const form = await newItem(page, 'Recovered text', '3');
  await form.getByRole('button', { name: 'Broken', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '➕ Add item', exact: true }).click();
  await expect(form.locator('[name=name]')).toHaveValue('Recovered text');
  await expect(form.getByRole('button', { name: 'Broken', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.testStore.failSave = true; });
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(form.locator('.form-error')).toContainText('Simulated connection failure');
  await page.evaluate(() => { window.testStore.failSave = false; window.testStore.pauseSave = true; });
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(form.locator('.save-item')).toBeDisabled();
  await form.evaluate(form => { form.dispatchEvent(new Event('submit', { cancelable: true })); });
  await page.evaluate(() => { window.testStore.releaseSave(); });
  await expect(page.locator('.inv-card')).toHaveCount(1);
  const ids = await page.evaluate(() => window.testStore.savedIds);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  expect(await page.evaluate(() => localStorage.getItem('storage-inventory:v1:add'))).toBeNull();
});

test('removing a photo during processing cancels its result; reload requires reselection', async ({ page }) => {
  const form = await newItem(page, 'Photo draft', '1');
  await form.locator('.library-input').setInputFiles(await jpeg(page));
  await form.locator('.remove-photo').click();
  await expect(form.locator('.photo-preview')).not.toBeVisible();
  await form.locator('.library-input').setInputFiles(await jpeg(page, '#cc0000'));
  await expect(form.locator('.photo-status')).toContainText('Ready');
  const compressed = await form.locator('.photo-preview').getAttribute('src');
  expect(compressed.length).toBeLessThanOrEqual(256000);
  expect(await form.locator('.photo-preview').evaluate(image => Math.max(image.naturalWidth, image.naturalHeight))).toBeLessThanOrEqual(800);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: '➕ Add item', exact: true }).click();
  await expect(form.locator('.photo-status')).toContainText('not restored');
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(form.locator('.form-error')).toContainText('Reselect');
  await form.locator('.remove-photo').click();
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(page.locator('.inv-card')).toHaveCount(1);
});

test('500-item mobile inventory loads photos lazily and exports filtered results with real thumbnails', async ({ page }, testInfo) => {
  const fixture = Array.from({ length: 500 }, (_, index) => ({ ...base, id: `item-${String(index).padStart(3, '0')}`, name: index === 0 ? '日本語\n=literal' : `Item ${index}`, qty: index, tagIds: index < 2 ? ['used'] : [], hasPhoto: true }));
  const photo = 'data:image/jpeg;base64,' + (await jpeg(page)).buffer.toString('base64');
  await page.evaluate(({ fixture, photo }) => {
    window.testStore.setPhotos(Object.fromEntries(fixture.filter((_, index) => index !== 1).map(item => [item.id, photo])));
    window.testStore.setItems(fixture);
  }, { fixture, photo });
  await expect(page.locator('.inv-card')).toHaveCount(500);
  await expect(page.locator('.inv-card img').first()).toBeVisible();
  expect(await page.evaluate(() => window.testStore.photoReads.length)).toBeLessThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#tag-filters').getByRole('button', { name: 'Used', exact: true }).click();
  await expect(page.locator('.inv-card')).toHaveCount(2);
  await page.locator('#sort-select').selectOption('qty-high');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  await page.getByRole('button', { name: 'Export current results (2)', exact: true }).click();
  await expect(page.locator('#download-export')).toBeVisible();
  await expect(page.locator('#export-status')).toContainText('1 unavailable photo');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download Excel file', exact: true }).click();
  const download = await downloadEvent;
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(await download.path()));
  const sheet = workbook.getWorksheet('Inventory');
  expect(sheet.rowCount).toBe(3); expect(sheet.getCell('A2').value).toBe('Item 1');
  expect(sheet.getCell('A3').value).toBe('日本語\n=literal'); expect(sheet.getImages()).toHaveLength(1);
  await page.getByRole('button', { name: 'Close export', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('mobile-inventory.png'), fullPage: true });
});

test('edit drafts resume after reload and modal closes with visible control and keyboard', async ({ page }) => {
  await page.evaluate(base => window.testStore.setItems([{ ...base, id: 'edit-me', name: 'Original' }]), base);
  await page.locator('.inv-card').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#edit-form-host [name=name]').fill('Unsaved edit');
  await page.getByRole('button', { name: 'Close edit item', exact: true }).click();
  await expect(page.locator('#edit-draft-notice')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#edit-form-host [name=name]')).toHaveValue('Unsaved edit');
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
});

test('invalid quantities do not save, and offline entry keeps a recoverable text draft', async ({ page, context }) => {
  const form = await newItem(page, 'Offline draft', '-1');
  for (const qty of ['-1', '1.5', '']) {
    await form.locator('[name=qty]').fill(qty);
    await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
    expect(await form.locator('[name=qty]').evaluate(input => input.validity.valid)).toBe(false);
  }
  expect(await page.evaluate(() => window.testStore.savedIds)).toHaveLength(0);
  await context.setOffline(true);
  await form.locator('[name=qty]').fill('7');
  await expect(page.locator('#connection')).toContainText('Offline');
  await expect(form.locator('.save-item')).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('storage-inventory:v1:add')).fields.qty)).toBe('7');
  await context.setOffline(false);
  await expect(form.locator('.save-item')).toBeEnabled();
  await form.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(page.locator('.inv-card')).toContainText('7 · Exact');
});

test('blocked draft storage displays a notice while the form remains usable', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  const form = await newItem(page, 'Storage unavailable', '1');
  await expect(form.locator('.draft-status')).toContainText('could not save your draft locally');
  await expect(form.locator('.save-item')).toBeEnabled();
});

test('unconfigured app shows setup instructions and has no password screen', async ({ page }) => {
  await page.unroute('**/firebase-store.js');
  await page.route('**/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: "export const firebaseConfig = { apiKey: 'YOUR_API_KEY', authDomain: 'YOUR_PROJECT.firebaseapp.com', projectId: 'YOUR_PROJECT_ID', appId: 'YOUR_APP_ID' }; export const firestoreEmulator = null;",
  }));
  await page.reload();
  await expect(page.locator('#setup-error')).toContainText('firebase-config.js');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.getByRole('button', { name: '➕ Add item', exact: true }).click();
  await expect(page.locator('#add-form-host .save-item')).toBeDisabled();
});

test('delete can be canceled or confirmed from the edit screen and clears its draft and photo', async ({ page }) => {
  const photo = 'data:image/jpeg;base64,' + (await jpeg(page)).buffer.toString('base64');
  await page.evaluate(({ base, photo }) => {
    window.testStore.setPhotos({ remove: photo });
    window.testStore.setItems([{ ...base, id: 'remove', name: 'Remove this entry', hasPhoto: true }, { ...base, id: 'keep', name: 'Keep this entry' }]);
  }, { base, photo });
  const card = page.locator('.inv-card').filter({ hasText: 'Remove this entry' });
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#delete-message')).toContainText('Remove this entry');
  await expect(page.locator('#delete-message')).toContainText('and its photo');
  await page.locator('#cancel-delete').click();
  await expect(card).toHaveCount(1);
  expect(await page.evaluate(() => window.testStore.deleteIds)).toHaveLength(0);
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#edit-form-host [name=name]').fill('Unsaved change');
  await page.locator('#edit-form-host .delete-item').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#delete-dialog')).not.toBeVisible();
  await expect(page.locator('#edit-form-host [name=name]')).toHaveValue('Unsaved change');
  await page.locator('#edit-form-host .delete-item').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#delete-dialog')).not.toBeVisible();
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.inv-card')).toHaveCount(1);
  await expect(page.locator('#header-count')).toHaveText('1 item');
  await expect(page.locator('#edit-draft-notice')).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('storage-inventory:v1:edit'))).toBeNull();
  expect(await page.evaluate(() => window.testStore.getPhotos())).toEqual({});
});

test('failed deletion can be retried and repeated confirmation submits only once', async ({ page }) => {
  await page.evaluate(base => {
    window.testStore.setItems([{ ...base, id: 'retry-delete', name: 'Retry delete' }]);
    window.testStore.failDelete = true;
  }, base);
  await page.locator('.inv-card').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#delete-error')).toContainText('Simulated deletion failure');
  await expect(page.locator('.inv-card')).toHaveCount(1);
  await page.evaluate(() => { window.testStore.failDelete = false; window.testStore.pauseDelete = true; });
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#confirm-delete')).toBeDisabled();
  await expect(page.locator('#cancel-delete')).toBeDisabled();
  await page.locator('#confirm-delete').dispatchEvent('click');
  await page.keyboard.press('Escape');
  await expect(page.locator('#delete-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.testStore.deleteIds)).toEqual(['retry-delete', 'retry-delete']);
  await page.evaluate(() => window.testStore.releaseDelete());
  await expect(page.locator('#delete-dialog')).not.toBeVisible();
  await expect(page.locator('.inv-card')).toHaveCount(0);
});

test('offline deletion stays disabled and preserves the entry', async ({ page, context }) => {
  await page.evaluate(base => window.testStore.setItems([{ ...base, id: 'offline-delete', name: 'Keep while offline' }]), base);
  await context.setOffline(true);
  await page.locator('.inv-card').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#confirm-delete')).toBeDisabled();
  await expect(page.locator('#delete-error')).toContainText('Reconnect');
  await page.locator('#cancel-delete').click();
  await expect(page.locator('.inv-card')).toHaveCount(1);
  expect(await page.evaluate(() => window.testStore.deleteIds)).toHaveLength(0);
});
