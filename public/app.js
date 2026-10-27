import { createStore } from './firebase-store.js';
import { LIMITS, validateItem, validateTag, selectItems, summarize, timestampMillis } from './domain.js';
import { loadDraft, saveDraft, removeDraft } from './drafts.js';
import { compressPhoto } from './images.js';
import { loadExcelJS, buildWorkbook } from './export.js';

const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const state = { store: null, items: [], tags: [], loaded: { inventory: false, tags: false }, connected: { inventory: false, tags: false }, filters: new Set(), error: null, exportBusy: false };
const photoCache = new Map();
let editController, exportUrl, toastTimer;
let deleteTarget = null;

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = 'toast' + (error ? ' error' : '');
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 7000 : 4000);
}

function onlineReady() {
  return Boolean(state.store && state.connected.inventory && state.connected.tags && !state.error && navigator.onLine);
}

function updateConnection() {
  const connection = $('#connection');
  connection.classList.toggle('problem', !onlineReady());
  if (!navigator.onLine) connection.textContent = 'Offline — your form text is kept on this device. Reconnect to save.';
  else if (state.error) connection.textContent = state.error;
  else if (!onlineReady()) connection.textContent = 'Connecting to inventory…';
  else connection.textContent = 'Connected · Shared inventory';
  addController.updateButtons();
  editController?.updateButtons();
  $('#open-export').disabled = !onlineReady();
  updateDeleteButtons();
  for (const button of document.querySelectorAll('#create-tag-form button, .rename-form button')) button.disabled = !onlineReady() || button.dataset.busy === 'true';
}

function switchTab(name) {
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== 'tab-' + name;
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (name === 'add') addController.form.elements.name.focus({ preventScroll: true });
}

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => switchTab(button.dataset.tab));
for (const event of ['online', 'offline']) window.addEventListener(event, updateConnection);

function chip(tag, selected, click) {
  const button = el('button', 'chip', tag.name);
  button.type = 'button';
  button.dataset.tagId = tag.id;
  button.setAttribute('aria-label', tag.name);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', click);
  return button;
}

function currentItems(all = false) {
  return selectItems(state.items, state.tags, { search: all ? '' : $('#search-input').value, tagIds: all ? [] : [...state.filters], sort: $('#sort-select').value });
}

function getPhoto(item, cache = true) {
  const key = item.id + ':' + timestampMillis(item.updatedAt);
  if (photoCache.has(key)) return photoCache.get(key);
  const promise = state.store.getPhoto(item.id).then(data => {
    if (!data || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > LIMITS.photo) throw new Error('Photo is unavailable.');
    return data;
  }).catch(error => { photoCache.delete(key); throw error; });
  if (cache) {
    photoCache.set(key, promise);
    if (photoCache.size > 64) photoCache.delete(photoCache.keys().next().value);
  }
  return promise;
}

const photoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    photoObserver.unobserve(entry.target);
    const item = state.items.find(item => item.id === entry.target.dataset.itemId);
    if (item) showCardPhoto(entry.target, item);
  }
}, { rootMargin: '150px' });

async function showCardPhoto(container, item) {
  container.replaceChildren(el('span', '', 'Loading photo…'));
  try {
    const data = await getPhoto(item);
    if (!container.isConnected) return;
    const image = el('img', 'inv-photo');
    image.alt = item.name;
    image.src = data;
    container.className = '';
    container.replaceChildren(image);
  } catch {
    if (!container.isConnected) return;
    const retry = el('button', 'text-button', 'Retry photo');
    retry.type = 'button';
    retry.addEventListener('click', () => showCardPhoto(container, item));
    container.replaceChildren(el('span', '', 'Photo unavailable'), retry);
  }
}

