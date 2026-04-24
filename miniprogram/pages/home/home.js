'use strict';

const { request } = require('../../utils/request');
const feedback = require('../../utils/feedback');
const {
  buildHttpBaseUrlCandidates,
  getBackendRuntimeProfile,
  getPreferredHttpBaseUrl,
  probeBackendAvailability,
  resetStoredBaseUrls,
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
    backendStatusText: '正在检测后端连接',
    backendStatusKind: 'checking',
    backendBaseUrlInput: '',
    backendPanelOpen: false,
    backendSuggestions: [],
    backendSectionTitle: '后端连接',
    backendDesc: '',
    backendPlaceholder: '',
    backendTip: '',
    backendUsesCloudContainer: false,
    backendTargetLabel: ''
  },

  onLoad(options) {
    const cachedName = wx.getStorageSync('displayName');
    const inviteCode = options && options.inviteCode ? String(options.inviteCode).toUpperCase() : '';
    const leaveCleanupNotice = wx.getStorageSync('leaveCleanupNotice');
    const backendProfile = getBackendRuntimeProfile();
    const preferredBackendBaseUrl = getPreferredHttpBaseUrl();

    this.setData({
      displayName: cachedName || '',
      inviteCode,
      backendBaseUrlInput: preferredBackendBaseUrl,
      backendSuggestions: backendProfile.suggestionHttpBaseUrls,
      backendSectionTitle: backendProfile.sectionTitle,
      backendDesc: backendProfile.desc,
      backendPlaceholder: backendProfile.placeholder,
      backendTip: backendProfile.tip,
      backendUsesCloudContainer: backendProfile.usesCloudContainer,
      backendTargetLabel: backendProfile.cloudTarget
    });

    if (leaveCleanupNotice) {
      wx.removeStorageSync('leaveCleanupNotice');
      feedback.toast(leaveCleanupNotice, { duration: 2400 });
    }

    if (backendProfile.usesCloudContainer && !backendProfile.cloudServiceName) {
      this.setData({
        backendStatusKind: 'error',
        backendStatusText: '未填写云托管服务名'
      });
      return;
    }

    if (backendProfile.needsProductionConfig && !preferredBackendBaseUrl) {
      this.setData({
        backendStatusKind: 'error',
        backendStatusText: '未配置正式后端地址'
      });
      return;
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
    const backendProfile = getBackendRuntimeProfile();

    this.setData({
      backendSectionTitle: backendProfile.sectionTitle,
      backendDesc: backendProfile.desc,
      backendPlaceholder: backendProfile.placeholder,
      backendTip: backendProfile.tip,
      backendSuggestions: backendProfile.suggestionHttpBaseUrls,
      backendUsesCloudContainer: backendProfile.usesCloudContainer,
      backendTargetLabel: backendProfile.cloudTarget
    });

    if (backendProfile.usesCloudContainer) {
      if (!backendProfile.cloudServiceName) {
        this.setData({
          backendStatusKind: 'error',
          backendStatusText: '未填写云托管服务名'
        });
        return {
          ok: false,
          label: '',
          error: 'missing-cloud-service-name'
        };
      }

      this.setData({
        backendStatusKind: 'checking',
        backendStatusText: '正在检测云托管连接'
      });

      const result = await probeBackendAvailability();

      if (result.ok) {
        this.setData({
          backendStatusKind: 'ok',
          backendStatusText: `已连接：${result.label || backendProfile.cloudTarget}`,
          backendTargetLabel: result.label || backendProfile.cloudTarget
        });
        return result;
      }

      this.setData({
        backendStatusKind: 'error',
        backendStatusText: '未连接，请检查云托管服务部署'
      });
      return result;
    }

    const manualBaseUrl = typeof preferredBaseUrl === 'string' ? preferredBaseUrl : this.data.backendBaseUrlInput;
    const checkedCandidates = buildHttpBaseUrlCandidates(manualBaseUrl);

    if (!checkedCandidates.length) {
      this.setData({
        backendStatusKind: 'error',
        backendStatusText: backendProfile.needsProductionConfig ? '未配置正式后端地址' : '未找到可用的后端地址'
      });

      return {
        ok: false,
        baseUrl: '',
        label: '',
        error: backendProfile.needsProductionConfig ? 'missing-production-backend' : 'no-backend-candidates'
      };
    }

    this.setData({
      backendStatusKind: 'checking',
      backendStatusText: '正在检测后端连接'
    });

    const result = await probeBackendAvailability(checkedCandidates);

    if (result.ok) {
      this.setData({
        backendStatusKind: 'ok',
        backendStatusText: `已连接：${result.label || result.baseUrl}`,
        backendBaseUrlInput: result.baseUrl || this.data.backendBaseUrlInput
      });
      return result;
    }

    this.setData({
      backendStatusKind: 'error',
      backendStatusText: backendProfile.strictNetwork ? '未连接，请检查正式后端与域名配置' : '未连接，请先启动后端或切换地址'
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

    const backendProfile = getBackendRuntimeProfile();

    feedback.alert({
      title: backendProfile.usesCloudContainer
        ? '云托管未连接'
        : (backendProfile.needsProductionConfig ? '正式后端未配置' : '后端未连接'),
      content: backendProfile.usesCloudContainer
        ? '请确认微信云开发环境、云托管服务名和容器部署状态正确，并确保 /health 接口返回正常。'
        : (
          backendProfile.needsProductionConfig
            ? '请先在 miniprogram/utils/config.js 中填写正式 HTTPS/WSS 域名，并在微信小程序后台配置 request/socket 合法域名。'
            : (
              backendProfile.strictNetwork
                ? '请确认正式后端可以从公网访问，并且 /health 接口返回正常。'
                : `请先确认 backend 服务已经运行，并在“后端连接”中点“恢复默认”。当前检测结果：${result.error || '全部候选地址都不可用'}`
            )
        )
    });
    return false;
  },

  async saveBackendBaseUrl() {
    if (this.data.backendUsesCloudContainer) {
      await this.checkBackendStatus();
      return;
    }

    const normalized = setCustomHttpBaseUrl(this.data.backendBaseUrlInput);

    if (!normalized) {
      const backendProfile = getBackendRuntimeProfile();
      feedback.toast(backendProfile.strictNetwork ? '请输入正确的 HTTPS 后端地址' : '请输入正确的后端地址');
      return;
    }

    this.setData({
      backendBaseUrlInput: normalized
    });

    const result = await this.checkBackendStatus(normalized);

    if (!result.ok) {
      feedback.toast(result.error || '这个地址暂时连不上');
    }
  },

  async useSuggestedBackend(event) {
    if (this.data.backendUsesCloudContainer) {
      return;
    }

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
    if (this.data.backendUsesCloudContainer) {
      await this.checkBackendStatus();
      return;
    }

    resetStoredBaseUrls();

    const backendProfile = getBackendRuntimeProfile();
    const preferredBackendBaseUrl = getPreferredHttpBaseUrl();

    this.setData({
      backendBaseUrlInput: preferredBackendBaseUrl,
      backendSuggestions: backendProfile.suggestionHttpBaseUrls
    });

    if (backendProfile.needsProductionConfig && !preferredBackendBaseUrl) {
      this.setData({
        backendStatusKind: 'error',
        backendStatusText: '未配置正式后端地址'
      });
      return;
    }

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

    feedback.alert({
      title: '进入房间前请先确认',
      content: '请先阅读共享前告知，并点击“我已知晓，继续”后再创建或加入房间。'
    });
    return false;
  },

  confirmEntryNotice() {
    if (!this.data.canEnterRoom) {
      feedback.toast('请先完成上面的两项确认');
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
    feedback.confirm({
      title: '确认退出',
      content: '如果你现在不同意位置共享告知，可以退出小程序，稍后再进入。',
      confirmText: '退出',
      cancelText: '返回',
      danger: true
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }

      if (typeof wx.exitMiniProgram === 'function') {
        wx.exitMiniProgram();
        return;
      }

      feedback.toast('请关闭当前页面');
    });
  },

  copyPrivacyEmail() {
    wx.setClipboardData({
      data: this.data.privacyContactEmail,
      success: () => feedback.success('联系邮箱已复制')
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
      feedback.alert({ title: '创建失败', content: error.message });
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
      feedback.toast('请输入 6 位邀请码');
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
      feedback.alert({ title: '加入失败', content: error.message });
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
