import { firebaseConfig, firestoreEmulator } from './firebase-config.js';
import { DEFAULT_TAGS, LIMITS } from './domain.js';

export async function createStore() {
  if (Object.values(firebaseConfig).some(value => !value || String(value).startsWith('YOUR_'))) {
    throw new Error('Add your Firebase Web App configuration to firebase-config.js, then reload. See the README for setup steps.');
  }
  const [{ initializeApp }, sdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js'),
  ]);
  const db = sdk.initializeFirestore(initializeApp(firebaseConfig), { localCache: sdk.memoryLocalCache() });
  if (firestoreEmulator && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    sdk.connectFirestoreEmulator(db, firestoreEmulator.host, firestoreEmulator.port);
  }
  const ref = (collection, id) => sdk.doc(db, collection, id);
  return {
    subscribe(callbacks) {
      const stops = ['inventory', 'tags'].map(collection => sdk.onSnapshot(
        sdk.collection(db, collection), { includeMetadataChanges: true },
        snapshot => callbacks[collection](snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })), { fromCache: snapshot.metadata.fromCache }),
        callbacks.error,
      ));
      return () => stops.forEach(stop => stop());
    },
    async seedTags() {
      await sdk.runTransaction(db, async transaction => {
        const refs = DEFAULT_TAGS.map(name => ref('tags', `default-${name.toLowerCase()}`));
        const snapshots = await Promise.all(refs.map(tag => transaction.get(tag)));
        snapshots.forEach((snapshot, index) => {
          if (!snapshot.exists()) transaction.set(refs[index], { name: DEFAULT_TAGS[index] });
        });
      });
    },
    async saveItem(id, fields, photo, existing) {
      const batch = sdk.writeBatch(db);
      const itemRef = ref('inventory', id);
      const data = { ...fields, updatedAt: sdk.serverTimestamp() };
      // A text-only edit must preserve even a photo changed by another open device.
      if (existing && photo.action === 'keep') delete data.hasPhoto;
      if (existing) batch.update(itemRef, data);
      else {
        // An acknowledged write whose response was lost can safely be retried with its draft ID.
        const snapshot = await sdk.getDocFromServer(itemRef);
        batch.set(itemRef, { ...data, createdAt: snapshot.exists() ? snapshot.data().createdAt : sdk.serverTimestamp() });
      }
      if (photo.action === 'set') {
        if (photo.data.length > LIMITS.photo) throw new Error('Photo exceeds the size limit.');
        batch.set(ref('photos', id), { photoB64: photo.data });
      } else if (photo.action === 'remove') batch.delete(ref('photos', id));
      await batch.commit();
    },
    async deleteItem(id) {
      const batch = sdk.writeBatch(db);
      batch.delete(ref('inventory', id));
      batch.delete(ref('photos', id));
      await batch.commit();
    },
    async getPhoto(id) {
      const snapshot = await sdk.getDocFromServer(ref('photos', id));
      return snapshot.exists() ? snapshot.data().photoB64 : null;
    },
    async saveTag(id, name) { await sdk.setDoc(ref('tags', id), { name }); },
  };
}
