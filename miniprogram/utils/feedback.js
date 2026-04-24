'use strict';

const MODAL_CONFIRM_COLOR = '#2563eb';
const MODAL_DANGER_COLOR = '#dc2626';

function toast(title, options = {}) {
  if (!title) {
    return;
  }

  wx.showToast({
    title,
    icon: options.icon || 'none',
    duration: options.duration || 2200,
    mask: Boolean(options.mask)
  });
}

function success(title, options = {}) {
  toast(title, {
    ...options,
    icon: 'success',
    duration: options.duration || 1600
  });
}

function alert({ title, content, confirmText = '知道了' }) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      confirmColor: MODAL_CONFIRM_COLOR,
      showCancel: false,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function confirm({ title, content, confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText,
      confirmColor: danger ? MODAL_DANGER_COLOR : MODAL_CONFIRM_COLOR,
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    });
  });
}

function actionSheet(itemList, itemColor = '#0f172a') {
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList,
      itemColor,
      success: (result) => resolve(result.tapIndex),
      fail: () => resolve(-1)
    });
  });
}

module.exports = {
  actionSheet,
  alert,
  confirm,
  success,
  toast
};
