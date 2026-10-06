/**
 * JOTA-JOTI Camera backup service
 *
 * IMPORTANT:
 * - Run this script from the same Google account that owns the JOTA-JOTI Sheet.
 * - Run setup() once. Before running it, store SUPABASE_PASSWORD in Script Properties.
 * - Never put the organiser password in this file or in GitHub.
 * - The browser only gets the publishable Supabase key and a non-secret backup client key.
 */

const DEFAULTS = Object.freeze({
  SUPABASE_URL: 'https://fyplxwxwrkilzdhaaftr.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_aKeN2l_AhMBlVzmfzLS73g_8X22FHEQ',
  ORGANISER_EMAIL: 'jota.joti.boulder@gmail.com',
  CLIENT_KEY: 'jj26-4df8f7e98f7f4b57a31c6e9a8d2a',
  BACKUP_FOLDER: 'JOTA-JOTI Camera Backup',
  MAX_MEDIA_BYTES: 30 * 1024 * 1024,
  BACKUPS_SHEET: 'Backups',
  ERRORS_SHEET: 'Backup Errors',
  HEALTH_SHEET: 'Backup Health',
});

function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const password = String(props.getProperty('SUPABASE_PASSWORD') || '').trim();
  if (!password) {
    throw new Error('SUPABASE_PASSWORD is missing. In Project Settings -> Script Properties, add SUPABASE_PASSWORD and then run setup() again.');
  }

  props.setProperties({
    SUPABASE_URL: DEFAULTS.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: DEFAULTS.SUPABASE_PUBLISHABLE_KEY,
    ORGANISER_EMAIL: DEFAULTS.ORGANISER_EMAIL,
    CLIENT_KEY: DEFAULTS.CLIENT_KEY,
    BACKUP_FOLDER: DEFAULTS.BACKUP_FOLDER,
    MAX_MEDIA_BYTES: String(DEFAULTS.MAX_MEDIA_BYTES),
  }, false);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the JOTA-JOTI Google Sheet first, then run setup().');
  props.setProperty('SPREADSHEET_ID', ss.getId());

  ensureSheet_(ss, DEFAULTS.BACKUPS_SHEET, [
    'Time', 'Submission ID', 'Participant', 'Kind', 'File name', 'Drive file ID', 'Drive URL', 'Bytes', 'Provider', 'Status', 'Notes'
  ]);
  ensureSheet_(ss, DEFAULTS.ERRORS_SHEET, [
    'Time', 'Submission ID', 'Stage', 'Message', 'Details'
  ]);
  ensureSheet_(ss, DEFAULTS.HEALTH_SHEET, [
    'Time', 'Check', 'Result', 'Details'
  ]);

  const folder = getBackupFolder_();
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  ensureTrigger_();
  writeHealth_('setup', 'OK', 'Backup folder and trigger are configured.');

  const test = testBackup();
  ui.alert(
    'JOTA-JOTI backup setup complete',
    `Drive folder: ${folder.getName()}\n\nSupabase organiser login: ${test.supabase ? 'OK' : 'FAILED'}\nDrive access: ${test.drive ? 'OK' : 'FAILED'}\n5-minute backup trigger: installed\n\nThe web app endpoint is ready. Test one real photo and one real video from the published site.`,
    ui.ButtonSet.OK
  );
  return test;
}

