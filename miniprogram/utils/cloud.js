'use strict';

const {
  CLOUDBASE_ENV_ID,
  CLOUDBASE_SERVICE_NAME
} = require('./config');

const DEFAULT_TIMEOUT_MS = 4000;

let cloudInitialized = false;

function hasCloudCapability() {
  return Boolean(wx && wx.cloud && typeof wx.cloud.init === 'function');
}

function isCloudContainerConfigured() {
  return Boolean(String(CLOUDBASE_SERVICE_NAME || '').trim());
}

function getCloudContainerTarget() {
  const serviceName = String(CLOUDBASE_SERVICE_NAME || '').trim();
  const envId = String(CLOUDBASE_ENV_ID || '').trim();

  if (!serviceName) {
    return '';
  }

  return envId ? `${envId}/${serviceName}` : serviceName;
}

function ensureCloudReady() {
  if (!hasCloudCapability() || !isCloudContainerConfigured()) {
    return false;
  }

  if (!cloudInitialized) {
    const options = {
      traceUser: true
    };

    if (String(CLOUDBASE_ENV_ID || '').trim()) {
      options.env = String(CLOUDBASE_ENV_ID || '').trim();
    }

    wx.cloud.init(options);
    cloudInitialized = true;
  }

  return true;
}

function getResponseStatusCode(response) {
  const header = (response && response.header) || {};
  const upstreamStatusCode =
    header['x-cloudbase-upstream-status-code'] ||
    header['X-Cloudbase-Upstream-Status-Code'] ||
    header['X-CloudBase-Upstream-Status-Code'];

  const statusCode = Number(response && response.statusCode);

  if (Number.isFinite(statusCode) && statusCode > 0) {
    return statusCode;
  }

  const parsedUpstreamStatusCode = Number(upstreamStatusCode);
  return Number.isFinite(parsedUpstreamStatusCode) ? parsedUpstreamStatusCode : 0;
}

async function callContainer(path, method = 'GET', data, timeout = DEFAULT_TIMEOUT_MS) {
  if (!ensureCloudReady()) {
    throw new Error('微信云托管未配置。');
  }

  const options = {
    path,
    method,
    timeout,
    header: {
      'X-WX-SERVICE': String(CLOUDBASE_SERVICE_NAME || '').trim(),
      'content-type': 'application/json'
    }
  };

  if (data !== undefined) {
    options.data = data;
  }

  if (String(CLOUDBASE_ENV_ID || '').trim()) {
    options.config = {
      env: String(CLOUDBASE_ENV_ID || '').trim()
    };
  }

  return wx.cloud.callContainer(options);
}

async function probeCloudContainer(timeout = 2500) {
  const label = getCloudContainerTarget();

  if (!ensureCloudReady()) {
    return {
      ok: false,
      label,
      error: 'cloud-container-not-configured'
    };
  }

  try {
    const response = await callContainer('/health', 'GET', undefined, timeout);
    const statusCode = getResponseStatusCode(response);

    if (statusCode >= 200 && statusCode < 300 && response.data && response.data.ok) {
      return {
        ok: true,
        label,
        data: response.data
      };
    }

    return {
      ok: false,
      label,
      error: statusCode ? `HTTP ${statusCode}` : 'cloud-health-check-failed'
    };
  } catch (error) {
    return {
      ok: false,
      label,
      error: String((error && error.errMsg) || (error && error.message) || 'cloud-call-failed')
    };
  }
}

async function connectContainerSocket(path) {
  if (!ensureCloudReady()) {
    throw new Error('微信云托管未配置。');
  }

  const options = {
    service: String(CLOUDBASE_SERVICE_NAME || '').trim(),
    path
  };

  const result = await wx.cloud.connectContainer(options);
  return result && result.socketTask ? result.socketTask : result;
}

module.exports = {
  callContainer,
  connectContainerSocket,
  ensureCloudReady,
  getCloudContainerTarget,
  getResponseStatusCode,
  isCloudContainerConfigured,
  probeCloudContainer
};
