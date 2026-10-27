# Storage Inventory

A mobile-first, shared inventory for one storage unit. Plain HTML, CSS, and JavaScript; no application build step or server required. Firebase stores records and compressed photos. Excel exports include embedded thumbnails.

## Firebase setup

1. Open the [Firebase Console](https://console.firebase.google.com/) and create a project on **Spark**. Analytics is optional. Register a **Web App** from Project settings and copy the configuration into [`public/firebase-config.js`](public/firebase-config.js). Only `apiKey`, `authDomain`, `projectId`, and `appId` are needed. Leave `firestoreEmulator` as `null`.
2. Create the default **Cloud Firestore Standard edition** database in production mode. Choose a region near your users. Collections, documents, and the four initial tags are created by the app.
3. Authentication and Cloud Storage are unnecessary. The app intentionally has **no login**: anyone who reaches it can read, edit, and delete the shared inventory. The supplied rules validate data shape/size and restrict access to the three app collections. Do not use test-mode rules or create a password document.
4. Install [Node.js 22 or later](https://nodejs.org/), then run these commands in the project directory:

   ```powershell
   npm ci
   npx firebase login
   npx firebase use --add
   ```

   Select your Firebase project and give it the alias `default`. This creates a local `.firebaserc`. Hosting, rules, and index configuration are already included; `firebase init` is unnecessary.

5. Publish the rules and the exemption that prevents indexing the base64 photo field:

   ```powershell
   npx firebase deploy --only firestore
   ```

   Then preview locally:

   ```powershell
   npm start
   ```

   Open **http://127.0.0.1:4173**. The app will report missing configuration or permissions until the preceding steps are complete.

6. Deploy the website and database configuration:

   ```powershell
   npx firebase deploy --only firestore,hosting
   ```

   Open the reported HTTPS Hosting URL on your phone. Add an item with a photo, reload, edit its quantity/tags, and export it. App files are in `public/`; the original HTML filename now points to that entry point. Use a web server instead of opening HTML with `file://`.

Client Firebase configuration is public and can stay in source. Never place a service-account key or Admin SDK credential in this app.

## Using the app

- Add a name and whole-number quantity from 0 to 1,000,000,000. Choose **Exact** or **Estimate**. Description, location, notes, tags, and one photo are optional.
- **Tags** creates shared tags and renames them everywhere. Item forms attach/detach up to 20 tags. Names are checked for case-insensitive duplicates against the currently loaded list. Tags keep their IDs when renamed. Defaults are Disposable, Permanent, Broken, and Used.
- Search includes text fields and tag names. Multiple tag filters match **all** selected tags. Clear resets search and tag filters. Sort applies to browsing and both export options.
- Delete an entry using **Delete** on its inventory card or **Delete entry** in its edit screen. Confirm the named entry in the dialog; deletion permanently removes both the record and its photo. Cancel or Escape keeps the entry. Failed deletions show an error and can be retried.
- Form text and tag selections are saved to local browser storage on input. Unsaved edits have a Resume notice. A confirmed save or Discard draft clears a draft. Photos stay in memory and **must be reselected after reload**; restored photo drafts ask you to reselect or remove the photo before saving. If storage is unavailable, the form displays a notice.
- Saving requires a connection. If connectivity drops during a write, keep the page open until Firebase confirms it, or reload to recover the draft. Retries reuse the same draft item ID. There is no offline app cache or background synchronization. Simultaneous edits use the last completed write.
- Camera and library inputs are separate. Image formats your browser can decode are supported. If a HEIC file cannot be opened, choose or convert to JPEG. Photos become JPEG, at most 800 pixels on the longest edge and **250 KiB including base64 encoding**. Input files are limited to 30 MB.
- **Export Excel** offers all items or current results, in the selected order. Workbooks contain literal text, numeric quantities, Exact/Estimate, dates, tags, and embedded thumbnails. Missing photos are marked and counted. ExcelJS loads only when exporting. Tap Download when ready; mobile browsers may display their system save/share interface.

## Data and free-plan limits

| Collection | Document ID | Fields |
| --- | --- | --- |
| `inventory` | Generated item ID | `name`, `desc`, `qty`, `qtyType` (`exact`/`approx`), `location`, `notes`, `tagIds`, `hasPhoto`, `createdAt`, `updatedAt` |
| `tags` | Stable tag ID | `name` |
| `photos` | Same ID as its item | `photoB64` (JPEG data URL) |

Items/tags use realtime listeners. Photos load when visible and are cached in memory (up to 64). Item/photo changes are batched atomically. Text edits keep the existing photo. Exports retrieve photos sequentially and embed 160-pixel thumbnails.

This version targets fewer than 500 items and a fresh database. It does not migrate the prototype's category/inline-photo records. Spreadsheet import and full-resolution photo backup are outside this version.

Firestore currently allows a 1 MiB document, with Spark allowances of 1 GiB stored data, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, and 10 GiB outbound transfer/month. Photos consume these allowances; base64 increases data size. Check the Firebase Console Usage tab, especially after exports or browsing from multiple devices. See [Firestore quotas](https://firebase.google.com/docs/firestore/quotas). The app uses neither Cloud Storage buckets nor Cloud Functions.

## Validation

```powershell
npm test
npx playwright install chromium webkit
npm run test:browser
```

Unit tests cover quantities, shared tag names, filtering/sorting, drafts, and reading generated workbooks. Browser tests use an isolated fake store, actual photo compression and ExcelJS, mobile Chromium/WebKit, and a 500-item fixture. Fixtures are outside the hosting directory. Screenshots/traces are saved in `test-results/`.

Rules tests require **Java 21 or later** on `PATH` plus Node. They use a demo project and never contact production:

```powershell
npm run test:rules
npm run test:integration
```

The integration suite uses the real Firebase browser SDK against the emulator in both mobile browser engines. It downloads the pinned Firebase SDK from Google's CDN, uses a temporary browser configuration, and never edits your config file.

To preview against the local Firestore emulator:

1. Set config `projectId` to `demo-storage-inventory`, with nonempty demo values for the other fields: `apiKey: 'demo-key'`, `authDomain: 'localhost'`, `appId: 'demo-app'`.
2. Set `firestoreEmulator` to `{ host: '127.0.0.1', port: 8080 }`.
3. Run `npx firebase emulators:start --only firestore --project demo-storage-inventory`, then `npm start` in another terminal.
4. Restore the real config and `firestoreEmulator = null` before deployment.

Check these on actual **Android Chrome** and **iPhone Safari** before taking a full inventory: camera capture, library selection, orientation, keyboard/scrolling, draft recovery after closing the browser, and saving/opening Excel downloads. Browser emulation cannot verify physical cameras or OS download behavior.