function testBackup() {
  const out = { supabase: false, drive: false, message: '' };
  try {
    const session = getAdminSession_(true);
    out.supabase = !!session.access_token;
  } catch (e) {
    logError_('', 'testBackup/supabase', e);
    out.message += `Supabase: ${e.message}\n`;
  }
  try {
    const folder = getBackupFolder_();
    const file = folder.createFile(Utilities.newBlob('JOTA-JOTI backup test', 'text/plain', 'jota-joti-backup-test.txt'));
    file.setTrashed(true);
    out.drive = true;
  } catch (e) {
    logError_('', 'testBackup/drive', e);
    out.message += `Drive: ${e.message}\n`;
  }
  writeHealth_('testBackup', out.supabase && out.drive ? 'OK' : 'FAILED', out.message || 'Both services responded.');
  return out;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.op === 'health') {
    if (!validClientKey_(p.key)) return json_({ ok: false, error: 'BAD_KEY' });
    return json_({ ok: true, service: 'jota-joti-drive-backup', time: new Date().toISOString() });
  }
  if (p.op === 'sync') {
    if (!validClientKey_(p.key)) return json_({ ok: false, error: 'BAD_KEY' });
    return json_(syncPendingBackups());
  }
  if (p.op === 'status') {
    if (!validClientKey_(p.key)) return json_({ ok: false, error: 'BAD_KEY' });
    return json_(backupStatus_());
  }
  return json_({ ok: true, service: 'jota-joti-drive-backup', time: new Date().toISOString() });
}

function doPost(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) return json_({ ok: false, error: 'EMPTY_BODY' });

  let body;
  try { body = JSON.parse(raw); } catch (_) { return json_({ ok: false, error: 'BAD_JSON' }); }
  if (!validClientKey_(body.clientKey)) return json_({ ok: false, error: 'BAD_KEY' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ ok: false, retry: true, error: 'BUSY' });
  try {
    if (body.op === 'notify') {
      const result = backupSubmission_(String(body.submissionId || ''));
      return json_(result);
    }
    if (body.op === 'fallback') {
      const result = saveDirectFallback_(body);
      return json_(result);
    }
    return json_({ ok: false, error: 'BAD_OPERATION' });
  } catch (e2) {
    logError_(String(body.submissionId || ''), body.op || 'doPost', e2);
    return json_({ ok: false, error: String(e2.message || e2) });
  } finally {
    lock.releaseLock();
  }
}

/** Run from the Apps Script editor to force a backup pass. */
function manualSync() {
  return syncPendingBackups();
}

function syncPendingBackups() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, retry: true, error: 'BUSY' };
  try {
    const rows = restGet_(
      'submissions?select=id,participant_name,media_type,size,duration,mime,media_key,thumb_key,audio_key,captured_at,upload_status,backup_status,storage_provider&upload_status=eq.UPLOADED&or=(backup_status.eq.PENDING,backup_status.is.null)&order=captured_at.asc&limit=5'
    );
    const results = [];
    for (const row of rows) {
      try {
        results.push(backupSubmission_(row.id));
      } catch (e) {
        logError_(row.id, 'syncPendingBackups/item', e);
        results.push({ ok: false, id: row.id, error: String(e.message || e) });
      }
    }
    return { ok: true, checked: rows.length, results };
  } finally {
    lock.releaseLock();
  }
}

function backupSubmission_(submissionId) {
  if (!submissionId) throw new Error('Missing submission ID');
  const rows = restGet_(`submissions?id=eq.${encodeURIComponent(submissionId)}&select=*`);
  const s = rows[0];
  if (!s) return { ok: false, id: submissionId, error: 'NOT_FOUND' };
  if (s.backup_status === 'DONE') return { ok: true, id: submissionId, already: true, provider: s.storage_provider || 'DUAL' };
  if (s.upload_status !== 'UPLOADED') return { ok: true, id: submissionId, skipped: true, reason: 'NOT_UPLOADED' };

  const maxBytes = Number(getProp_('MAX_MEDIA_BYTES', DEFAULTS.MAX_MEDIA_BYTES));
  if (Number(s.size || 0) > maxBytes) throw new Error(`Media is larger than the Drive-backup limit of ${maxBytes} bytes.`);

  const files = [];
  files.push(downloadStorageFile_(s.media_key, makeFileName_(s, 'media')));
  if (s.thumb_key) {
    try { files.push(downloadStorageFile_(s.thumb_key, makeFileName_(s, 'thumb', 'jpg'))); } catch (e) { logError_(submissionId, 'backup/thumb', e); }
  }
  if (s.audio_key) {
    try { files.push(downloadStorageFile_(s.audio_key, makeFileName_(s, 'audio'))); } catch (e) { logError_(submissionId, 'backup/audio', e); }
  }

  const saved = saveDriveFiles_(s, files, 'DUAL');
  const main = saved.find((x) => x.kind === 'media') || saved[0];
  recordBackup_(s.id, 'DONE', 'DUAL', main && main.fileId || '', main && main.url || '', '');
  return { ok: true, id: s.id, provider: 'DUAL', files: saved.length, driveUrl: main && main.url || '' };
}

