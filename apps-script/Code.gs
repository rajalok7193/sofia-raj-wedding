const VIDEO_FOLDER_ID = '1eAxScvH6zdeCHJxj6zYie05v9ns6XkgD';
const PHOTO_FOLDER_NAME = 'Sofia & Raj Wedding Memories';
const MAX_PHOTOS_PER_REQUEST = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_DAILY_PHOTOS = 200;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || 'list');
  if (action === 'status') {
    const id = String(e.parameter.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonp_(e, { status: 'error' });
    const status = CacheService.getScriptCache().get('upload_' + id);
    return jsonp_(e, status ? JSON.parse(status) : { status: 'processing' });
  }
  if (action !== 'list') return jsonp_(e, { error: 'Unknown action' });
  return jsonp_(e, { photos: listPhotos_(), videos: listVideos_() });
}

function doPost(e) {
  let uploadId = '';
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    uploadId = String(payload.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error('Invalid upload request.');
    const cache = CacheService.getScriptCache();
    cache.put('upload_' + uploadId, JSON.stringify({ status: 'processing' }), 600);
    if (!Array.isArray(payload.photos) || payload.photos.length < 1 || payload.photos.length > MAX_PHOTOS_PER_REQUEST) {
      throw new Error('Choose up to four photos.');
    }
    const photos = payload.photos;
    let totalBytes = 0;
    const decoded = photos.map(function(photo) {
      const mimeType = String(photo.mimeType || '');
      if (ALLOWED_TYPES.indexOf(mimeType) === -1) throw new Error('Only JPG, PNG, and WebP photos are accepted.');
      const base64 = String(photo.base64 || '');
      const bytes = Utilities.base64Decode(base64);
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error('Each photo must be 8 MB or smaller.');
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('The combined upload must be 16 MB or smaller.');
      return { photo: photo, mimeType: mimeType, bytes: bytes };
    });
    reserveDailyCapacity_(decoded.length);
    const folder = getPhotoFolder_();
    decoded.forEach(function(item) {
      const original = String(item.photo.name || 'wedding-memory').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90);
      const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
      const blob = Utilities.newBlob(item.bytes, item.mimeType, stamp + '-' + original);
      const file = folder.createFile(blob);
      const guest = String(payload.guest || 'Wedding guest').replace(/[<>\r\n]/g, '').slice(0, 80);
      const caption = String(payload.caption || '').replace(/[<>\r\n]/g, '').slice(0, 200);
      file.setDescription((guest + (caption ? ' · ' + caption : '')).slice(0, 280));
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    });
    cache.put('upload_' + uploadId, JSON.stringify({ status: 'uploaded', count: decoded.length }), 600);
    return ContentService.createTextOutput(JSON.stringify({ status: 'uploaded' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    if (uploadId) CacheService.getScriptCache().put('upload_' + uploadId, JSON.stringify({ status: 'error' }), 600);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error' })).setMimeType(ContentService.MimeType.JSON);
  }
}

function jsonp_(e, value) {
  const callback = String((e && e.parameter && e.parameter.callback) || '');
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback)) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  }
  const safeJson = JSON.stringify(value).replace(/</g, '\\u003c');
  return ContentService.createTextOutput(callback + '(' + safeJson + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function listPhotos_() {
  const files = getPhotoFolder_().getFiles();
  const result = [];
  while (files.hasNext()) {
    const file = files.next();
    if (ALLOWED_TYPES.indexOf(file.getMimeType()) === -1) continue;
    const parts = String(file.getDescription() || '').split(' · ');
    result.push({
      src: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200',
      title: parts[0] || 'Wedding memory',
      tag: parts.slice(1).join(' · ') || 'Shared with love',
      updated: file.getLastUpdated().getTime()
    });
  }
  result.sort(function(a, b) { return b.updated - a.updated; });
  return result.slice(0, 60).map(function(photo) { delete photo.updated; return photo; });
}

function listVideos_() {
  const files = DriveApp.getFolderById(VIDEO_FOLDER_ID).getFiles();
  const result = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType().indexOf('video/') !== 0) continue;
    result.push({ id: file.getId(), name: file.getName(), updated: file.getLastUpdated().getTime() });
  }
  result.sort(function(a, b) { return b.updated - a.updated; });
  return result.slice(0, 20);
}

function getPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('PHOTO_FOLDER_ID');
  if (savedId) return DriveApp.getFolderById(savedId);
  const matches = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  const folder = matches.hasNext() ? matches.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function reserveDailyCapacity_(count) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const day = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
    const key = 'uploads_' + day;
    const current = Number(props.getProperty(key) || '0');
    if (current + count > MAX_DAILY_PHOTOS) throw new Error('Daily upload limit reached.');
    props.setProperty(key, String(current + count));
  } finally {
    lock.releaseLock();
  }
}