function renderList() {
  photoObserver.disconnect();
  const container = $('#inventory-list');
  container.replaceChildren();
  const items = currentItems();
  $('#results-count').textContent = `${items.length} of ${state.items.length} items`;
  if (!items.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('p', '', !state.loaded.inventory ? 'Waiting for inventory…' : state.items.length ? 'No items match your search and tags.' : 'Your inventory starts here.'));
    if (state.loaded.inventory && !state.items.length) {
      const add = el('button', 'btn primary', 'Add your first item');
      add.type = 'button';
      add.addEventListener('click', () => switchTab('add'));
      empty.append(add);
    }
    container.append(empty);
    return;
  }
  const tagNames = new Map(state.tags.map(tag => [tag.id, tag.name]));
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = el('article', 'inv-card');
    if (item.hasPhoto) {
      const photo = el('div', 'photo-fallback', 'Photo');
      photo.dataset.itemId = item.id;
      card.append(photo);
      photoObserver.observe(photo);
    }
    const body = el('div', 'inv-card-body');
    body.append(el('h3', 'inv-card-title', item.name));
    const meta = el('div', 'inv-card-meta');
    meta.append(el('span', 'badge quantity', `${item.qtyType === 'approx' ? '~' : ''}${item.qty.toLocaleString()} · ${item.qtyType === 'approx' ? 'Estimate' : 'Exact'}`));
    for (const id of item.tagIds) if (tagNames.has(id)) meta.append(el('span', 'badge', tagNames.get(id)));
    if (item.location) meta.append(el('span', 'badge', '📍 ' + item.location));
    body.append(meta);
    if (item.desc) body.append(el('p', 'item-text', item.desc));
    if (item.notes) body.append(el('p', 'item-notes', item.notes));
    const created = timestampMillis(item.createdAt);
    if (created) body.append(el('p', 'item-date', 'Added ' + new Date(created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })));
    const actions = el('div', 'inv-card-actions');
    const edit = el('button', 'btn secondary', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openEdit(item.id));
    const remove = el('button', 'btn danger', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', () => openDelete(item.id));
    actions.append(edit, remove);
    body.append(actions);
    card.append(body);
    fragment.append(card);
  }
  container.append(fragment);
}

function updateDeleteButtons() {
  const busy = Boolean(deleteTarget?.busy);
  $('#confirm-delete').disabled = !deleteTarget || busy || !onlineReady();
  $('#confirm-delete').textContent = busy ? 'Deleting…' : 'Delete entry';
  $('#cancel-delete').disabled = $('#close-delete').disabled = busy;
  const offlineMessage = 'Reconnect before deleting this entry.';
  if (deleteTarget && !busy && !onlineReady()) $('#delete-error').textContent = offlineMessage;
  else if ($('#delete-error').textContent === offlineMessage) $('#delete-error').textContent = '';
}

function openDelete(id) {
  if (deleteTarget?.busy || (editController?.saving && !editController.cancelled)) return;
  const item = state.items.find(item => item.id === id);
  if (!item) { toast('This entry is no longer available.', true); return; }
  deleteTarget = { id, busy: false };
  $('#delete-message').textContent = `Permanently delete “${item.name}”${item.hasPhoto ? ' and its photo' : ''}? This cannot be undone.`;
  $('#delete-error').textContent = '';
  $('#delete-status').textContent = '';
  updateDeleteButtons();
  $('#delete-dialog').showModal();
}

function closeDelete() {
  if (deleteTarget?.busy) return;
  $('#delete-dialog').close();
  deleteTarget = null;
}

$('#cancel-delete').addEventListener('click', closeDelete);
$('#close-delete').addEventListener('click', closeDelete);
$('#delete-dialog').addEventListener('cancel', event => {
  if (deleteTarget?.busy) event.preventDefault();
});
$('#delete-dialog').addEventListener('close', () => { if (!deleteTarget?.busy) deleteTarget = null; });
$('#confirm-delete').addEventListener('click', async () => {
  if (!deleteTarget || deleteTarget.busy || !onlineReady()) return;
  const target = deleteTarget;
  target.busy = true;
  $('#delete-error').textContent = '';
  $('#delete-status').textContent = 'Deleting entry…';
  updateDeleteButtons();
  try {
    await state.store.deleteItem(target.id);
    if (loadDraft('edit')?.id === target.id) removeDraft('edit');
    if (editController?.id === target.id) {
      editController.dispose();
      editController = null;
      $('#edit-dialog').close();
    }
    for (const key of photoCache.keys()) if (key.startsWith(target.id + ':')) photoCache.delete(key);
    target.busy = false;
    closeDelete();
    updateEditNotice();
    toast('Item deleted.');
  } catch (error) {
    target.busy = false;
    $('#delete-status').textContent = '';
    $('#delete-error').textContent = 'Delete failed: ' + error.message + ' Try again.';
    updateDeleteButtons();
  }
});

