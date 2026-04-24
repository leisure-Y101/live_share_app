'use strict';

const { callContainer, getResponseStatusCode } = require('./cloud');
const { getHttpBaseUrls, rememberWorkingHttpBaseUrl, shouldUseCloudContainer } = require('./server');

const REQUEST_TIMEOUT_MS = 4000;

function isRetriableNetworkError(error) {
  const message = String((error && error.errMsg) || (error && error.message) || '').toLowerCase();
  return message.includes('timeout') || message.includes('fail') || message.includes('connect');
}

function buildNetworkErrorMessage(path, attemptedUrls, error) {
  const originalMessage = String((error && error.errMsg) || (error && error.message) || '网络请求失败');
  return [
    `连接后端失败：${originalMessage}`,
    `已尝试：${attemptedUrls.join('、')}`,
    '请确认当前后端地址可从你的网络环境访问，并且已在微信小程序后台配置 request/socket 合法域名。'
  ].join('\n');
}

async function requestWithCloudContainer(path, method = 'GET', data) {
  try {
    const response = await callContainer(path, method, data, REQUEST_TIMEOUT_MS);
    const statusCode = getResponseStatusCode(response);

    if (statusCode >= 200 && statusCode < 300) {
      return response.data;
    }

    throw new Error(
      response && response.data && response.data.error
        ? response.data.error
        : `请求失败：${statusCode || 'unknown'}`
    );
  } catch (error) {
    throw new Error(String((error && error.message) || (error && error.errMsg) || '云托管请求失败'));
  }
}

function requestWithHttpFallback(path, method = 'GET', data) {
  const baseUrls = getHttpBaseUrls();
  const attemptedUrls = [];

  function tryNext(index) {
    if (index >= baseUrls.length) {
      return Promise.reject(new Error('后端地址未配置。'));
    }

    const baseUrl = baseUrls[index];
    const fullUrl = `${baseUrl}${path}`;
    attemptedUrls.push(fullUrl);

    return new Promise((resolve, reject) => {
      wx.request({
        url: fullUrl,
        method,
        data,
        timeout: REQUEST_TIMEOUT_MS,
        header: {
          'content-type': 'application/json'
        },
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            rememberWorkingHttpBaseUrl(baseUrl);
            resolve(response.data);
            return;
          }

          reject(
            new Error(
              response.data && response.data.error
                ? response.data.error
                : `请求失败：${response.statusCode}`
            )
          );
        },
        fail(error) {
          reject(error);
        }
      });
    }).catch((error) => {
      if (isRetriableNetworkError(error) && index + 1 < baseUrls.length) {
        return tryNext(index + 1);
      }

      if (isRetriableNetworkError(error)) {
        throw new Error(buildNetworkErrorMessage(path, attemptedUrls, error));
      }

      throw new Error(error.message || '网络请求失败');
    });
  }

  return tryNext(0);
}

function request(path, method = 'GET', data) {
  if (shouldUseCloudContainer()) {
    return requestWithCloudContainer(path, method, data);
  }

  return requestWithHttpFallback(path, method, data);
}

module.exports = {
  request
};
