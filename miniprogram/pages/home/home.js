const { request } = require('../../utils/request');
const { BASE_URL, BACKUP_BASE_URLS } = require('../../utils/config');
const {
  clearCustomHttpBaseUrl,
  getPreferredHttpBaseUrl,
  normalizeHttpBaseUrl,
  probeAvailableHttpBaseUrl,
  setCustomHttpBaseUrl
} = require('../../utils/server');
const {
  LOCATION_RETENTION_TEXT,
  PRIVACY_CONTACT_EMAIL,
  SECURITY_LOG_RETENTION_TEXT,
  THIRD_PARTY_SERVICE_TEXT,
  WITHDRAW_LOCATION_PATH_TEXT
} = require('../../utils/privacy');

Page({
  data: {
    displayName: '',
    inviteCode: '',
    loadingAction: '',
    entryNoticeAccepted: false,
    guardianConfirmed: false,
    entryNoticeConfirmed: false,
    canEnterRoom: false,
    privacyContactEmail: PRIVACY_CONTACT_EMAIL,
    needsRealPrivacyEmail: PRIVACY_CONTACT_EMAIL.includes('替换'),
    locationRetentionText: LOCATION_RETENTION_TEXT,
    securityLogRetentionText: SECURITY_LOG_RETENTION_TEXT,
    thirdPartyServiceText: THIRD_PARTY_SERVICE_TEXT,
    withdrawLocationPathText: WITHDRAW_LOCATION_PATH_TEXT,
    backendStatusText: '正在检测本地后端',
    backendStatusKind: 'checking',
    backendBaseUrlInput: '',
    backendPanelOpen: false,
    backendSuggestions: [BASE_URL, ...BACKUP_BASE_URLS]
  },

  onLoad(options) {
    const cachedName = wx.getStorageSync('displayName');
    const inviteCode = options && options.inviteCode ? String(options.inviteCode).toUpperCase() : '';
    const leaveCleanupNotice = wx.getStorageSync('leaveCleanupNotice');
    const preferredBackendBaseUrl = getPreferredHttpBaseUrl();

    this.setData({
      displayName: cachedName || '',
      inviteCode,
      backendBaseUrlInput: preferredBackendBaseUrl
    });

    if (leaveCleanupNotice) {
      wx.removeStorageSync('leaveCleanupNotice');
      wx.showToast({
        title: leaveCleanupNotice,
        icon: 'none',
        duration: 2400
      });
    }

    this.checkBackendStatus(preferredBackendBaseUrl);
  },

  handleDisplayNameInput(event) {
    this.setData({
      displayName: event.detail.value
    });
  },

  handleInviteCodeInput(event) {
    this.setData({
      inviteCode: String(event.detail.value || '').toUpperCase()
    });
  },

  handleBackendBaseUrlInput(event) {
    this.setData({
      backendBaseUrlInput: event.detail.value
    });
  },

  toggleBackendPanel() {
    this.setData({
      backendPanelOpen: !this.data.backendPanelOpen
    });
  },

  async checkBackendStatus(preferredBaseUrl) {
    const manualBaseUrl = typeof preferredBaseUrl === 'string' ? preferredBaseUrl : this.data.backendBaseUrlInput;
    const candidateBaseUrl = normalizeHttpBaseUrl(manualBaseUrl);
    const checkedCandidates = candidateBaseUrl
      ? [candidateBaseUrl, BASE_URL, ...BACKUP_BASE_URLS]
      : [BASE_URL, ...BACKUP_BASE_URLS];

    this.setData({
      backendStatusKind: 'checking',
      backendStatusText: '正在检测本地后端'
    });

    const result = await probeAvailableHttpBaseUrl(checkedCandidates);

    if (result.ok) {
      this.setData({
        backendStatusKind: 'ok',
        backendStatusText: `已连接：${result.baseUrl}`,
        backendBaseUrlInput: result.baseUrl
      });
      return result;
    }

    this.setData({
      backendStatusKind: 'error',
      backendStatusText: '未连接，请先启动本地后端或切换地址'
    });
    return result;
  },

  async ensureBackendAvailable() {
    const result = await this.checkBackendStatus();

    if (result.ok) {
      return true;
    }

    this.setData({
      backendPanelOpen: true
    });

    wx.showModal({
      title: '本地后端未连接',
      content: '请先在项目根目录运行 start-backend.cmd，或者把后端地址切到当前电脑可访问的局域网地址后再试。',
      showCancel: false
    });
    return false;
  },

  async saveBackendBaseUrl() {
    const normalized = setCustomHttpBaseUrl(this.data.backendBaseUrlInput);

    if (!normalized) {
      wx.showToast({
        title: '请输入正确的后端地址',
        icon: 'none'
      });
      return;
    }

    this.setData({
      backendBaseUrlInput: normalized
    });

    const result = await this.checkBackendStatus(normalized);

    if (!result.ok) {
      wx.showToast({
        title: '这个地址暂时连不上',
        icon: 'none'
      });
    }
  },

  async useSuggestedBackend(event) {
    const url = event.currentTarget.dataset.url;

    if (!url) {
      return;
    }

    this.setData({
      backendBaseUrlInput: url
    });

    await this.saveBackendBaseUrl();
  },

  async resetBackendBaseUrl() {
    clearCustomHttpBaseUrl();

    const preferredBackendBaseUrl = getPreferredHttpBaseUrl();

    this.setData({
      backendBaseUrlInput: preferredBackendBaseUrl
    });

    await this.checkBackendStatus(preferredBackendBaseUrl);
  },

  toggleEntryNoticeAccepted() {
    this.syncEntryGate({
      entryNoticeAccepted: !this.data.entryNoticeAccepted
    });
  },

  toggleGuardianConfirmed() {
    this.syncEntryGate({
      guardianConfirmed: !this.data.guardianConfirmed
    });
  },

  syncEntryGate(patch) {
    const nextEntryNoticeAccepted = Object.prototype.hasOwnProperty.call(patch, 'entryNoticeAccepted')
      ? patch.entryNoticeAccepted
      : this.data.entryNoticeAccepted;
    const nextGuardianConfirmed = Object.prototype.hasOwnProperty.call(patch, 'guardianConfirmed')
      ? patch.guardianConfirmed
      : this.data.guardianConfirmed;

    this.setData({
      ...patch,
      canEnterRoom: nextEntryNoticeAccepted && nextGuardianConfirmed
    });
  },

  ensureEntryConfirmed() {
    if (this.data.entryNoticeConfirmed) {
      return true;
    }

    wx.showModal({
      title: '进入房间前请先确认',
      content: '请先阅读共享前告知，并点击“我已知晓，继续”后再创建或加入房间。',
      showCancel: false
    });
    return false;
  },

  confirmEntryNotice() {
    if (!this.data.canEnterRoom) {
      wx.showToast({
        title: '请先完成上面的两项确认',
        icon: 'none'
      });
      return;
    }

    this.setData({
      entryNoticeConfirmed: true
    });
  },

  resetEntryNotice() {
    this.setData({
      entryNoticeConfirmed: false
    });
  },

  declineAndExit() {
    wx.showModal({
      title: '确认退出',
      content: '如果你现在不同意位置共享告知，可以退出小程序，稍后再进入。',
      confirmText: '退出',
      cancelText: '返回',
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        if (typeof wx.exitMiniProgram === 'function') {
          wx.exitMiniProgram();
          return;
        }

        wx.showToast({
          title: '请关闭当前页面',
          icon: 'none'
        });
      }
    });
  },

  copyPrivacyEmail() {
    wx.setClipboardData({
      data: this.data.privacyContactEmail
    });
  },

  async createRoom() {
    if (this.data.loadingAction) {
      return;
    }

    if (!this.ensureEntryConfirmed()) {
      return;
    }

    if (!(await this.ensureBackendAvailable())) {
      return;
    }

    this.setData({ loadingAction: 'create' });

    try {
      const response = await request('/api/rooms', 'POST', {
        displayName: this.data.displayName
      });

      this.saveSessionAndEnter(response);
    } catch (error) {
      wx.showModal({
        title: '创建失败',
        content: error.message,
        showCancel: false
      });
      this.setData({
        backendPanelOpen: true
      });
      this.checkBackendStatus();
    } finally {
      this.setData({ loadingAction: '' });
    }
  },

  async joinRoom() {
    if (this.data.loadingAction) {
      return;
    }

    if (!this.data.inviteCode || this.data.inviteCode.trim().length !== 6) {
      wx.showToast({
        title: '请输入 6 位邀请码',
        icon: 'none'
      });
      return;
    }

    if (!this.ensureEntryConfirmed()) {
      return;
    }

    if (!(await this.ensureBackendAvailable())) {
      return;
    }

    this.setData({ loadingAction: 'join' });

    try {
      const response = await request('/api/rooms/join', 'POST', {
        displayName: this.data.displayName,
        inviteCode: this.data.inviteCode
      });

      this.saveSessionAndEnter(response);
    } catch (error) {
      wx.showModal({
        title: '加入失败',
        content: error.message,
        showCancel: false
      });
      this.setData({
        backendPanelOpen: true
      });
      this.checkBackendStatus();
    } finally {
      this.setData({ loadingAction: '' });
    }
  },

  saveSessionAndEnter(response) {
    wx.setStorageSync('displayName', response.session.displayName);
    wx.setStorageSync('liveLocationSession', {
      room: response.room,
      session: response.session
    });

    wx.reLaunch({
      url: '/pages/room/room'
    });
  }
});