function renderFilters() {
  const filters = $('#tag-filters');
  const focusedTag = filters.contains(document.activeElement) ? document.activeElement.dataset.tagId : null;
  filters.replaceChildren();
  for (const tag of state.tags) filters.append(chip(tag, state.filters.has(tag.id), () => {
    state.filters.has(tag.id) ? state.filters.delete(tag.id) : state.filters.add(tag.id);
    renderFilters(); renderList();
  }));
  if (!state.tags.length) filters.append(el('span', 'muted small', state.loaded.tags ? 'Create tags in the Tags tab.' : 'Loading tags…'));
  if (focusedTag) [...filters.children].find(button => button.dataset.tagId === focusedTag)?.focus({ preventScroll: true });
}

function renderStats() {
  const stats = summarize(state.items);
  $('#header-count').textContent = stats.count + (stats.count === 1 ? ' item' : ' items');
  $('#stat-total').textContent = stats.count.toLocaleString();
  $('#stat-photos').textContent = stats.photos.toLocaleString();
  $('#stat-exact').textContent = stats.exact.toLocaleString();
  $('#stat-estimated').textContent = '~' + stats.estimated.toLocaleString();
  const breakdown = $('#tag-breakdown');
  breakdown.replaceChildren();
  for (const tag of state.tags) {
    const row = el('div', 'breakdown-row');
    row.append(el('span', '', tag.name), el('span', 'badge', String(stats.tags.get(tag.id) ?? 0)));
    breakdown.append(row);
  }
  if (!state.tags.length) breakdown.append(el('p', 'muted', 'No tags yet.'));
}

function renderTagManager() {
  const manager = $('#tag-manager');
  manager.replaceChildren();
  for (const tag of state.tags) {
    const form = el('form', 'rename-form');
    const label = el('label', '', 'Tag name');
    const input = el('input');
    input.name = 'name'; input.value = tag.name; input.required = true; input.maxLength = LIMITS.tagName;
    input.setAttribute('aria-label', `Rename ${tag.name}`);
    const button = el('button', 'btn secondary', 'Rename');
    button.type = 'submit'; button.disabled = !onlineReady();
    label.append(input); form.append(label, button);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      $('#tag-error').textContent = '';
      if (!onlineReady() || button.dataset.busy === 'true') return;
      try {
        const name = validateTag(input.value, state.tags, tag.id);
        button.dataset.busy = 'true'; button.disabled = true;
        await state.store.saveTag(tag.id, name);
        toast('Tag updated everywhere.');
      } catch (error) { $('#tag-error').textContent = error.message; }
      finally { button.dataset.busy = 'false'; button.disabled = !onlineReady(); }
    });
    manager.append(form);
  }
}

$('#create-tag-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  if (!onlineReady() || button.dataset.busy === 'true') return;
  $('#tag-error').textContent = '';
  try {
    const name = validateTag($('#new-tag-name').value, state.tags);
    button.dataset.busy = 'true'; button.disabled = true;
    await state.store.saveTag(crypto.randomUUID(), name);
    $('#new-tag-name').value = '';
    toast('Tag created.');
  } catch (error) { $('#tag-error').textContent = error.message; }
  finally { button.dataset.busy = 'false'; button.disabled = !onlineReady(); }
});

