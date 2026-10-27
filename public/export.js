import { timestampMillis } from './domain.js';
import { makeThumbnail } from './images.js';

let excelPromise;
export function loadExcelJS() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error('The Excel library did not load.'));
      script.onerror = () => { script.remove(); reject(new Error('Could not load Excel export. Check your connection and try again.')); };
      document.head.append(script);
    }).catch(error => { excelPromise = null; throw error; });
  }
  return excelPromise;
}

export async function buildWorkbook({ ExcelJS, items, tags, getPhoto, thumbnail = makeThumbnail, progress = () => {} }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Storage Inventory';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Inventory', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Description', key: 'desc', width: 36 },
    { header: 'Quantity', key: 'qty', width: 14 },
    { header: 'Quantity type', key: 'qtyType', width: 16 },
    { header: 'Tags', key: 'tags', width: 28 },
    { header: 'Location', key: 'location', width: 24 },
    { header: 'Notes', key: 'notes', width: 36 },
    { header: 'Created', key: 'createdAt', width: 23 },
    { header: 'Updated', key: 'updatedAt', width: 23 },
    { header: 'Photo', key: 'photo', width: 22 },
  ];
  const tagNames = new Map(tags.map(tag => [tag.id, tag.name]));
  let omitted = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const date = value => timestampMillis(value) ? new Date(timestampMillis(value)) : null;
    const row = sheet.addRow({
      name: String(item.name), desc: String(item.desc), qty: item.qty,
      qtyType: item.qtyType === 'approx' ? 'Estimate' : 'Exact',
      tags: (item.tagIds ?? []).map(id => tagNames.get(id)).filter(Boolean).join(', '),
      location: String(item.location), notes: String(item.notes),
      createdAt: date(item.createdAt), updatedAt: date(item.updatedAt),
      photo: item.hasPhoto ? '' : 'No photo',
    });
    row.alignment = { vertical: 'middle', wrapText: true };
    row.getCell('createdAt').numFmt = row.getCell('updatedAt').numFmt = 'yyyy-mm-dd hh:mm';
    if (item.hasPhoto) {
      try {
        const data = await getPhoto(item);
        if (!data) throw new Error('Missing photo');
        const image = await thumbnail(data);
        const imageId = workbook.addImage({ base64: image.data, extension: 'jpeg' });
        sheet.addImage(imageId, { tl: { col: 9.1, row: row.number - 0.9 }, ext: { width: image.width, height: image.height }, editAs: 'oneCell' });
        row.height = 100;
      } catch { omitted++; row.getCell('photo').value = 'Photo unavailable'; }
    }
    progress(index + 1, items.length);
    // Let mobile browsers paint progress while constructing large workbooks.
    if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  sheet.autoFilter = { from: 'A1', to: 'J1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };
  sheet.getRow(1).height = 26;
  return { buffer: await workbook.xlsx.writeBuffer(), omitted };
}
