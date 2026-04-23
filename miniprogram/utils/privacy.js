const PRIVACY_CONTACT_EMAIL = '2196772872@qq.com';
const LOCATION_RETENTION_TEXT = '当前位置仅在共享期间保存；点击“停止共享并删除”、离开房间或连接断开超时后立即删除，最迟不超过 60 秒完成清理。';
const SECURITY_LOG_RETENTION_TEXT = '必要的网络与安全日志保留 30 天，仅用于安全审计。';
const THIRD_PARTY_SERVICE_TEXT = '地图底图由微信小程序 map 地图组件提供；当前示例的房间与实时同步服务由开发者自建 Node 服务提供，未额外接入第三方云服务商。';
const WITHDRAW_LOCATION_PATH_TEXT = '微信内可通过本小程序右上角“...” > 设置 > 位置信息关闭授权；如需立即移除当前位置，请在小程序内点击“停止共享并删除”。';
const ENTRY_CONFIRM_CONTENT = [
  '进入房间后，只有在你继续同意微信隐私保护指引并开启定位权限时，才会开始向当前房间成员共享当前位置。',
  '共享仅对当前房间成员可见，不对房间外公开；我们不保存历史轨迹，只保留共享中的当前位置。',
  LOCATION_RETENTION_TEXT
].join('\n');

module.exports = {
  ENTRY_CONFIRM_CONTENT,
  LOCATION_RETENTION_TEXT,
  PRIVACY_CONTACT_EMAIL,
  SECURITY_LOG_RETENTION_TEXT,
  THIRD_PARTY_SERVICE_TEXT,
  WITHDRAW_LOCATION_PATH_TEXT
};
