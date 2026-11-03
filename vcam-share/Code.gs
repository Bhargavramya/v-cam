/**
 * V Cam — Share & Friends' Ideas backend.
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * Runs under YOUR Google account, so friends never need to sign in —
 * this script reads/writes YOUR Drive using YOUR permission, on their behalf.
 *
 * It never touches anything outside the "V Cam" folder it already uses for sync.
 */

var FOLDER_NAME = 'V Cam';
var THOUGHTS_SHEET_NAME = 'V Cam Thoughts';

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readBody_(e) {
  try { return JSON.parse(e.postData.contents); } catch (err) { return {}; }
}

function vcamFolder_() {
  var res = Drive.Files.list({ q: "appProperties has { key='vcam' and value='folder' } and trashed=false", fields: 'files(id,name)' });
  if (res.files && res.files.length) return res.files[0].id;
  var f = Drive.Files.create({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', appProperties: { vcam: 'folder' } });
  return f.id;
}

function listVcamFiles_(kind) {
  var q = "appProperties has { key='vcam' and value='1' } and trashed=false" + (kind ? " and appProperties has { key='kind' and value='" + kind + "' }" : '');
  var out = [], tok = null;
  do {
    var res = Drive.Files.list({ q: q, fields: 'nextPageToken,files(id,name,appProperties)', pageSize: 1000, pageToken: tok });
    out = out.concat(res.files || []); tok = res.nextPageToken;
  } while (tok);
  return out;
}

function fileText_(id) { return Drive.Files.get(id, { alt: 'media' }).getDataAsString(); }
function fileBase64_(id) { var b = Drive.Files.get(id, { alt: 'media' }); return { base64: Utilities.base64Encode(b.getBytes()), mime: b.getContentType() }; }

function bareItem_(it) {
  var drop = { photo: 1, image: 1, thumb: 1, drive: 1, synced: 1, placeTried: 1 };
  var o = {}; for (var k in it) if (!drop[k]) o[k] = it[k];
  return o;
}

// ---------- GET: read-only, no sign-in needed ----------
function doGet(e) {
  var action = e.parameter.action;
  try {
    if (action === 'getAlbum') return json_(getAlbum_(e.parameter.album || ''));
    if (action === 'getThoughts') return json_(getThoughts_());
    return json_({ error: 'unknown action' });
  } catch (err) { return json_({ error: String(err) }); }
}

// ---------- POST: adds / edits ----------
function doPost(e) {
  var body = readBody_(e);
  var action = (e.parameter && e.parameter.action) || body.action;
  try {
    if (action === 'addItem') return json_(addItem_(body));
    if (action === 'updateItem') return json_(updateItem_(body));
    if (action === 'addThought') return json_(addThought_(body));
    if (action === 'addComment') return json_(addComment_(body));
    return json_({ error: 'unknown action' });
  } catch (err) { return json_({ error: String(err) }); }
}

// ---------- Shared album ----------
function getAlbum_(album) {
  var metas = listVcamFiles_('meta');
  var photos = {}; listVcamFiles_('photo').forEach(function (f) { photos[f.appProperties.item] = f.id; });
  var items = [];
  metas.forEach(function (f) {
    var it; try { it = JSON.parse(fileText_(f.id)); } catch (err) { return; }
    if (it.draft) return;
    if (album && (it.album || '') !== album) return;
    var out = { id: it.id, no: it.no, name: it.name || '', cost: it.cost, sell: it.sell, points: it.points || [],
      shop: it.shop || '', contact: it.contact || '', place: it.place || '', album: it.album || '',
      whom: it.whom || [], occ: it.occ || [], fav: !!it.fav, updated: it.updated || it.created };
    if (photos[it.id]) { try { var ph = fileBase64_(photos[it.id]); out.photoBase64 = ph.base64; out.photoMime = ph.mime; } catch (err) {} }
    items.push(out);
  });
  items.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  return { album: album, items: items };
}

function addItem_(b) {
  var dir = vcamFolder_();
  var id = 'f' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var ts = Date.now(), mv = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  var no = 'F-' + Utilities.formatDate(new Date(), 'Etc/UTC', 'MMdd-HHmmss');
  var it = bareItem_({ id: id, no: no, name: b.name || '', cost: b.cost || null, sell: b.sell || null,
    points: (b.points || []).filter(Boolean), shop: b.shop || '', contact: b.contact || '', place: b.place || '',
    album: b.album || '', whom: b.whom || [], occ: b.occ || [], fav: false, draft: false,
    created: ts, updated: ts, mv: mv, addedBy: b.author || 'A friend' });
  Drive.Files.create({ name: no + '.json', parents: [dir], appProperties: { vcam: '1', item: id, kind: 'meta', updated: String(ts), mv: mv } },
    Utilities.newBlob(JSON.stringify(it), 'application/json', no + '.json'));
  if (b.photoBase64) {
    var bytes = Utilities.base64Decode(b.photoBase64);
    var blob = Utilities.newBlob(bytes, b.photoMime || 'image/jpeg', no + '-photo.jpg');
    Drive.Files.create({ name: no + '-photo.jpg', parents: [dir], appProperties: { vcam: '1', item: id, kind: 'photo', updated: String(ts), mv: mv } }, blob);
  }
  return { ok: true, id: id };
}

function updateItem_(b) {
  var metas = listVcamFiles_('meta').filter(function (f) { return f.appProperties.item === b.id; });
  if (!metas.length) return { error: 'item not found' };
  var f = metas[0];
  var it; try { it = JSON.parse(fileText_(f.id)); } catch (err) { it = {}; }
  ['name', 'cost', 'sell', 'points', 'shop', 'contact', 'place', 'whom', 'occ'].forEach(function (k) { if (b[k] !== undefined) it[k] = b[k]; });
  var ts = Date.now(), mv = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  it.updated = ts; it.mv = mv; it.editedBy = b.author || 'A friend';
  Drive.Files.update({ appProperties: { vcam: '1', item: b.id, kind: 'meta', updated: String(ts), mv: mv } }, f.id,
    Utilities.newBlob(JSON.stringify(it), 'application/json', f.name));
  return { ok: true };
}

// ---------- Friends' Ideas board ----------
function thoughtsSheet_() {
  var res = Drive.Files.list({ q: "name='" + THOUGHTS_SHEET_NAME + "' and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'", fields: 'files(id)' });
  if (res.files && res.files.length) return SpreadsheetApp.openById(res.files[0].id).getSheets()[0];
  var ss = SpreadsheetApp.create(THOUGHTS_SHEET_NAME);
  var dir = vcamFolder_();
  var file = DriveApp.getFileById(ss.getId()); DriveApp.getFolderById(dir).addFile(file); DriveApp.getRootFolder().removeFile(file);
  var sh = ss.getSheets()[0];
  sh.appendRow(['id', 'ts', 'author', 'text', 'link', 'photoFileId', 'photoMime', 'comments']);
  return sh;
}

function getThoughts_() {
  var sh = thoughtsSheet_();
  var rows = sh.getDataRange().getValues(); rows.shift();
  var out = rows.map(function (r) {
    var o = { id: r[0], ts: r[1], author: r[2], text: r[3], link: r[4], comments: [] };
    try { o.comments = JSON.parse(r[7] || '[]'); } catch (e) {}
    if (r[5]) { try { var ph = fileBase64_(r[5]); o.photoBase64 = ph.base64; o.photoMime = ph.mime; } catch (e) {} }
    return o;
  });
  out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return { thoughts: out };
}

function addThought_(b) {
  var sh = thoughtsSheet_();
  var id = Utilities.getUuid(), ts = Date.now(), photoFileId = '';
  if (b.photoBase64) {
    var dir = vcamFolder_();
    var blob = Utilities.newBlob(Utilities.base64Decode(b.photoBase64), b.photoMime || 'image/jpeg', 'idea-' + id + '.jpg');
    var f = Drive.Files.create({ name: 'idea-' + id + '.jpg', parents: [dir], appProperties: { vcam: '1', kind: 'thought-photo' } }, blob);
    photoFileId = f.id;
  }
  sh.appendRow([id, ts, b.author || 'A friend', b.text || '', b.link || '', photoFileId, b.photoMime || '', '[]']);
  return { ok: true, id: id };
}

function addComment_(b) {
  var sh = thoughtsSheet_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === b.id) {
      var comments = []; try { comments = JSON.parse(data[i][7] || '[]'); } catch (e) {}
      comments.push({ author: b.author || 'A friend', text: b.text || '', ts: Date.now() });
      sh.getRange(i + 1, 8).setValue(JSON.stringify(comments));
      return { ok: true };
    }
  }
  return { error: 'thought not found' };
}
