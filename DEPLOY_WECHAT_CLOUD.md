# 微信云开发部署说明

## 适用方案

这个项目现在已经改成支持两种正式环境接入方式：

- 普通公网 `HTTPS/WSS`
- 微信云开发云托管 `callContainer/connectContainer`

如果你用的是微信云开发，优先用云托管。

## 1. 先登录 CloudBase CLI

在项目根目录执行：

```powershell
npm.cmd exec --package=@cloudbase/cli@3.2.2 -- tcb login
```

登录成功后可查看环境：

```powershell
npm.cmd exec --package=@cloudbase/cli@3.2.2 -- tcb env:list
```

## 2. 在小程序里填写云托管配置

修改 [config.js](/D:/codexproject/live-location-share-app/miniprogram/utils/config.js)：

```js
const CLOUDBASE_ENV_ID = '你的云环境ID';
const CLOUDBASE_SERVICE_NAME = '你的云托管服务名';
```

如果正式环境已经走云托管：

- `PRODUCTION_HTTP_BASE_URL` 可以留空
- `PRODUCTION_WS_BASE_URL` 可以留空

## 3. 创建云托管服务

在微信云开发控制台中创建一个云托管服务，推荐：

- 服务类型：容器服务
- 监听端口：`8787`
- 运行目录：`backend/`
- Dockerfile：`backend/Dockerfile`

## 4. 运行时环境变量

最少可先这样配：

```env
HOST=0.0.0.0
PORT=8787
STORAGE_DRIVER=memory
```

如果后面要接 MySQL，再继续补：

```env
STORAGE_DRIVER=mysql
DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=live_location_share
DB_AUTO_MIGRATE=true
```

## 5. 健康检查

健康检查路径：

```text
/health
```

如果云托管服务启动成功，这个接口应该返回：

```json
{
  "ok": true
}
```

## 6. 当前代码已经做好的适配

- 开发版继续走本地 `http://127.0.0.1:8787`
- 体验版 / 正式版如果填写了 `CLOUDBASE_SERVICE_NAME`，会优先走云托管
- 小程序请求会自动切到 `wx.cloud.callContainer`
- 房间 WebSocket 会自动切到 `wx.cloud.connectContainer`

## 7. 下一步

只要你完成 `tcb login`，并告诉我：

- 云环境 ID
- 云托管服务名

我就可以继续帮你把剩下的部署步骤接着做下去。
