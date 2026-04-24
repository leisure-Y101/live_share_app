# 后端未连接问题处理手册

本文用于处理小程序首页提示：

> 后端未连接，请先确认 backend 服务已经运行；如果不想每次手动启动，可以先执行 backend/scripts/install-startup-task.ps1 安装 Windows 登录自启动。

这不是识图助手问题，也不是前端页面渲染问题。它表示小程序请求 `http://127.0.0.1:8787/health` 超时或失败。

## 1. 当前项目的连接方式

开发版默认连接本机后端：

- HTTP：`http://127.0.0.1:8787`
- WebSocket：`ws://127.0.0.1:8787`
- 配置文件：`miniprogram/utils/config.js`
- 健康检查接口：`http://127.0.0.1:8787/health`

只有后端服务运行后，小程序才能创建房间、加入房间和实时共享位置。

## 2. 快速启动后端

在项目根目录执行：

```powershell
cd D:\codexproject\live-location-share-app
.\start-backend.cmd
```

或者：

```powershell
cd D:\codexproject\live-location-share-app\backend
npm start
```

启动成功后，终端会显示类似：

```text
Live location backend running on http://0.0.0.0:8787
```

注意：启动后不要关闭这个终端窗口；关闭窗口后后端也会停止。

## 3. 验证后端是否正常

打开新的 PowerShell 窗口执行：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

正常结果应包含：

```text
ok : True
```

也可以在浏览器打开：

```text
http://127.0.0.1:8787/health
```

能看到 JSON 且包含 `"ok":true` 就表示后端正常。

## 4. 微信开发者工具必须打开的设置

如果你使用本地 `http://127.0.0.1:8787` 调试，需要在微信开发者工具里开启本地调试放行：

1. 打开微信开发者工具。
2. 打开当前小程序项目。
3. 点击右上角「详情」。
4. 进入「本地设置」。
5. 勾选：
   - 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书
6. 点击「编译」或「清缓存并编译」。
7. 回到小程序首页，点击「检测连接」。

如果不勾选这项，开发者工具可能会拦截本地 `http` 和 `ws` 请求，页面就会显示后端未连接或 timeout。

## 5. 如果仍然提示 timeout

按顺序检查：

### 5.1 检查端口是否监听

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen
```

如果没有输出，说明后端没启动，回到第 2 步启动后端。

### 5.2 检查 8787 端口是否被别的程序占用

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object OwningProcess
```

再查看进程：

```powershell
Get-Process -Id <上一步看到的 PID>
```

如果不是当前项目的 `node`，可以关闭占用程序，或修改后端端口。

### 5.3 检查小程序配置

确认 `miniprogram/utils/config.js` 中开发地址是：

```js
const DEVELOPMENT_HTTP_BASE_URL = 'http://127.0.0.1:8787';
const DEVELOPMENT_WS_BASE_URL = 'ws://127.0.0.1:8787';
```

如果你改过端口，前后端端口必须保持一致。

### 5.4 清理小程序缓存

微信开发者工具中执行：

1. 点击「编译」旁边的下拉菜单。
2. 选择「清缓存」。
3. 选择「清除全部缓存」。
4. 再点击「编译」。

## 6. 设置 Windows 登录自动启动后端

如果不想每次手动运行后端，可以安装自启动任务。

在项目根目录执行：

```powershell
cd D:\codexproject\live-location-share-app\backend
npm run install:startup
```

安装后，Windows 登录时会自动运行：

```text
backend/scripts/run-backend.ps1
```

日志位置：

```text
backend/logs/service.out.log
backend/logs/service.err.log
```

取消自启动：

```powershell
cd D:\codexproject\live-location-share-app\backend
npm run uninstall:startup
```

## 7. 真机预览特别注意

如果你在手机上预览，小程序里的 `127.0.0.1` 指的是手机自己，不是电脑。

真机调试需要：

1. 手机和电脑连接同一个 Wi-Fi。
2. 查询电脑局域网 IP：

```powershell
ipconfig
```

找到类似 `192.168.x.x` 的 IPv4 地址。

3. 在小程序首页「后端连接」里填：

```text
http://你的电脑局域网IP:8787
```

例如：

```text
http://192.168.1.8:8787
```

4. Windows 防火墙允许 Node.js 或 8787 端口访问。

注意：体验版和正式版不能用本地 IP，必须部署 HTTPS/WSS 后端或微信云托管。

## 8. 常见现象对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 后端未连接 | 后端没启动 | 执行 `start-backend.cmd` |
| timeout | 请求被拦截或后端无响应 | 勾选开发者工具本地设置，检查 `/health` |
| 创建房间失败 | HTTP 接口不可用 | 先确认 `/health` 返回 `ok:true` |
| 地图页实时通道失败 | WebSocket 不通 | 检查 `ws://127.0.0.1:8787` 和开发者工具域名校验设置 |
| 手机预览失败 | 手机访问不到电脑的 `127.0.0.1` | 改用电脑局域网 IP |

## 9. 推荐日常启动流程

每天开发时按这个顺序：

1. 双击或运行 `start-backend.cmd`。
2. 浏览器打开 `http://127.0.0.1:8787/health`，确认 `ok:true`。
3. 打开微信开发者工具。
4. 确认「不校验合法域名」已勾选。
5. 点击「清缓存并编译」。
6. 首页点击「检测连接」。
7. 显示「已连接」后再创建或加入房间。

## 10. 如果电脑检测正常但微信开发者工具仍连不上

如果运行下面命令显示 `OK HTTP 200`，说明后端没有问题：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\diagnose-backend.ps1
```

此时通常是微信开发者工具缓存了错误地址，或开发者工具没有放行本地请求。按下面步骤处理：

### 10.1 先在小程序里恢复默认地址

1. 打开小程序首页。
2. 找到「后端连接」卡片。
3. 点击「配置地址」。
4. 点击「恢复默认」。
5. 点击「检测连接」。

如果你之前手动填过错误地址，小程序会优先使用缓存地址；「恢复默认」会清掉这些缓存。

### 10.2 手动填局域网地址

如果 `127.0.0.1` 在开发者工具里仍然超时，就手动填电脑局域网地址：

```text
http://192.168.31.210:8787
```

然后点击「保存并检测」。

本项目已把这个地址加入开发备用地址：

```js
const DEVELOPMENT_BACKUP_HTTP_BASE_URLS = [
  'http://localhost:8787',
  'http://192.168.31.210:8787'
];
```

### 10.3 微信开发者工具设置必须确认

开发者工具右上角：

```text
详情 -> 本地设置 -> 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书
```

勾选后执行：

```text
清缓存 -> 清除全部缓存 -> 编译
```

### 10.4 关闭代理/VPN 后重试

如果电脑开了代理、VPN、抓包工具，开发者工具可能把本地请求转发失败。请临时关闭：

- 系统代理
- VPN
- Charles/Fiddler/Clash 等抓包或代理工具

然后重新编译。

### 10.5 Windows 防火墙

如果使用 `192.168.31.210:8787`，需要允许 Node.js 通过 Windows 防火墙。

测试命令：

```powershell
Invoke-WebRequest -UseBasicParsing http://192.168.31.210:8787/health
```

如果电脑本机能访问但手机不能访问，通常是防火墙或手机电脑不在同一 Wi-Fi。