function saveDirectFallback_(body) {
  const id = String(body.submissionId || '');
  const files = Array.isArray(body.files) ? body.files : [];
  if (!id || !files.length) throw new Error('Fallback data is incomplete.');
  const maxBytes = Number(getProp_('MAX_MEDIA_BYTES', DEFAULTS.MAX_MEDIA_BYTES));
  const main = files.find((f) => f.kind === 'media');
  if (!main) throw new Error('Fallback is missing the media file.');
  if (Number(main.size || 0) > maxBytes) throw new Error('Fallback media is too large.');

  const allowed = new Set(['media', 'thumb', 'audio']);
  const blobs = [];
  for (const f of files) {
    if (!allowed.has(String(f.kind))) continue;
    const size = Number(f.size || 0);
    if (size < 0 || size > maxBytes) throw new Error(`Invalid ${f.kind} size.`);
    const b64 = String(f.base64 || '');
    if (!b64) throw new Error(`Missing ${f.kind} data.`);
    const bytes = Utilities.base64Decode(b64);
    if (bytes.length !== size) throw new Error(`The ${f.kind} data length does not match its size.`);
    blobs.push({ kind: String(f.kind), blob: Utilities.newBlob(bytes, String(f.mime || 'application/octet-stream'), safeName_(String(f.name || id))) });
  }

  const s = {
    id,
    participant_name: String(body.participantName || 'Participant'),
    media_type: String(body.mediaType || 'media'),
    mime: String(body.mime || 'application/octet-stream'),
    size: main.size,
    duration: body.duration || 0,
    captured_at: body.capturedAt || new Date().toISOString(),
  };
  const saved = saveDriveFiles_(s, blobs, 'DRIVE');
  const mainSaved = saved.find((x) => x.kind === 'media') || saved[0];
  recordBackup_(id, 'DONE', 'DRIVE', mainSaved && mainSaved.fileId || '', mainSaved && mainSaved.url || '', 'Supabase storage fallback');
  return { ok: true, id, provider: 'DRIVE', files: saved.length, driveUrl: mainSaved && mainSaved.url || '' };
}

function saveDriveFiles_(submission, files, provider) {
  const folder = getBackupFolder_();
  const out = [];
  for (const item of files) {
    const blob = item.blob;
    if (!blob || blob.getBytes().length === 0) continue;
    const name = safeName_(item.name || makeFileName_(submission, item.kind));
    const existing = folder.getFilesByName(name);
    const file = existing.hasNext() ? existing.next() : folder.createFile(blob.copyBlob().setName(name));
    const size = blob.getBytes().length;
    out.push({
      kind: item.kind,
      name,
      fileId: file.getId(),
      url: file.getUrl(),
      bytes: size,
    });
    appendRow_(DEFAULTS.BACKUPS_SHEET, [
      new Date(), submission.id, submission.participant_name || '', item.kind, name, file.getId(), file.getUrl(), size, provider, 'DONE', ''
    ]);
  }
  if (!out.length) throw new Error('No Drive files were created.');
  return out;
}