class ItemForm {
  constructor(host, item = null, draft = null) {
    this.item = item;
    this.key = item ? 'edit' : 'add';
    this.id = item?.id ?? draft?.id ?? crypto.randomUUID();
    this.tags = new Set(draft?.fields?.tagIds ?? item?.tagIds ?? []);
    this.photo = { action: 'keep' };
    this.photoToken = 0;
    this.processing = false;
    this.saving = false;
    this.dirty = Boolean(draft);
    this.needsPhoto = Boolean(draft?.needsPhoto);
    this.cancelled = false;
    this.form = $('#item-form-template').content.firstElementChild.cloneNode(true);
    host.replaceChildren(this.form);
    const values = draft?.fields ?? item ?? {};
    for (const field of ['name', 'qty', 'desc', 'location', 'notes', 'qtyType']) this.form.elements[field].value = values[field] ?? (field === 'qtyType' ? 'exact' : '');
    if (draft?.photoAction === 'remove') this.photo = { action: 'remove' };
    this.form.querySelector('.save-item').textContent = item ? 'Save changes' : 'Add to inventory';
    if (draft) this.form.querySelector('.draft-status').textContent = 'Unsaved text and tags restored from this device.';
    if (this.needsPhoto) {
      this.form.querySelector('.photo-status').textContent = 'Photos are not restored after a reload. Reselect your photo or remove it before saving.';
      this.form.querySelector('.remove-photo').hidden = false;
    } else if (item?.hasPhoto && this.photo.action !== 'remove') this.loadExistingPhoto();
    this.form.addEventListener('input', event => {
      if (event.target.type !== 'file') { this.dirty = true; this.persist(); }
    });
    this.form.addEventListener('change', event => {
      if (event.target.type === 'file') this.selectPhoto(event.target.files[0]);
    });
    this.form.querySelector('.remove-photo').addEventListener('click', () => this.removePhoto());
    const deleteButton = this.form.querySelector('.delete-item');
    deleteButton.hidden = !item;
    deleteButton.addEventListener('click', () => openDelete(this.id));
    this.form.querySelector('.discard-draft').addEventListener('click', () => {
      if (this.saving) return;
      if ((this.dirty || this.item) && !confirm('Discard this unsaved draft?')) return;
      this.dispose(); removeDraft(this.key);
      if (this.item) { $('#edit-dialog').close(); updateEditNotice(); }
      else resetAdd();
    });
    this.form.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    this.renderTags();
    this.updateButtons();
  }

  fields() {
    const fields = {};
    for (const field of ['name', 'qty', 'qtyType', 'desc', 'location', 'notes']) fields[field] = this.form.elements[field].value;
    fields.tagIds = [...this.tags];
    return fields;
  }

  persist() {
    if (!this.dirty || this.cancelled) return;
    const saved = saveDraft(this.key, { id: this.id, fields: this.fields(), needsPhoto: this.needsPhoto || this.photo.action === 'set' || this.processing, photoAction: this.photo.action === 'remove' ? 'remove' : 'keep' });
    this.form.querySelector('.draft-status').textContent = saved ? 'Draft text and tags saved on this device. Photos need reselecting after a reload.' : 'This browser could not save your draft locally. Keep this page open until you save.';
    updateEditNotice();
  }

  renderTags() {
    const container = this.form.querySelector('.form-tags');
    const focusedTag = container.contains(document.activeElement) ? document.activeElement.dataset.tagId : null;
    container.replaceChildren();
    for (const tag of state.tags) {
      const button = chip(tag, this.tags.has(tag.id), () => {
        if (this.saving) return;
        if (!this.tags.has(tag.id) && this.tags.size >= LIMITS.tags) { toast('Choose at most 20 tags.', true); return; }
        this.tags.has(tag.id) ? this.tags.delete(tag.id) : this.tags.add(tag.id);
        this.dirty = true; this.renderTags(); this.persist();
      });
      button.disabled = this.saving;
      container.append(button);
    }
    if (!state.tags.length) container.append(el('span', 'muted small', 'Tags will appear here once connected.'));
    if (focusedTag) [...container.children].find(button => button.dataset.tagId === focusedTag)?.focus({ preventScroll: true });
  }

  updateButtons() {
    const button = this.form.querySelector('.save-item');
    button.disabled = !onlineReady() || this.processing || this.saving;
    button.textContent = this.saving ? 'Saving…' : this.processing ? 'Processing photo…' : this.item ? 'Save changes' : 'Add to inventory';
    for (const control of this.form.querySelectorAll('input,textarea,select,.discard-draft,.remove-photo,.chip,.delete-item')) control.disabled = this.saving;
    if (this.item) $('#close-edit').disabled = this.saving;
  }

  async loadExistingPhoto() {
    const token = ++this.photoToken;
    this.form.querySelector('.photo-status').textContent = 'Loading current photo…';
    this.form.querySelector('.remove-photo').hidden = false;
    try {
      const data = await getPhoto(this.item);
      if (this.cancelled || token !== this.photoToken) return;
      this.showPhoto(data);
      this.form.querySelector('.photo-status').textContent = '';
    } catch {
      if (this.cancelled || token !== this.photoToken) return;
      this.form.querySelector('.photo-status').textContent = 'Current photo could not load. It will be kept unless you replace or remove it.';
    }
  }

