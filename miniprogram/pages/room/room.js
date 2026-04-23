const { request } = require('../../utils/request');
const { getWsBaseUrls, rememberWorkingWsBaseUrl } = require('../../utils/server');
const {
  LOCATION_RETENTION_TEXT,
  PRIVACY_CONTACT_EMAIL,
  THIRD_PARTY_SERVICE_TEXT,
  WITHDRAW_LOCATION_PATH_TEXT
} = require('../../utils/privacy');

const SOCKET_TIMEOUT_MS = 4000;

function formatNumber(number) {
  return Number(number).toFixed(6);
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '等待同步';
  }

  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

Page({
  data: {
    inviteCode: '',
    connectionStatus: '连接中',
    locationStatus: '等待授权',
    panelOpen: false,
    privacyContactEmail: PRIVACY_CONTACT_EMAIL,
    needsRealPrivacyEmail: PRIVACY_CONTACT_EMAIL.includes('替换'),
    locationRetentionText: LOCATION_RETENTION_TEXT,
    thirdPartyServiceText: THIRD_PARTY_SERVICE_TEXT,
    withdrawLocationPathText: WITHDRAW_LOCATION_PATH_TEXT,
    participants: [],
    markers: [],
    mapCenter: {
      latitude: 39.9042,
      longitude: 116.4074
    },
    mapScale: 14,
    lastSyncText: '等待同步'
  },

  onLoad() {
    const cached = wx.getStorageSync('liveLocationSession');

    if (!cached || !cached.room || !cached.session) {
      wx.reLaunch({
        url: '/pages/home/home'
      });
      return;
    }

    this.room = cached.room;
    this.session = cached.session;
    this.isLeaving = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastLocation = null;
    this.lastSentAt = 0;
    this.locationStarted = false;
    this.socketTask = null;
    this.socketConnectInFlight = false;
    this.socketErrorPrompted = false;
    this.mapContext = wx.createMapContext('liveMap', this);

    this.setData({
      inviteCode: this.session.inviteCode
    });

    this.connectSocket();
    this.prepareLocation();
  },

  onShow() {
    if (!this.isLeaving && !this.socketTask && this.session) {
      this.connectSocket();
    }
  },

  onUnload() {
    this.teardownRealtimeFeatures();
  },

  onShareAppMessage() {
    return {
      title: `加入我的共享地图房间（邀请码 ${this.session.inviteCode}）`,
      path: `/pages/home/home?inviteCode=${this.session.inviteCode}`
    };
  },

  prepareLocation() {
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      wx.requirePrivacyAuthorize({
        success: () => this.requestLocationPermission(),
        fail: () => {
          this.setData({
            locationStatus: '未通过隐私授权'
          });
        }
      });
      return;
    }

    this.requestLocationPermission();
  },

  requestLocationPermission() {
    wx.getSetting({
      success: (setting) => {
        if (setting.authSetting['scope.userLocation']) {
          this.startLocationUpdates();
          return;
        }

        wx.authorize({
          scope: 'scope.userLocation',
          success: () => this.startLocationUpdates(),
          fail: () => {
            this.setData({
              locationStatus: '定位权限未开启'
            });

            wx.showModal({
              title: '需要定位权限',
              content: '请先打开定位权限，房间内才能实时共享位置。',
              confirmText: '去设置',
              success: (result) => {
                if (result.confirm) {
                  wx.openSetting({
                    success: (openResult) => {
                      if (openResult.authSetting['scope.userLocation']) {
                        this.startLocationUpdates();
                      }
                    }
                  });
                }
              }
            });
          }
        });
      }
    });
  },

  startLocationUpdates() {
    if (this.locationStarted) {
      return;
    }

    wx.offLocationChange();
    wx.onLocationChange((location) => {
      this.handleLocationChange(location);
    });

    wx.startLocationUpdate({
      success: () => {
        this.locationStarted = true;
        this.setData({
          locationStatus: '实时共享中'
        });
      },
      fail: () => {
        this.setData({
          locationStatus: '定位启动失败'
        });
      }
    });
  },

  handleLocationChange(location) {
    const payload = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      speed: location.speed,
      heading: location.direction,
      timestamp: Date.now()
    };

    if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
      return;
    }

    this.lastLocation = payload;
    this.injectSelfLocation(payload);

    const now = Date.now();

    if (now - this.lastSentAt < 1500) {
      return;
    }

    this.lastSentAt = now;
    this.sendSocketMessage({
      type: 'location:update',
      payload
    });
  },

  connectSocket() {
    if (this.socketTask || this.socketConnectInFlight || !this.session) {
      return;
    }

    this.tryConnectSocket(getWsBaseUrls(), 0);
  },

  tryConnectSocket(baseUrls, index) {
    const baseUrl = baseUrls[index];

    if (!baseUrl) {
      this.socketTask = null;
      this.socketConnectInFlight = false;

      if (!this.isLeaving) {
        this.setData({
          connectionStatus: '连接失败，稍后重试'
        });
        this.showSocketConnectionHelp(baseUrls);
        this.scheduleReconnect();
      }
      return;
    }

    const socketUrl = `${baseUrl}/ws?roomId=${encodeURIComponent(this.session.roomId)}&participantId=${encodeURIComponent(this.session.participantId)}&token=${encodeURIComponent(this.session.token)}`;
    const socketTask = wx.connectSocket({
      url: socketUrl,
      timeout: SOCKET_TIMEOUT_MS
    });

    let opened = false;
    let switched = false;

    this.socketTask = socketTask;
    this.socketConnectInFlight = true;
    this.setData({
      connectionStatus: baseUrls.length > 1 ? `连接中（${index + 1}/${baseUrls.length}）` : '连接中'
    });

    const switchToNextCandidate = () => {
      if (opened || switched) {
        return;
      }

      switched = true;

      if (this.socketTask === socketTask) {
        this.socketTask = null;
      }

      try {
        socketTask.close({
          code: 1000,
          reason: 'switch-endpoint'
        });
      } catch (error) {
        // Ignore close errors while cycling local endpoints.
      }

      this.tryConnectSocket(baseUrls, index + 1);
    };

    socketTask.onOpen(() => {
      if (switched) {
        return;
      }

      opened = true;
      this.socketConnectInFlight = false;
      this.socketErrorPrompted = false;
      rememberWorkingWsBaseUrl(baseUrl);
      this.clearReconnectTimer();
      this.startHeartbeat();
      this.setData({
        connectionStatus: '已连接'
      });

      if (this.lastLocation) {
        this.sendSocketMessage({
          type: 'location:update',
          payload: this.lastLocation
        });
      }
    });

    socketTask.onMessage((event) => {
      this.handleSocketMessage(event.data);
    });

    socketTask.onClose(() => {
      if (!opened) {
        switchToNextCandidate();
        return;
      }

      if (this.socketTask === socketTask) {
        this.socketTask = null;
      }

      this.stopHeartbeat();
      this.socketConnectInFlight = false;

      if (!this.isLeaving) {
        this.setData({
          connectionStatus: '连接断开，正在重连'
        });
        this.scheduleReconnect();
      }
    });

    socketTask.onError(() => {
      if (!opened) {
        switchToNextCandidate();
        return;
      }

      this.setData({
        connectionStatus: '连接异常'
      });
    });
  },

  showSocketConnectionHelp(baseUrls) {
    if (this.socketErrorPrompted) {
      return;
    }

    this.socketErrorPrompted = true;

    wx.showModal({
      title: '连接本地后端失败',
      content: [
        `已尝试：${baseUrls.join('、')}`,
        '请确认本地后端正在运行，并在微信开发者工具里勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”后重新编译。'
      ].join('\n'),
      showCancel: false
    });
  },

  handleSocketMessage(rawMessage) {
    let message;

    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      return;
    }

    if (message.type === 'sync' || message.type === 'room:update') {
      this.room = message.payload.room;
      this.syncParticipants(message.payload.participants || []);
      return;
    }

    if (message.type === 'location:update') {
      this.mergeLocationUpdate(message.payload);
      return;
    }
  },

  syncParticipants(participants) {
    const decorated = participants
      .map((participant) => this.decorateParticipant(participant))
      .sort((left, right) => {
        if (left.isSelf) {
          return -1;
        }

        if (right.isSelf) {
          return 1;
        }

        return left.joinedAt - right.joinedAt;
      });

    const markers = decorated
      .filter((participant) => participant.location)
      .map((participant, index) => ({
        id: index + 1,
        latitude: participant.location.latitude,
        longitude: participant.location.longitude,
        iconPath: participant.isSelf ? '/assets/marker-self.png' : '/assets/marker-peer.png',
        width: 28,
        height: 28,
        callout: {
          content: participant.displayName,
          display: 'ALWAYS',
          color: '#0f172a',
          bgColor: '#ffffff',
          borderRadius: 16,
          padding: 8,
          fontSize: 12
        }
      }));

    const centerParticipant = decorated.find((item) => item.isSelf && item.location) || decorated.find((item) => item.location);

    this.setData({
      participants: decorated,
      markers,
      lastSyncText: formatTime(Date.now()),
      mapCenter: centerParticipant
        ? {
            latitude: centerParticipant.location.latitude,
            longitude: centerParticipant.location.longitude
          }
        : this.data.mapCenter
    });
  },

  decorateParticipant(participant) {
    const isSelf = participant.participantId === this.session.participantId;
    const hasLocation = Boolean(participant.location);

    return {
      ...participant,
      isSelf,
      locationText: hasLocation
        ? `经度 ${formatNumber(participant.location.longitude)} / 纬度 ${formatNumber(participant.location.latitude)}`
        : '暂未上传位置',
      stateText: participant.online ? `在线 · ${formatTime(participant.location && participant.location.updatedAt)}` : '暂时离线'
    };
  },

  mergeLocationUpdate(payload) {
    const participants = this.data.participants.slice();
    const targetIndex = participants.findIndex((item) => item.participantId === payload.participantId);
    const participant = this.decorateParticipant(payload);

    if (targetIndex >= 0) {
      participants.splice(targetIndex, 1, participant);
    } else {
      participants.push(participant);
    }

    this.syncParticipants(participants);
  },

  injectSelfLocation(location) {
    const participants = this.data.participants.slice();
    const targetIndex = participants.findIndex((item) => item.participantId === this.session.participantId);
    const payload = {
      participantId: this.session.participantId,
      displayName: this.session.displayName,
      joinedAt: targetIndex >= 0 ? participants[targetIndex].joinedAt : Date.now(),
      online: true,
      location: {
        latitude: Number(location.latitude.toFixed(6)),
        longitude: Number(location.longitude.toFixed(6)),
        accuracy: location.accuracy || null,
        speed: Number.isFinite(location.speed) ? location.speed : null,
        heading: Number.isFinite(location.heading) ? location.heading : null,
        timestamp: location.timestamp,
        updatedAt: Date.now()
      }
    };

    if (targetIndex >= 0) {
      participants.splice(targetIndex, 1, this.decorateParticipant(payload));
    } else {
      participants.unshift(this.decorateParticipant(payload));
    }

    this.syncParticipants(participants);
  },

  sendSocketMessage(message) {
    if (!this.socketTask) {
      return;
    }

    this.socketTask.send({
      data: JSON.stringify(message)
    });
  },

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendSocketMessage({
        type: 'heartbeat'
      });
    }, 10000);
  },

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  },

  scheduleReconnect() {
    if (this.reconnectTimer || this.isLeaving) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket();
    }, 3000);
  },

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.session.inviteCode
    });
  },

  togglePanel() {
    this.setData({
      panelOpen: !this.data.panelOpen
    });
  },

  closePanel() {
    if (!this.data.panelOpen) {
      return;
    }

    this.setData({
      panelOpen: false
    });
  },

  noop() {},

  centerOnSelf() {
    const selfParticipant = this.data.participants.find((item) => item.isSelf && item.location);

    if (!selfParticipant) {
      wx.showToast({
        title: '还没有拿到你的定位',
        icon: 'none'
      });
      return;
    }

    this.setData({
      mapCenter: {
        latitude: selfParticipant.location.latitude,
        longitude: selfParticipant.location.longitude
      },
      mapScale: 16
    });
  },

  confirmLeave() {
    this.closePanel();

    wx.showModal({
      title: '停止共享并删除',
      content: '继续后会退出当前房间、停止位置共享，并删除你在本房间中的当前位置。必要的网络与安全日志仍会按 30 天保留，仅用于安全审计。',
      confirmText: '停止共享',
      success: async (result) => {
        if (!result.confirm) {
          return;
        }

        await this.leaveRoom();
      }
    });
  },

  async leaveRoom() {
    if (this.isLeaving) {
      return;
    }

    this.isLeaving = true;
    this.teardownRealtimeFeatures();

    try {
      await request('/api/rooms/leave', 'POST', {
        roomId: this.session.roomId,
        participantId: this.session.participantId,
        token: this.session.token
      });
    } catch (error) {
      // 后端已经有超时清理逻辑，这里不阻断退出。
    }

    wx.setStorageSync('leaveCleanupNotice', '已停止共享并删除当前位置');
    wx.removeStorageSync('liveLocationSession');
    wx.reLaunch({
      url: '/pages/home/home'
    });
  },

  openLocationSettings() {
    this.closePanel();

    wx.openSetting({
      success: (result) => {
        if (result.authSetting['scope.userLocation']) {
          this.prepareLocation();
          return;
        }

        if (this.locationStarted) {
          wx.offLocationChange();
          wx.stopLocationUpdate({
            complete: () => {}
          });
          this.locationStarted = false;
        }

        this.setData({
          locationStatus: '定位权限已关闭'
        });

        wx.showModal({
          title: '定位授权已关闭',
          content: '如需立即从房间内移除当前位置，请继续点击“停止共享并删除”。',
          showCancel: false
        });
      }
    });
  },

  copyPrivacyEmail() {
    wx.setClipboardData({
      data: this.data.privacyContactEmail
    });
  },

  teardownRealtimeFeatures() {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.socketConnectInFlight = false;

    if (this.locationStarted) {
      wx.offLocationChange();
      wx.stopLocationUpdate({
        complete: () => {}
      });
      this.locationStarted = false;
    }

    if (this.socketTask) {
      try {
        this.socketTask.close({
          code: 1000,
          reason: 'page-closed'
        });
      } catch (error) {
        // ignore close errors
      }

      this.socketTask = null;
    }
  }
});
