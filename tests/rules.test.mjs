import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, collection, getDocs } from 'firebase/firestore';

let environment, db;
const item = overrides => ({ name: 'Goggles', desc: '', qty: 0, qtyType: 'exact', location: '', notes: '', tagIds: [], hasPhoto: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides });
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-storage-inventory', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  db = environment.unauthenticatedContext().firestore();
});
beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

test('unauthenticated users can create, read, edit, list and delete inventory', async () => {
  const ref = doc(db, 'inventory', 'item');
  await assertSucceeds(setDoc(ref, item()));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(db, 'inventory')));
  await assertSucceeds(updateDoc(ref, { qty: 12, qtyType: 'approx', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(ref));
});
test('invalid fields and quantities are rejected', async () => {
  for (const invalid of [{ qty: -1 }, { qty: 1.5 }, { qty: '2' }, { qty: 1000000001 }, { name: '' }, { name: '   ' }, { qtyType: 'unknown' }, { extra: true }, { desc: 'x'.repeat(2001) }, { tagIds: ['x', 'x'] }, { tagIds: [123] }]) {
    await assertFails(setDoc(doc(db, 'inventory', 'invalid'), item(invalid)));
  }
});
test('tags support global renaming and reject blank, oversized, or unknown fields', async () => {
  const ref = doc(db, 'tags', 'stable-id');
  await assertSucceeds(setDoc(ref, { name: 'Used' }));
  await assertSucceeds(setDoc(ref, { name: 'Pre-owned' }));
  for (const invalid of [{ name: '' }, { name: ' ' }, { name: 'x'.repeat(41) }, { name: 'Used', extra: true }]) await assertFails(setDoc(ref, invalid));
  await assertFails(deleteDoc(ref));
});
test('item and JPEG photo save atomically; orphan, invalid, and oversized photos fail', async () => {
  const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
  const batch = writeBatch(db);
  batch.set(doc(db, 'inventory', 'photo-item'), item({ hasPhoto: true }));
  batch.set(doc(db, 'photos', 'photo-item'), { photoB64: jpeg });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(db, 'photos', 'photo-item')));
  await assertFails(setDoc(doc(db, 'photos', 'orphan'), { photoB64: jpeg }));
  await assertFails(setDoc(doc(db, 'photos', 'photo-item'), { photoB64: 'https://example.com/photo.jpg' }));
  await assertFails(setDoc(doc(db, 'photos', 'photo-item'), { photoB64: 'data:image/jpeg;base64,' + 'A'.repeat(256001) }));
  const remove = writeBatch(db);
  remove.delete(doc(db, 'photos', 'photo-item')); remove.delete(doc(db, 'inventory', 'photo-item'));
  await assertSucceeds(remove.commit());
});
test('password config and arbitrary collections are inaccessible', async () => {
  await assertFails(getDoc(doc(db, 'config', 'auth')));
  await assertFails(setDoc(doc(db, 'arbitrary', 'doc'), { value: true }));
});