function downloadStorageFile_(path, name) {
  const session = getAdminSession_(false);
  const url = `${getProp_('SUPABASE_URL', DEFAULTS.SUPABASE_URL)}/storage/v1/object/authenticated/media/${path}`;
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        apikey: getProp_('SUPABASE_PUBLISHABLE_KEY', DEFAULTS.SUPABASE_PUBLISHABLE_KEY),
        Authorization: `Bearer ${session.access_token}`,
      },
      muteHttpExceptions: true,
    });
  } catch (e) {
    throw new Error(`Storage download failed: ${e.message || e}`);
  }
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error(`Storage download failed with HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 500)}`);
  }
  const bytes = res.getContent();
  if (bytes.length > Number(getProp_('MAX_MEDIA_BYTES', DEFAULTS.MAX_MEDIA_BYTES))) throw new Error('Downloaded file exceeds backup limit.');
  const headers = res.getAllHeaders();
  const contentType = String((headers['Content-Type'] || headers['content-type'] || 'application/octet-stream'));
  return { kind: kindFromName_(name), name: safeName_(name), blob: Utilities.newBlob(bytes, contentType, safeName_(name)) };
}

function recordBackup_(id, status, provider, fileId, url, errorMessage) {
  const body = {
    backup_status: status,
    storage_provider: provider,
    backup_file_id: String(fileId || '').slice(0, 200),
    backup_url: String(url || '').slice(0, 1000),
    backup_at: status === 'DONE' ? new Date().toISOString() : null,
    backup_error: String(errorMessage || '').slice(0, 300),
  };
  restPatch_(`submissions?id=eq.${encodeURIComponent(id)}`, body, true);
}

function backupStatus_() {
  const rows = restGet_('submissions?select=id,upload_status,backup_status,storage_provider,backup_at,backup_url,last_error&order=captured_at.desc&limit=1000');
  return {
    ok: true,
    total: rows.length,
    uploaded: rows.filter((r) => r.upload_status === 'UPLOADED').length,
    backedUp: rows.filter((r) => r.backup_status === 'DONE').length,
    pending: rows.filter((r) => r.upload_status === 'UPLOADED' && r.backup_status !== 'DONE').length,
    errors: rows.filter((r) => r.backup_status === 'ERROR').length,
  };
}

function getAdminSession_(forceLogin) {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('SUPABASE_ACCESS_TOKEN');
  const expires = Number(props.getProperty('SUPABASE_ACCESS_EXPIRES_AT') || 0);
  if (!forceLogin && cached && expires > Date.now() / 1000 + 120) return { access_token: cached };

  const password = props.getProperty('SUPABASE_PASSWORD');
  if (!password) throw new Error('Run setup() first. The organiser password is not stored.');

  const url = `${getProp_('SUPABASE_URL', DEFAULTS.SUPABASE_URL)}/auth/v1/token?grant_type=password`;
  const payload = JSON.stringify({
    email: getProp_('ORGANISER_EMAIL', DEFAULTS.ORGANISER_EMAIL),
    password,
  });
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload,
    headers: { apikey: getProp_('SUPABASE_PUBLISHABLE_KEY', DEFAULTS.SUPABASE_PUBLISHABLE_KEY) },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error(`Supabase organiser login failed (${code}): ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  props.setProperty('SUPABASE_ACCESS_TOKEN', data.access_token || '');
  props.setProperty('SUPABASE_ACCESS_EXPIRES_AT', String(Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)));
  return data;
}

function restGet_(path) {
  const s = getAdminSession_(false);
  const url = `${getProp_('SUPABASE_URL', DEFAULTS.SUPABASE_URL)}/rest/v1/${path}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      apikey: getProp_('SUPABASE_PUBLISHABLE_KEY', DEFAULTS.SUPABASE_PUBLISHABLE_KEY),
      Authorization: `Bearer ${s.access_token}`,
    },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    if (code === 401) {
      PropertiesService.getScriptProperties().deleteProperty('SUPABASE_ACCESS_TOKEN');
      PropertiesService.getScriptProperties().deleteProperty('SUPABASE_ACCESS_EXPIRES_AT');
    }
    throw new Error(`Supabase REST GET failed (${code}): ${text.slice(0, 600)}`);
  }
  return text ? JSON.parse(text) : [];
}