  showPhoto(data) {
    const preview = this.form.querySelector('.photo-preview');
    preview.src = data; preview.hidden = false;
    this.form.querySelector('.photo-placeholder').hidden = true;
    this.form.querySelector('.remove-photo').hidden = false;
  }

  async selectPhoto(file) {
    if (!file || this.saving) return;
    const token = ++this.photoToken;
    this.processing = true; this.dirty = true;
    this.form.querySelector('.remove-photo').hidden = false;
    this.form.querySelector('.photo-status').textContent = 'Compressing photo…';
    this.updateButtons(); this.persist();
    try {
      const data = await compressPhoto(file);
      if (this.cancelled || token !== this.photoToken) return;
      this.photo = { action: 'set', data }; this.needsPhoto = false;
      this.showPhoto(data);
      this.form.querySelector('.photo-status').textContent = `Ready · ${Math.ceil(data.length / 1024)} KB`;
    } catch (error) {
      if (this.cancelled || token !== this.photoToken) return;
      this.form.querySelector('.photo-status').textContent = error.message;
    } finally {
      if (!this.cancelled && token === this.photoToken) {
        this.processing = false;
        for (const input of this.form.querySelectorAll('[type=file]')) input.value = '';
        this.updateButtons(); this.persist();
      }
    }
  }

  removePhoto() {
    if (this.saving) return;
    this.photoToken++; this.processing = false; this.needsPhoto = false;
    this.photo = { action: 'remove' }; this.dirty = true;
    const preview = this.form.querySelector('.photo-preview');
    preview.removeAttribute('src'); preview.hidden = true;
    this.form.querySelector('.photo-placeholder').hidden = false;
    this.form.querySelector('.remove-photo').hidden = true;
    this.form.querySelector('.photo-status').textContent = 'No photo will be saved.';
    for (const input of this.form.querySelectorAll('[type=file]')) input.value = '';
    this.updateButtons(); this.persist();
  }

  dispose() { this.cancelled = true; this.photoToken++; }

  async submit() {
    if (this.saving || this.processing) return;
    const errorNode = this.form.querySelector('.form-error');
    errorNode.textContent = '';
    try {
      if (!onlineReady()) throw new Error('Reconnect before saving. Your draft will be kept.');
      if (this.needsPhoto) throw new Error('Reselect your photo, or remove it, before saving this restored draft.');
      const fields = validateItem(this.fields());
      fields.hasPhoto = this.photo.action === 'set' || (this.photo.action === 'keep' && Boolean(this.item?.hasPhoto));
      this.dirty = true; this.persist();
      this.saving = true; this.updateButtons();
      await state.store.saveItem(this.id, fields, this.photo, Boolean(this.item));
      this.dirty = false;
      removeDraft(this.key);
      this.dispose();
      if (this.item) { $('#edit-dialog').close(); updateEditNotice(); }
      else { resetAdd(); switchTab('list'); }
      toast(this.item ? 'Changes saved.' : 'Item added to inventory.');
    } catch (error) {
      errorNode.textContent = error.message;
      this.saving = false; this.updateButtons();
    }
  }
}

let addController = new ItemForm($('#add-form-host'), null, loadDraft('add'));

function resetAdd() {
  addController.dispose();
  addController = new ItemForm($('#add-form-host'));
}

function updateEditNotice() {
  $('#edit-draft-notice').hidden = !loadDraft('edit');
}

function openEdit(id) {
  const item = state.items.find(item => item.id === id);
  if (!item) { toast('This item is no longer available.', true); return; }
  const draft = loadDraft('edit');
  if (draft && draft.id !== id && !confirm('Discard the unsaved edit for another item?')) return;
  if (draft && draft.id !== id) removeDraft('edit');
  if (editController?.id !== id || editController.cancelled) {
    editController?.dispose();
    editController = new ItemForm($('#edit-form-host'), item, draft?.id === id ? draft : null);
  }
  $('#edit-dialog').showModal();
}

