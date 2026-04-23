const { BASE_URL, BACKUP_BASE_URLS, WS_BASE_URL, BACKUP_WS_BASE_URLS } = require('./config');

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

function toWsBaseUrl(httpBaseUrl) {
  return String(httpBaseUrl || '').replace(/^http/i, 'ws');
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

function getPreferredHttpBaseUrl() {
  return safeGetStorage(CUSTOM_HTTP_BASE_URL_KEY) || safeGetStorage(WORKING_HTTP_BASE_URL_KEY) || BASE_URL;
}

function getHttpBaseUrls() {
  return unique([
    safeGetStorage(CUSTOM_HTTP_BASE_URL_KEY),
    safeGetStorage(WORKING_HTTP_BASE_URL_KEY),
    BASE_URL,
    ...BACKUP_BASE_URLS
  ]);
}

function getWsBaseUrls() {
  const storedHttpBaseUrl = safeGetStorage(CUSTOM_HTTP_BASE_URL_KEY) || safeGetStorage(WORKING_HTTP_BASE_URL_KEY);

  return unique([
    safeGetStorage(CUSTOM_WS_BASE_URL_KEY),
    safeGetStorage(WORKING_WS_BASE_URL_KEY),
    storedHttpBaseUrl ? toWsBaseUrl(storedHttpBaseUrl) : '',
    WS_BASE_URL,
    ...BACKUP_WS_BASE_URLS
  ]);
}

function rememberWorkingHttpBaseUrl(httpBaseUrl) {
  safeSetStorage(WORKING_HTTP_BASE_URL_KEY, httpBaseUrl);
  safeSetStorage(WORKING_WS_BASE_URL_KEY, toWsBaseUrl(httpBaseUrl));
}

function setCustomHttpBaseUrl(httpBaseUrl) {
  const normalized = normalizeHttpBaseUrl(httpBaseUrl);

  if (!normalized) {
    return '';
  }

  safeSetStorage(CUSTOM_HTTP_BASE_URL_KEY, normalized);
  safeSetStorage(CUSTOM_WS_BASE_URL_KEY, toWsBaseUrl(normalized));
  return normalized;
}

function clearCustomHttpBaseUrl() {
  try {
    wx.removeStorageSync(CUSTOM_HTTP_BASE_URL_KEY);
    wx.removeStorageSync(CUSTOM_WS_BASE_URL_KEY);
  } catch (error) {
    // Ignore storage cleanup failures during development.
  }
}

function rememberWorkingWsBaseUrl(wsBaseUrl) {
  safeSetStorage(WORKING_WS_BASE_URL_KEY, wsBaseUrl);
}

function probeHttpBaseUrl(baseUrl, timeout = 2500) {
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
          resolve({ ok: true, baseUrl, data: response.data });
          return;
        }

        resolve({ ok: false, baseUrl, error: `HTTP ${response.statusCode}` });
      },
      fail(error) {
        resolve({
          ok: false,
          baseUrl,
          error: error && error.errMsg ? error.errMsg : 'request:fail'
        });
      }
    });
  });
}

async function probeAvailableHttpBaseUrl(baseUrls = getHttpBaseUrls()) {
  for (const baseUrl of unique(baseUrls)) {
    const result = await probeHttpBaseUrl(baseUrl);

    if (result.ok) {
      return result;
    }
  }

  return {
    ok: false,
    baseUrl: unique(baseUrls)[0] || '',
    error: '全部候选地址都不可用'
  };
}

module.exports = {
  clearCustomHttpBaseUrl,
  getHttpBaseUrls,
  getPreferredHttpBaseUrl,
  getWsBaseUrls,
  normalizeHttpBaseUrl,
  probeAvailableHttpBaseUrl,
  probeHttpBaseUrl,
  rememberWorkingHttpBaseUrl,
  rememberWorkingWsBaseUrl,
  setCustomHttpBaseUrl
};
