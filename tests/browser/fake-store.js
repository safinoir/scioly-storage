// Served only by Playwright's module route. This file is never hosted with the app.
export async function createStore() {
  let items = JSON.parse(localStorage.getItem('test:items') ?? '[]');
  let photos = JSON.parse(localStorage.getItem('test:photos') ?? '{}');
  let tags = JSON.parse(localStorage.getItem('test:tags') ?? '[{"id":"used","name":"Used"},{"id":"broken","name":"Broken"},{"id":"permanent","name":"Permanent"},{"id":"disposable","name":"Disposable"}]');
  let callbacks;
  const emit = () => {
    localStorage.setItem('test:items', JSON.stringify(items));
    localStorage.setItem('test:tags', JSON.stringify(tags));
    const photoData = JSON.stringify(photos);
    if (photoData.length < 1_000_000) localStorage.setItem('test:photos', photoData);
    else localStorage.removeItem('test:photos');
    callbacks?.inventory(items, { fromCache: false });
    callbacks?.tags(tags, { fromCache: false });
  };
  const control = window.testStore = {
    failSave: false, pauseSave: false, savedIds: [], photoReads: [],
    failDelete: false, pauseDelete: false, deleteIds: [],
    setItems(value) { items = value; emit(); },
    setPhotos(value) { photos = value; emit(); },
    getItems() { return items; }, getPhotos() { return photos; },
  };
  return {
    subscribe(value) { callbacks = value; emit(); return () => {}; },
    async seedTags() {},
    async saveTag(id, name) {
      tags = [...tags.filter(tag => tag.id !== id), { id, name }]; emit();
    },
    async saveItem(id, fields, photo, existing) {
      control.savedIds.push(id);
      if (control.pauseSave) await new Promise(resolve => { control.releaseSave = resolve; });
      if (control.failSave) throw new Error('Simulated connection failure');
      const old = items.find(item => item.id === id);
      if (existing && !old) throw new Error('Item no longer exists');
      const timestamp = { seconds: Math.floor(Date.now() / 1000) };
      items = [...items.filter(item => item.id !== id), { ...fields, hasPhoto: existing && photo.action === 'keep' ? old.hasPhoto : fields.hasPhoto, id, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp }];
      if (photo.action === 'set') photos[id] = photo.data;
      if (photo.action === 'remove') delete photos[id];
      emit();
    },
    async deleteItem(id) {
      control.deleteIds.push(id);
      if (control.pauseDelete) await new Promise(resolve => { control.releaseDelete = resolve; });
      if (control.failDelete) throw new Error('Simulated deletion failure');
      items = items.filter(item => item.id !== id); delete photos[id]; emit();
    },
    async getPhoto(id) { control.photoReads.push(id); return photos[id] ?? null; },
  };
}
