// Fill these two values before uploading trial/release builds.
const PRODUCTION_HTTP_BASE_URL = '';
const PRODUCTION_WS_BASE_URL = '';
const CLOUDBASE_ENV_ID = 'cloudbase-d3gtnhob5d143914c';
const CLOUDBASE_SERVICE_NAME = 'leisure-python';

const DEVELOPMENT_HTTP_BASE_URL = 'http://192.168.31.210:8787';
const DEVELOPMENT_WS_BASE_URL = 'ws://192.168.31.210:8787';
const DEVELOPMENT_BACKUP_HTTP_BASE_URLS = [
  'http://127.0.0.1:8787',
  'http://localhost:8787',
  'http://192.168.31.210:8787'
];
const DEVELOPMENT_BACKUP_WS_BASE_URLS = [
  'ws://127.0.0.1:8787',
  'ws://localhost:8787',
  'ws://192.168.31.210:8787'
];

module.exports = {
  PRODUCTION_HTTP_BASE_URL,
  PRODUCTION_WS_BASE_URL,
  CLOUDBASE_ENV_ID,
  CLOUDBASE_SERVICE_NAME,
  DEVELOPMENT_HTTP_BASE_URL,
  DEVELOPMENT_WS_BASE_URL,
  DEVELOPMENT_BACKUP_HTTP_BASE_URLS,
  DEVELOPMENT_BACKUP_WS_BASE_URLS
};
