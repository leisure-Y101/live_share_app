'use strict';

const {
  PRODUCTION_HTTP_BASE_URL,
  PRODUCTION_WS_BASE_URL,
  DEVELOPMENT_HTTP_BASE_URL,
  DEVELOPMENT_WS_BASE_URL,
  DEVELOPMENT_BACKUP_HTTP_BASE_URLS,
  DEVELOPMENT_BACKUP_WS_BASE_URLS,
  CLOUDBASE_ENV_ID,
  CLOUDBASE_SERVICE_NAME
} = require('./config');
const {
  getCloudContainerTarget,
  isCloudContainerConfigured,
  probeCloudContainer
} = require('./cloud');

const CUSTOM_HTTP_BASE_URL_KEY = 'customHttpBaseUrl';
const CUSTOM_WS_BASE_URL_KEY = 'customWsBaseUrl';
const WORKING_HTTP_BASE_URL_KEY = 'workingHttpBaseUrl';
const WORKING_WS_BASE_URL_KEY = 'workingWsBaseUrl';

function unique(items) {
  return items.filter((item, index) => item && items.indexOf(item) === index);
}

function safeGetStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return '';
  }
}

function safeSetStorage(key, value) {
  if (!value) {
    return;
  }

  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    // Ignore storage write failures during development.
  }
}

function safeRemoveStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    // Ignore storage cleanup failures during development.
  }
}

function toWsBaseUrl(httpBaseUrl) {
  return String(httpBaseUrl || '').replace(/^http/i, 'ws');
}

function getMiniProgramEnvVersion() {
  try {
    if (typeof wx.getAccountInfoSync === 'function') {
      const info = wx.getAccountInfoSync();
      return (info && info.miniProgram && info.miniProgram.envVersion) || 'develop';
    }
  } catch (error) {
    // Fallback to develop when account info is unavailable.
  }

  return 'develop';
}

function isStrictNetworkEnv(envVersion = getMiniProgramEnvVersion()) {
  return envVersion === 'trial' || envVersion === 'release';
}

function shouldUseCloudContainer(envVersion = getMiniProgramEnvVersion()) {
  return isStrictNetworkEnv(envVersion) && isCloudContainerConfigured();
}

function isLoopbackOrLanHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') {
    return true;
  }

  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) {
    return true;
  }

  const match = normalized.match(/^172\.(\d{1,2})\./);

  if (!match) {
    return false;
  }

  const secondSegment = Number(match[1]);
  return secondSegment >= 16 && secondSegment <= 31;
}

function normalizeHttpBaseUrl(input) {
  const raw = String(input || '').trim();

  if (!raw) {
    return '';
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return '';
  }
}

function normalizeWsBaseUrl(input) {
  const raw = String(input || '').trim();

  if (!raw) {
    return '';
  }

  const withProtocol = /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return '';
  }
}

