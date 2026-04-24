'use strict';

const { ensureCloudReady, isCloudContainerConfigured } = require('./utils/cloud');

App({
  onLaunch() {
    if (isCloudContainerConfigured()) {
      ensureCloudReady();
    }
  },

  globalData: {
    appName: '共享地图'
  }
});