$('#resume-edit').addEventListener('click', () => {
  const draft = loadDraft('edit');
  if (draft) openEdit(draft.id);
});
$('#discard-edit-draft').addEventListener('click', () => {
  if (!confirm('Discard the unsaved edit?')) return;
  editController?.dispose(); editController = null; removeDraft('edit'); updateEditNotice();
});
$('#close-edit').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-dialog').addEventListener('cancel', event => { if (editController?.saving) event.preventDefault(); });
$('#edit-dialog').addEventListener('close', () => {
  updateEditNotice();
});
$('#search-input').addEventListener('input', renderList);
$('#sort-select').addEventListener('change', renderList);
$('#clear-filters').addEventListener('click', () => {
  state.filters.clear(); $('#search-input').value = ''; renderFilters(); renderList();
});

$('#open-export').addEventListener('click', () => {
  $('#export-all').textContent = `Export all items (${state.items.length})`;
  $('#export-current').textContent = `Export current results (${currentItems().length})`;
  $('#export-all').disabled = state.exportBusy || !state.items.length;
  $('#export-current').disabled = state.exportBusy || !currentItems().length;
  $('#export-dialog').showModal();
});
$('#close-export').addEventListener('click', () => $('#export-dialog').close());
$('#export-all').addEventListener('click', () => exportItems(true));
$('#export-current').addEventListener('click', () => exportItems(false));

async function exportItems(all) {
  if (state.exportBusy) return;
  if (!onlineReady()) { $('#export-status').textContent = 'Reconnect before exporting.'; return; }
  const items = currentItems(all).map(item => ({ ...item, tagIds: [...item.tagIds] }));
  const tags = state.tags.map(tag => ({ ...tag }));
  if (!items.length) return;
  state.exportBusy = true;
  $('#export-all').disabled = $('#export-current').disabled = true;
  $('#download-export').hidden = true;
  if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; }
  const status = $('#export-status');
  const progress = $('#export-progress');
  status.textContent = 'Loading Excel export…'; progress.hidden = false; progress.value = 0; progress.max = items.length;
  try {
    const ExcelJS = await loadExcelJS();
    const result = await buildWorkbook({ ExcelJS, items, tags, getPhoto: item => getPhoto(item, false), progress: (done, total) => {
      progress.value = done;
      status.textContent = done === total ? 'Preparing download…' : `Preparing ${done} of ${total} items…`;
    } });
    exportUrl = URL.createObjectURL(new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const download = $('#download-export');
    download.href = exportUrl;
    download.download = `storage-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;
    download.hidden = false;
    status.textContent = `${items.length} items ready.${result.omitted ? ` ${result.omitted} unavailable photo(s) marked in the workbook.` : ''} Tap Download to save the file.`;
  } catch (error) { status.textContent = 'Export failed: ' + error.message; }
  finally {
    state.exportBusy = false; progress.hidden = true;
    $('#export-all').disabled = !state.items.length;
    $('#export-current').disabled = !currentItems().length;
  }
}

// Drafts are already persisted on input. Warn only for photos or an in-flight write.
window.addEventListener('beforeunload', event => {
  if (deleteTarget?.busy || [addController, editController].some(form => form && !form.cancelled && (form.saving || form.processing || form.photo.action === 'set'))) {
    event.preventDefault(); event.returnValue = '';
  }
});
window.addEventListener('pagehide', () => { if (exportUrl) URL.revokeObjectURL(exportUrl); });

updateEditNotice();
updateConnection();
try {
  state.store = await createStore();
  state.store.subscribe({
    inventory(items, { fromCache }) {
      state.items = items;
      state.connected.inventory = !fromCache;
      if (!fromCache) state.loaded.inventory = true;
      renderList(); renderStats(); updateConnection();
    },
    tags(tags, { fromCache }) {
      state.tags = tags.sort((a, b) => a.name.localeCompare(b.name));
      state.connected.tags = !fromCache;
      if (!fromCache) state.loaded.tags = true;
      renderFilters(); renderTagManager(); renderList(); renderStats();
      addController.renderTags(); editController?.renderTags(); updateConnection();
    },
    error(error) { state.error = 'Inventory connection failed. Reload to retry. ' + error.message; updateConnection(); toast(state.error, true); },
  });
  state.store.seedTags().catch(error => toast('Default tags could not initialize: ' + error.message, true));
} catch (error) {
  state.error = error.message;
  $('#setup-error').textContent = error.message;
  $('#setup-error').hidden = false;
  updateConnection();
}
