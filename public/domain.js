export const LIMITS = Object.freeze({ name: 120, desc: 2000, location: 200, notes: 2000, tags: 20, tagName: 40, qty: 1_000_000_000, photo: 250 * 1024 });
export const DEFAULT_TAGS = ['Disposable', 'Permanent', 'Broken', 'Used'];

export function normalizeTag(name) {
  return String(name ?? '').trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export function validateTag(name, tags, exceptId) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || trimmed.length > LIMITS.tagName) throw new Error('Use a tag name between 1 and 40 characters.');
  if (tags.some(tag => tag.id !== exceptId && normalizeTag(tag.name) === normalizeTag(trimmed))) throw new Error('That tag already exists.');
  return trimmed;
}

export function validateItem(raw) {
  const item = {};
  for (const field of ['name', 'desc', 'location', 'notes']) {
    item[field] = String(raw[field] ?? '').trim();
    if (item[field].length > LIMITS[field]) throw new Error(`${field === 'desc' ? 'Description' : field} is too long.`);
  }
  if (!item.name) throw new Error('Enter an item name.');
  const quantity = String(raw.qty ?? '').trim();
  if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) > LIMITS.qty) {
    throw new Error('Enter a whole-number quantity from 0 to 1,000,000,000.');
  }
  item.qty = Number(quantity);
  if (!['exact', 'approx'].includes(raw.qtyType)) throw new Error('Choose Exact or Estimate.');
  item.qtyType = raw.qtyType;
  item.tagIds = [...new Set(Array.isArray(raw.tagIds) ? raw.tagIds : [])];
  if (item.tagIds.length > LIMITS.tags || item.tagIds.some(id => typeof id !== 'string' || !id || id.length > 128 || id.includes('/'))) throw new Error('Choose at most 20 tags.');
  return item;
}

export function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return value?.seconds ? value.seconds * 1000 : 0;
}

export function selectItems(items, tags, { search = '', tagIds = [], sort = 'newest' } = {}) {
  const names = new Map(tags.map(tag => [tag.id, tag.name]));
  const query = search.trim().toLocaleLowerCase();
  return items.filter(item => {
    const text = [item.name, item.desc, item.location, item.notes, ...(item.tagIds ?? []).map(id => names.get(id))].filter(Boolean).join(' ').toLocaleLowerCase();
    return text.includes(query) && tagIds.every(id => (item.tagIds ?? []).includes(id));
  }).sort((a, b) => {
    let result;
    if (sort === 'name') result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    else if (sort === 'qty-high') result = b.qty - a.qty;
    else if (sort === 'qty-low') result = a.qty - b.qty;
    else if (sort === 'oldest') result = timestampMillis(a.createdAt) - timestampMillis(b.createdAt);
    else result = timestampMillis(b.createdAt) - timestampMillis(a.createdAt);
    return result || a.id.localeCompare(b.id);
  });
}

export function summarize(items) {
  return items.reduce((stats, item) => {
    stats.count++;
    stats[item.qtyType === 'approx' ? 'estimated' : 'exact'] += item.qty;
    if (item.hasPhoto) stats.photos++;
    for (const id of item.tagIds ?? []) stats.tags.set(id, (stats.tags.get(id) ?? 0) + 1);
    return stats;
  }, { count: 0, exact: 0, estimated: 0, photos: 0, tags: new Map() });
}