function isAllowedHttpBaseUrl(baseUrl, envVersion = getMiniProgramEnvVersion()) {
  const normalized = normalizeHttpBaseUrl(baseUrl);

  if (!normalized) {
    return false;
  }

  if (!isStrictNetworkEnv(envVersion)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' && !isLoopbackOrLanHostname(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function isAllowedWsBaseUrl(wsBaseUrl, envVersion = getMiniProgramEnvVersion()) {
  const normalized = normalizeWsBaseUrl(wsBaseUrl);

  if (!normalized) {
    return false;
  }

  if (!isStrictNetworkEnv(envVersion)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'wss:' && !isLoopbackOrLanHostname(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function getDefaultHttpBaseUrl(envVersion = getMiniProgramEnvVersion()) {
  if (shouldUseCloudContainer(envVersion)) {
    return '';
  }

  return isStrictNetworkEnv(envVersion)
    ? normalizeHttpBaseUrl(PRODUCTION_HTTP_BASE_URL)
    : normalizeHttpBaseUrl(DEVELOPMENT_HTTP_BASE_URL);
}

function getDefaultWsBaseUrl(envVersion = getMiniProgramEnvVersion()) {
  if (shouldUseCloudContainer(envVersion)) {
    return '';
  }

  return isStrictNetworkEnv(envVersion)
    ? normalizeWsBaseUrl(PRODUCTION_WS_BASE_URL)
    : normalizeWsBaseUrl(DEVELOPMENT_WS_BASE_URL);
}

function getBackupHttpBaseUrls(envVersion = getMiniProgramEnvVersion()) {
  if (isStrictNetworkEnv(envVersion)) {
    return [];
  }

  return unique(DEVELOPMENT_BACKUP_HTTP_BASE_URLS.map((item) => normalizeHttpBaseUrl(item)));
}

function getBackupWsBaseUrls(envVersion = getMiniProgramEnvVersion()) {
  if (isStrictNetworkEnv(envVersion)) {
    return [];
  }

  return unique(DEVELOPMENT_BACKUP_WS_BASE_URLS.map((item) => normalizeWsBaseUrl(item)));
}

function readStoredBaseUrl(key, validator, normalizer, envVersion = getMiniProgramEnvVersion()) {
  const value = safeGetStorage(key);

  if (!value) {
    return '';
  }

  const normalized = normalizer(value);

  if (validator(normalized, envVersion)) {
    return normalized;
  }

  safeRemoveStorage(key);
  return '';
}

function getPreferredHttpBaseUrl() {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return '';
  }

  return (
    readStoredBaseUrl(CUSTOM_HTTP_BASE_URL_KEY, isAllowedHttpBaseUrl, normalizeHttpBaseUrl, envVersion) ||
    readStoredBaseUrl(WORKING_HTTP_BASE_URL_KEY, isAllowedHttpBaseUrl, normalizeHttpBaseUrl, envVersion) ||
    getDefaultHttpBaseUrl(envVersion)
  );
}

function getHttpBaseUrls() {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return [];
  }

  return unique([
    readStoredBaseUrl(CUSTOM_HTTP_BASE_URL_KEY, isAllowedHttpBaseUrl, normalizeHttpBaseUrl, envVersion),
    readStoredBaseUrl(WORKING_HTTP_BASE_URL_KEY, isAllowedHttpBaseUrl, normalizeHttpBaseUrl, envVersion),
    getDefaultHttpBaseUrl(envVersion),
    ...getBackupHttpBaseUrls(envVersion)
  ]);
}

function getWsBaseUrls() {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return [];
  }

  const storedHttpBaseUrl =
    readStoredBaseUrl(CUSTOM_HTTP_BASE_URL_KEY, isAllowedHttpBaseUrl, normalizeHttpBaseUrl, envVersion) ||
    readStoredBaseUrl(WORKING_HTTP_BASE_URL_KEY, isAllowedHttpBaseUrl, normalizeHttpBaseUrl, envVersion);

  return unique([
    readStoredBaseUrl(CUSTOM_WS_BASE_URL_KEY, isAllowedWsBaseUrl, normalizeWsBaseUrl, envVersion),
    readStoredBaseUrl(WORKING_WS_BASE_URL_KEY, isAllowedWsBaseUrl, normalizeWsBaseUrl, envVersion),
    storedHttpBaseUrl ? toWsBaseUrl(storedHttpBaseUrl) : '',
    getDefaultWsBaseUrl(envVersion),
    ...getBackupWsBaseUrls(envVersion)
  ]);
}

function rememberWorkingHttpBaseUrl(httpBaseUrl) {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return;
  }

  const normalized = normalizeHttpBaseUrl(httpBaseUrl);

  if (!isAllowedHttpBaseUrl(normalized, envVersion)) {
    return;
  }

  safeSetStorage(WORKING_HTTP_BASE_URL_KEY, normalized);

  const normalizedWsBaseUrl = normalizeWsBaseUrl(toWsBaseUrl(normalized));

  if (isAllowedWsBaseUrl(normalizedWsBaseUrl, envVersion)) {
    safeSetStorage(WORKING_WS_BASE_URL_KEY, normalizedWsBaseUrl);
  }
}

function setCustomHttpBaseUrl(httpBaseUrl) {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return '';
  }

  const normalized = normalizeHttpBaseUrl(httpBaseUrl);

  if (!isAllowedHttpBaseUrl(normalized, envVersion)) {
    return '';
  }

  safeSetStorage(CUSTOM_HTTP_BASE_URL_KEY, normalized);

  const normalizedWsBaseUrl = normalizeWsBaseUrl(toWsBaseUrl(normalized));

  if (!isAllowedWsBaseUrl(normalizedWsBaseUrl, envVersion)) {
    return '';
  }

  safeSetStorage(CUSTOM_WS_BASE_URL_KEY, normalizedWsBaseUrl);
  return normalized;
}

function clearCustomHttpBaseUrl() {
  safeRemoveStorage(CUSTOM_HTTP_BASE_URL_KEY);
  safeRemoveStorage(CUSTOM_WS_BASE_URL_KEY);
}

function resetStoredBaseUrls() {
  clearCustomHttpBaseUrl();
  safeRemoveStorage(WORKING_HTTP_BASE_URL_KEY);
  safeRemoveStorage(WORKING_WS_BASE_URL_KEY);
}

function rememberWorkingWsBaseUrl(wsBaseUrl) {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return;
  }

  const normalized = normalizeWsBaseUrl(wsBaseUrl);

  if (!isAllowedWsBaseUrl(normalized, envVersion)) {
    return;
  }

  safeSetStorage(WORKING_WS_BASE_URL_KEY, normalized);
}

function getSuggestedHttpBaseUrls() {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return [];
  }

  return unique([
    getDefaultHttpBaseUrl(envVersion),
    ...getBackupHttpBaseUrls(envVersion)
  ]);
}

