# 微信小程序实时位置共享

这是一个用于微信小程序的实时位置共享项目，包含：

- `miniprogram/`：小程序前端
- `backend/`：Node.js 后端服务

后端现在支持两种运行模式：

- `memory`：仅内存，适合本地联调
- `mysql`：MySQL 持久化，适合更接近实际可用的部署

## 先说清楚一件事

`Navicat Premium 16` 只是数据库管理工具，不是后端服务。

它能帮你：

- 连接 MySQL
- 查看和编辑表数据
- 导入 SQL

它不能替代：

- 小程序的 HTTP 接口服务
- WebSocket 实时通道
- 房间和成员状态同步逻辑

真正可用的链路必须是：

1. 小程序连接 Node.js 后端
2. Node.js 后端读写 MySQL
3. 你用 Navicat 管理 MySQL 数据

## 当前后端能力

- 房间创建 / 加入 / 离开
- WebSocket 实时位置同步
- 成员超时清理
- 安全审计日志
- MySQL 持久化当前房间和成员状态
- Windows 登录后自动启动后端

## 一、本地改成可持久化

### 1. 安装后端依赖

```powershell
cd D:\codexproject\live-location-share-app\backend
npm.cmd install
```

### 2. 配置 `.env`

将 `backend/.env.example` 复制为 `backend/.env`，推荐最少配置如下：

```env
STORAGE_DRIVER=mysql
HOST=0.0.0.0
PORT=8787

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的MySQL密码
DB_NAME=live_location_share
DB_AUTO_MIGRATE=true
```

说明：

- 只做联调时，可改成 `STORAGE_DRIVER=memory`
- 想在 Navicat 里看到持久化数据，就用 `mysql`

### 3. 建库

先在 MySQL 中创建数据库：

```sql
CREATE DATABASE live_location_share
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

然后二选一：

- 直接启动后端，让它自动建表（`DB_AUTO_MIGRATE=true`）
- 或者用 Navicat 导入 [schema.sql](/D:/codexproject/live-location-share-app/backend/sql/schema.sql)

## 二、后端不再每次手动点启动

### 方案 A：自动登录自启动

在 `backend` 目录执行：

```powershell
cd D:\codexproject\live-location-share-app\backend
npm.cmd run install:startup
```

这个脚本会按顺序尝试 3 种方式：

1. Windows 计划任务
2. 当前用户注册表自启动：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
3. 当前用户启动文件夹脚本

所以即使你的账号没有管理员权限，通常也能成功配置。

日志位置：

- `backend/logs/service.out.log`
- `backend/logs/service.err.log`

如果端口已经被已有后端占用，自启动脚本会自动跳过，避免重复拉起多个 Node 进程。

如果以后你想移除自启动：

```powershell
npm.cmd run uninstall:startup
```

### 方案 B：手动调试启动

```powershell
cd D:\codexproject\live-location-share-app\backend
node server.js
```

或者双击：

```text
start-backend.cmd
```

但这只是调试方式，不是长期可用方式。

## 三、小程序连接地址怎么配

### 开发版

开发者工具里默认会优先尝试：

- `http://127.0.0.1:8787`
- `http://localhost:8787`

这只适合同一台电脑上的开发者工具调试。

### 体验版 / 正式版

体验版和正式版必须使用公网 `HTTPS` / `WSS`。

请修改 [config.js](/D:/codexproject/live-location-share-app/miniprogram/utils/config.js)：

```js
const PRODUCTION_HTTP_BASE_URL = 'https://your-domain.com';
const PRODUCTION_WS_BASE_URL = 'wss://your-domain.com';
```

并在微信小程序后台配置：

- `request` 合法域名
- `socket` 合法域名

下面这些地址都不能作为真正可上线的小程序后端地址：

- `127.0.0.1`
- `localhost`
- `192.168.x.x`
- `10.x.x.x`

## 四、为什么你点击连接还是会失败

最常见原因不是 Navicat，而是下面这些：

1. 后端根本没在运行
2. 小程序连的是本机或局域网地址
3. 体验版 / 真机访问不到你电脑上的本地服务
4. 正式域名没有 HTTPS / WSS
5. 微信后台没有配置合法域名

所以你要区分两类目标：

- 想在本机开发：本地后端 + 本地 MySQL 就够
- 想让小程序真正可用：必须部署公网后端

## 五、后端健康检查

启动后访问：

```text
http://127.0.0.1:8787/health
```

你会看到类似结果：

```json
{
  "ok": true,
  "rooms": 0,
  "participants": 0,
  "storageDriver": "mysql"
}
```

如果这里不是 `ok: true`，小程序一定连不上。

## 六、数据库里会看到什么

主要表：

- `rooms`
- `participants`

你可以在 Navicat 里直接查看：

- 当前有哪些房间
- 哪些成员还在房间里
- 最后心跳时间
- 当前最新位置

这个项目仍然不会保存历史轨迹回放，只保存当前有效状态。

## 七、如果你要真正上线可用

本地电脑自动启动只能解决“我不想手点脚本”。

它解决不了：

- 电脑关机后服务不可用
- 外网访问不到你本地机器
- 微信体验版 / 正式版不能走本地地址

真正上线至少还需要：

1. 一台公网服务器或云主机
2. 一个备案可用域名
3. HTTPS 证书
4. 将 Node 后端部署到公网
5. 将 MySQL 放在服务器或云数据库
