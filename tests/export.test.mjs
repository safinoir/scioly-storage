import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../public/export.js';

test('Excel round-trip preserves literal strings, numeric zero, tags, dates, thumbnails, and omissions', async () => {
  const base = { qty: 0, qtyType: 'exact', desc: 'First line\nSecond line', notes: '日本語 📦', location: 'Shelf 2', tagIds: ['used'], createdAt: { seconds: 1700000000 }, updatedAt: { seconds: 1700000010 }, hasPhoto: true };
  const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
  const progress = [];
  const { buffer, omitted } = await buildWorkbook({
    ExcelJS, items: [{ ...base, id: 'photo', name: '=1+1' }, { ...base, id: 'missing', name: 'Missing', qtyType: 'approx' }], tags: [{ id: 'used', name: 'Pre-owned' }],
    getPhoto: async item => item.id === 'photo' ? jpeg : null,
    thumbnail: async data => ({ data, width: 120, height: 80 }),
    progress: value => progress.push(value),
  });
  const parsed = new ExcelJS.Workbook(); await parsed.xlsx.load(buffer);
  const sheet = parsed.getWorksheet('Inventory');
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell('A2').value, '=1+1'); assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B2').value, base.desc); assert.equal(sheet.getCell('C2').value, 0);
  assert.equal(sheet.getCell('D3').value, 'Estimate'); assert.equal(sheet.getCell('E2').value, 'Pre-owned');
  assert.equal(sheet.getCell('G2').value, base.notes); assert.ok(sheet.getCell('H2').value instanceof Date);
  assert.equal(sheet.getCell('J3').value, 'Photo unavailable'); assert.equal(omitted, 1);
  assert.equal(sheet.getImages().length, 1); assert.equal(sheet.views[0].ySplit, 1); assert.ok(sheet.autoFilter);
  assert.deepEqual(progress, [1, 2]);
});
