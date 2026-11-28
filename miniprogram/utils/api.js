const { origin } = require('../config');
const tokenKey = 'kanbyMiniToken';
function api(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    if (
      !/^https:\/\/[^/]+$/.test(origin) ||
      !/^(auth|tasks)(\?|$)/.test(path)
    ) {
      reject(new Error('小程序地址配置无效'));
      return;
    }
    const token = wx.getStorageSync(tokenKey);
    wx.request({
      url: `${origin}/api/mini/${path}`,
      method,
      data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (
          response.statusCode === 401 &&
          wx.getStorageSync(tokenKey) === token
        )
          wx.removeStorageSync(tokenKey);
        reject(
          Object.assign(new Error(response.data?.error || '请求失败，请重试'), {
            status: response.statusCode,
          }),
        );
      },
      fail() {
        reject(new Error('网络连接失败，请检查网络后重试'));
      },
    });
  });
}
module.exports = { api, tokenKey };
