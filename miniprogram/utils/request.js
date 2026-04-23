const { getHttpBaseUrls, rememberWorkingHttpBaseUrl } = require('./server');

const REQUEST_TIMEOUT_MS = 4000;

function isRetriableNetworkError(error) {
  const message = String((error && error.errMsg) || (error && error.message) || '').toLowerCase();
  return message.includes('timeout') || message.includes('fail') || message.includes('connect');
}

function buildNetworkErrorMessage(path, attemptedUrls, error) {
  const originalMessage = String((error && error.errMsg) || (error && error.message) || '网络请求失败');
  return [
    `连接本地后端失败：${originalMessage}`,
    `已尝试：${attemptedUrls.join('、')}`,
    '请确认微信开发者工具已重新编译，并且已勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。'
  ].join('\n');
}

function request(path, method = 'GET', data) {
  const baseUrls = getHttpBaseUrls();
  const attemptedUrls = [];

  function tryNext(index) {
    if (index >= baseUrls.length) {
      return Promise.reject(new Error('本地后端地址未配置。'));
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

          reject(new Error(response.data && response.data.error ? response.data.error : `请求失败：${response.statusCode}`));
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

module.exports = {
  request
};
