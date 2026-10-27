import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, validateTag, selectItems, summarize } from '../public/domain.js';
import { loadDraft, saveDraft, removeDraft } from '../public/drafts.js';

const raw = { name: ' Goggles ', qty: '0', qtyType: 'exact', desc: '', location: '', notes: '', tagIds: ['used'] };
test('counts require a name and whole nonnegative quantity, including zero', () => {
  assert.equal(validateItem(raw).qty, 0);
  assert.equal(validateItem(raw).name, 'Goggles');
  for (const qty of ['', '-1', '1.5', 'NaN', 'Infinity', '1e3', '1000000001']) assert.throws(() => validateItem({ ...raw, qty }));
  assert.throws(() => validateItem({ ...raw, name: '   ' }));
  assert.throws(() => validateItem({ ...raw, qtyType: 'other' }));
  assert.throws(() => validateItem({ ...raw, tagIds: Array.from({ length: 21 }, (_, n) => `tag-${n}`) }));
});
test('tag validation trims names, rejects duplicates, and allows renaming its own ID', () => {
  const tags = [{ id: 'used', name: 'Used' }];
  assert.throws(() => validateTag(' used ', tags));
  assert.equal(validateTag(' USED ', tags, 'used'), 'USED');
  assert.throws(() => validateTag(' ', tags));
  assert.throws(() => validateTag('x'.repeat(41), tags));
});
test('search combines text and tag names with all selected tags, and sorting is stable', () => {
  const tags = [{ id: 'used', name: 'Used' }, { id: 'broken', name: 'Broken' }];
  const items = [
    { ...validateItem(raw), id: 'b', qty: 10, createdAt: { seconds: 2 } },
    { ...validateItem(raw), id: 'a', name: 'Wrench', qty: 2, tagIds: ['used', 'broken'], createdAt: { seconds: 1 } },
  ];
  assert.deepEqual(selectItems(items, tags, { search: 'BROKEN', tagIds: ['used', 'broken'] }).map(i => i.id), ['a']);
  assert.deepEqual(selectItems(items, tags, { sort: 'qty-low' }).map(i => i.id), ['a', 'b']);
  assert.deepEqual(selectItems(items, tags, { sort: 'oldest' }).map(i => i.id), ['a', 'b']);
  assert.deepEqual(selectItems(items, tags, { sort: 'name' }).map(i => i.id), ['b', 'a']);
  assert.equal(selectItems(items, [{ id: 'used', name: 'Pre-owned' }], { search: 'pre-owned' }).length, 2);
});
test('statistics keep estimated totals separate from exact counts', () => {
  const stats = summarize([{ qty: 0, qtyType: 'exact', tagIds: [], hasPhoto: false }, { qty: 12, qtyType: 'approx', tagIds: ['used'], hasPhoto: true }]);
  assert.equal(stats.count, 2); assert.equal(stats.exact, 0); assert.equal(stats.estimated, 12); assert.equal(stats.photos, 1); assert.equal(stats.tags.get('used'), 1);
});
test('drafts survive reload, tolerate corrupt/blocked storage, and clear explicitly', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const draft = { id: 'draft-id', fields: raw, needsPhoto: true };
  assert.equal(saveDraft('add', draft, storage), true);
  assert.deepEqual(loadDraft('add', storage), draft);
  removeDraft('add', storage); assert.equal(loadDraft('add', storage), null);
  storage.setItem('storage-inventory:v1:add', '{broken'); assert.equal(loadDraft('add', storage), null);
  assert.equal(saveDraft('add', draft, { setItem() { throw new Error('Quota'); } }), false);
});
