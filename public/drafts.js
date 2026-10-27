const PREFIX = 'storage-inventory:v1:';

export function loadDraft(key, storage) {
  try {
    storage ??= globalThis.localStorage;
    const draft = JSON.parse(storage.getItem(PREFIX + key));
    return draft && typeof draft === 'object' && typeof draft.id === 'string' && draft.fields && typeof draft.fields === 'object' ? draft : null;
  } catch { return null; }
}

export function saveDraft(key, value, storage) {
  try { (storage ?? globalThis.localStorage).setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function removeDraft(key, storage) {
  try { (storage ?? globalThis.localStorage).removeItem(PREFIX + key); } catch { /* Storage may be blocked by browser settings. */ }
}