function restPatch_(path, body, retry) {
  const s = getAdminSession_(false);
  const url = `${getProp_('SUPABASE_URL', DEFAULTS.SUPABASE_URL)}/rest/v1/${path}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json', payload: JSON.stringify(body),
    headers: {
      apikey: getProp_('SUPABASE_PUBLISHABLE_KEY', DEFAULTS.SUPABASE_PUBLISHABLE_KEY),
      Authorization: `Bearer ${s.access_token}`,
      Prefer: 'return=minimal',
    },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 401 && retry) {
    PropertiesService.getScriptProperties().deleteProperty('SUPABASE_ACCESS_TOKEN');
    PropertiesService.getScriptProperties().deleteProperty('SUPABASE_ACCESS_EXPIRES_AT');
    return restPatch_(path, body, false);
  }
  if (code < 200 || code >= 300) throw new Error(`Supabase REST PATCH failed (${code}): ${res.getContentText().slice(0, 600)}`);
  return true;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  const first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (first.join('\u001f') !== headers.join('\u001f')) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function appendRow_(sheetName, values) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(sheetName) || ensureSheet_(ss, sheetName, []);
  sheet.appendRow(values);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Spreadsheet ID is not set. Run setup() from the bound JOTA-JOTI Sheet.');
  return active;
}

function getBackupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (_) { /* create a new folder below */ }
  }
  const root = DriveApp.getRootFolder();
  const name = getProp_('BACKUP_FOLDER', DEFAULTS.BACKUP_FOLDER);
  const it = root.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : root.createFolder(name);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

function ensureTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some((t) => t.getHandlerFunction() === 'syncPendingBackups' || t.getHandlerFunction() === 'manualSync');
  if (!exists) ScriptApp.newTrigger('syncPendingBackups').timeBased().everyMinutes(5).create();
}

function writeHealth_(check, result, details) {
  try { appendRow_(DEFAULTS.HEALTH_SHEET, [new Date(), check, result, details || '']); } catch (_) { /* health logging is best effort */ }
}

function logError_(id, stage, e) {
  const message = String(e && e.message || e || 'Unknown error').slice(0, 500);
  const details = String(e && e.stack || '').slice(0, 1500);
  try { appendRow_(DEFAULTS.ERRORS_SHEET, [new Date(), id || '', stage || '', message, details]); } catch (_) { /* do not hide original error */ }
}

function validClientKey_(key) {
  return !!key && String(key) === String(getProp_('CLIENT_KEY', DEFAULTS.CLIENT_KEY));
}

function getProp_(key, fallback) {
  return PropertiesService.getScriptProperties().getProperty(key) || fallback;
}

function safeName_(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').slice(0, 150);
}

function makeFileName_(s, kind, forcedExt) {
  const when = new Date(s.captured_at || Date.now());
  const stamp = Utilities.formatDate(when, Session.getScriptTimeZone() || 'Australia/Perth', 'yyyy-MM-dd_HH-mm-ss');
  const who = safeName_(s.participant_name || 'Participant').replace(/ /g, '_');
  let ext = forcedExt;
  if (!ext) {
    const mime = String(s.mime || 'application/octet-stream').toLowerCase().split(';')[0];
    ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/webm': 'webm' })[mime] || 'bin';
  }
  return `${stamp}_${who}_${String(s.id).slice(0, 8)}_${kind}.${ext}`;
}

function kindFromName_(name) {
  const n = String(name || '');
  if (/_t\./.test(n) || /_thumb\./i.test(n)) return 'thumb';
  if (/_a\./.test(n) || /_audio\./i.test(n)) return 'audio';
  return 'media';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