function buildHttpBaseUrlCandidates(manualBaseUrl) {
  const envVersion = getMiniProgramEnvVersion();

  if (shouldUseCloudContainer(envVersion)) {
    return [];
  }

  return unique([
    normalizeHttpBaseUrl(manualBaseUrl),
    ...getHttpBaseUrls()
  ]).filter((item) => isAllowedHttpBaseUrl(item, envVersion));
}

function getBackendRuntimeProfile() {
  const envVersion = getMiniProgramEnvVersion();
  const strictNetwork = isStrictNetworkEnv(envVersion);
  const usesCloudContainer = shouldUseCloudContainer(envVersion);
  const defaultHttpBaseUrl = getDefaultHttpBaseUrl(envVersion);
  const defaultWsBaseUrl = getDefaultWsBaseUrl(envVersion);
  const cloudTarget = getCloudContainerTarget();

  return {
    envVersion,
    strictNetwork,
    usesCloudContainer,
    allowManualUrl: !usesCloudContainer,
    cloudTarget,
    cloudEnvId: String(CLOUDBASE_ENV_ID || '').trim(),
    cloudServiceName: String(CLOUDBASE_SERVICE_NAME || '').trim(),
    defaultHttpBaseUrl,
    defaultWsBaseUrl,
    suggestionHttpBaseUrls: getSuggestedHttpBaseUrls(),
    needsProductionConfig: strictNetwork && !usesCloudContainer && (!defaultHttpBaseUrl || !defaultWsBaseUrl),
    sectionTitle: usesCloudContainer ? '云托管后端' : (strictNetwork ? '后端连接' : '开发后端连接'),
    desc: usesCloudContainer
      ? '当前正式环境会直接通过微信云托管访问后端，不需要再单独配置 request/socket 通讯域名。'
      : (
        strictNetwork
          ? '体验版和正式版只会连接你配置的公网 HTTPS/WSS 后端，不会连接本机、localhost 或局域网地址。'
          : '开发版可以连接本机后端做调试，但如果你想真机长期可用，仍然应该准备固定后端地址。'
      ),
    placeholder: strictNetwork ? '例如 https://api.example.com' : '例如 http://127.0.0.1:8787',
    tip: usesCloudContainer
      ? `云环境：${String(CLOUDBASE_ENV_ID || '').trim() || '未填写'}；服务名：${String(CLOUDBASE_SERVICE_NAME || '').trim() || '未填写'}`
      : (
        strictNetwork
          ? '请先在 miniprogram/utils/config.js 中填写正式 HTTPS/WSS 域名，并在微信小程序后台配置 request/socket 合法域名。'
          : '本地调试可运行 backend 服务；如果不想每次手动启动，请安装 backend/scripts 里的 Windows 自启动任务。'
      )
  };
}

function probeHttpBaseUrl(baseUrl, timeout = 1200) {
  return new Promise((resolve) => {
    if (!baseUrl) {
      resolve({ ok: false, baseUrl: '', error: '地址为空' });
      return;
    }

    wx.request({
      url: `${baseUrl}/health`,
      method: 'GET',
      timeout,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.ok) {
          rememberWorkingHttpBaseUrl(baseUrl);
          resolve({ ok: true, baseUrl, label: baseUrl, data: response.data });
          return;
        }

        resolve({ ok: false, baseUrl, label: baseUrl, error: `HTTP ${response.statusCode}` });
      },
      fail(error) {
        resolve({
          ok: false,
          baseUrl,
          label: baseUrl,
          error: error && error.errMsg ? error.errMsg : 'request:fail'
        });
      }
    });
  });
}

async function probeAvailableHttpBaseUrl(baseUrls = getHttpBaseUrls()) {
  const candidates = unique(baseUrls);
  const results = await Promise.all(candidates.map((baseUrl) => probeHttpBaseUrl(baseUrl)));

  for (const result of results) {

    if (result.ok) {
      return result;
    }
  }

  return {
    ok: false,
    baseUrl: candidates[0] || '',
    label: candidates[0] || '',
    error: results.map((item) => `${item.baseUrl || '空地址'}：${item.error || '不可用'}`).join('；') || '全部候选地址都不可用'
  };
}

async function probeBackendAvailability(baseUrls) {
  if (shouldUseCloudContainer()) {
    return probeCloudContainer();
  }

  return probeAvailableHttpBaseUrl(baseUrls);
}

module.exports = {
  buildHttpBaseUrlCandidates,
  clearCustomHttpBaseUrl,
  getBackendRuntimeProfile,
  getHttpBaseUrls,
  getMiniProgramEnvVersion,
  getPreferredHttpBaseUrl,
  getSuggestedHttpBaseUrls,
  getWsBaseUrls,
  isStrictNetworkEnv,
  normalizeHttpBaseUrl,
  probeAvailableHttpBaseUrl,
  probeBackendAvailability,
  probeHttpBaseUrl,
  rememberWorkingHttpBaseUrl,
  rememberWorkingWsBaseUrl,
  resetStoredBaseUrls,
  setCustomHttpBaseUrl,
  shouldUseCloudContainer
};
