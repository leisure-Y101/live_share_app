# 微信云开发甩手掌柜版

你只需要准备 1 个信息：微信云开发环境 ID。

## 你要给我的信息

请把微信云开发环境 ID 发给我，格式通常像：

```text
cloud1-xxxxxx
```

如果你不知道在哪里看：

1. 打开微信开发者工具。
2. 顶部点击“云开发”。
3. 进入云开发控制台。
4. 左上角或“环境”页面复制“环境 ID”。

## 我已经配置好的内容

- 后端 Docker 镜像配置：`backend/Dockerfile`
- 微信云托管部署配置：`cloudbaserc.json`
- 小程序云托管调用适配：`miniprogram/utils/cloud.js`
- 体验版 / 正式版优先走云托管：`miniprogram/utils/server.js`
- 一键填 ID 脚本：`scripts/configure-wechat-cloud.ps1`
- 一键登录并部署脚本：`scripts/deploy-wechat-cloud.ps1`

## 拿到环境 ID 后执行

把下面命令里的 `cloud1-xxxxxx` 换成你的真实环境 ID：

```powershell
cd D:\codexproject\live-location-share-app
powershell.exe -ExecutionPolicy Bypass -File .\scripts\deploy-wechat-cloud.ps1 -EnvId cloud1-xxxxxx
```

过程中如果出现二维码，用微信扫码确认。

## 部署完成后你要点哪里

1. 打开微信开发者工具。
2. 导入项目目录：`D:\codexproject\live-location-share-app`。
3. 确认 AppID 是：`wx449998951cb3d000`。
4. 点击右上角“上传”。
5. 打开微信公众平台，把刚上传的版本设为体验版。
6. 手机微信扫码体验。

## 默认后端说明

当前云托管默认用内存存储：

```env
STORAGE_DRIVER=memory
```

这适合先扫码体验。云托管实例重启后，房间数据会清空，但不影响重新创建房间体验。

如果以后要长期保存数据，再把云托管环境变量改为 MySQL。

