# 云服务器部署操作文档

目标：把本项目后端部署到公网云服务器上，让小程序不再依赖你自己的电脑。

## 0. 你最终需要准备什么

上线小程序后端至少需要：

1. 一台云服务器，例如腾讯云、阿里云、华为云等。
2. 一个已备案域名，例如 `api.example.com`。
3. HTTPS 证书。
4. 后端服务常驻运行。
5. 小程序后台配置合法域名：
   - request 合法域名：`https://api.example.com`
   - socket 合法域名：`wss://api.example.com`

> 微信小程序体验版/正式版不能使用 `http://127.0.0.1`、局域网 IP、普通 `http`。必须使用公网 `HTTPS` 和 `WSS`，或使用微信云开发云托管。

## 1. 推荐部署架构

```text
小程序
  -> HTTPS/WSS 域名 api.example.com
  -> Nginx 反向代理
  -> Node 后端 127.0.0.1:8787
  -> MySQL 数据库
```

本项目已提供：

- 后端 Dockerfile：`backend/Dockerfile`
- Docker Compose 模板：`deploy/docker-compose.yml`
- 环境变量模板：`deploy/.env.example`
- Nginx 配置模板：`deploy/nginx-live-location.conf`

## 2. 云服务器建议

最低配置：

- 系统：Ubuntu 22.04 LTS
- CPU：1 核或 2 核
- 内存：2 GB 起
- 硬盘：40 GB 起
- 带宽：1 Mbps 起，测试够用

安全组/防火墙放行：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH 登录 |
| 80 | HTTP，申请证书/跳转 HTTPS |
| 443 | HTTPS/WSS，小程序正式访问 |

不建议直接开放 `8787` 到公网。生产环境让 Nginx 代理到本机 `127.0.0.1:8787` 即可。

## 3. 域名准备

假设你的后端域名是：

```text
api.example.com
```

你需要在域名 DNS 中添加 A 记录：

```text
主机记录：api
记录类型：A
记录值：你的云服务器公网 IP
```

等待 DNS 生效后，在本地测试：

```powershell
nslookup api.example.com
```

能解析到服务器公网 IP 即可。

## 4. 登录服务器并安装基础环境

SSH 登录服务器：

```bash
ssh root@你的服务器公网IP
```

更新系统：

```bash
apt update && apt upgrade -y
```

安装 Git、Nginx、Docker：

```bash
apt install -y git nginx ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl enable --now nginx
```

检查：

```bash
docker --version
docker compose version
nginx -v
```

## 5. 上传项目到服务器

方式 A：使用 Git 仓库

```bash
cd /opt
git clone 你的仓库地址 live-location-share-app
cd /opt/live-location-share-app
```

方式 B：直接上传压缩包

把项目压缩后上传到服务器，然后解压到：

```text
/opt/live-location-share-app
```

后续命令都假设项目目录是：

```bash
/opt/live-location-share-app
```

## 6. 配置后端环境变量

进入部署目录：

```bash
cd /opt/live-location-share-app/deploy
cp .env.example .env
nano .env
```

至少修改这些值：

```env
MYSQL_ROOT_PASSWORD=一个强密码
DB_PASSWORD=另一个强密码
DB_NAME=live_location_share
DB_USER=live_location
```

推荐生产环境使用 MySQL：

```env
STORAGE_DRIVER=mysql
DB_HOST=mysql
DB_PORT=3306
DB_AUTO_MIGRATE=true
```

## 7. 启动后端和 MySQL

在服务器执行：

```bash
cd /opt/live-location-share-app/deploy
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看后端日志：

```bash
docker compose logs -f backend
```

服务器本机测试：

```bash
curl http://127.0.0.1:8787/health
```

正常返回示例：

```json
{"ok":true,"rooms":0,"participants":0,"storageDriver":"mysql"}
```

## 8. 配置 Nginx 反向代理

复制模板：

```bash
cp /opt/live-location-share-app/deploy/nginx-live-location.conf /etc/nginx/sites-available/live-location.conf
nano /etc/nginx/sites-available/live-location.conf
```

把里面所有：

```text
api.example.com
```

替换成你的真实域名，例如：

```text
api.your-domain.com
```

启用站点：

```bash
ln -s /etc/nginx/sites-available/live-location.conf /etc/nginx/sites-enabled/live-location.conf
nginx -t
systemctl reload nginx
```

此时 HTTPS 证书还没配置好，下一步申请证书。

## 9. 申请 HTTPS 证书

安装 Certbot：

```bash
apt install -y certbot python3-certbot-nginx
```

申请证书：

```bash
certbot --nginx -d api.example.com
```

把 `api.example.com` 换成你的真实域名。

按提示输入邮箱、同意协议，并选择自动重定向 HTTPS。

检查自动续期：

```bash
certbot renew --dry-run
```

## 10. 公网验证后端

在你自己的电脑上执行：

```powershell
Invoke-RestMethod https://api.example.com/health
```

或浏览器打开：

```text
https://api.example.com/health
```

正常应该返回：

```json
{"ok":true,...}
```

WebSocket 不方便直接用浏览器测，但小程序地图页会用：

```text
wss://api.example.com/ws
```

Nginx 模板已配置 `/ws` 的 Upgrade 代理。

## 11. 修改小程序生产配置

回到本地项目，修改：

```text
miniprogram/utils/config.js
```

把：

```js
const PRODUCTION_HTTP_BASE_URL = '';
const PRODUCTION_WS_BASE_URL = '';
```

改成：

```js
const PRODUCTION_HTTP_BASE_URL = 'https://api.example.com';
const PRODUCTION_WS_BASE_URL = 'wss://api.example.com';
```

把 `api.example.com` 换成你的真实域名。

开发版仍然可以继续用本地：

```js
const DEVELOPMENT_HTTP_BASE_URL = 'http://127.0.0.1:8787';
const DEVELOPMENT_WS_BASE_URL = 'ws://127.0.0.1:8787';
```

## 12. 配置微信小程序后台合法域名

进入微信公众平台：

```text
微信公众平台 -> 开发 -> 开发管理 -> 开发设置 -> 服务器域名
```

添加：

```text
request 合法域名：https://api.example.com
socket 合法域名：wss://api.example.com
```

注意：

- 域名必须已备案。
- 必须是 HTTPS/WSS。
- 证书必须有效。
- 不要带路径，例如不要填 `https://api.example.com/health`。

## 13. 上传体验版/正式版

在微信开发者工具中：

1. 确认代码里生产域名已配置。
2. 点击「上传」。
3. 到微信公众平台提交体验版。
4. 体验版测试：创建房间、加入房间、地图实时共享。
5. 确认无误后提交审核发布。

## 14. 日常维护命令

进入服务器：

```bash
cd /opt/live-location-share-app/deploy
```

查看服务：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f backend
```

重启服务：

```bash
docker compose restart backend
```

更新代码后重新部署：

```bash
cd /opt/live-location-share-app
git pull
cd deploy
docker compose up -d --build
```

备份 MySQL 数据：

```bash
docker exec live-location-mysql mysqldump -u root -p live_location_share > live_location_share.sql
```

## 15. 常见问题

### 15.1 小程序提示后端未连接

检查：

```bash
curl https://api.example.com/health
```

如果不通，依次检查：

1. 域名 DNS 是否解析到服务器。
2. 安全组是否放行 443。
3. Nginx 是否运行。
4. Docker 后端是否运行。
5. 证书是否有效。

### 15.2 HTTP 正常但地图页 WebSocket 失败

检查 Nginx `/ws` 配置是否包含：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

然后执行：

```bash
nginx -t
systemctl reload nginx
```

### 15.3 体验版能打开但正式版失败

通常是微信后台合法域名没有配置，或配置后没有重新上传代码。

### 15.4 服务器重启后服务没了

使用 Docker Compose 的 `restart: unless-stopped` 后，一般会自动恢复。确认 Docker 已开机自启：

```bash
systemctl enable docker
```

## 16. 你需要填给我的信息

如果你希望我继续帮你把配置改到位，请发我：

1. 云服务器系统：Ubuntu / CentOS / Debian？
2. 后端域名：例如 `api.xxx.com`
3. 是否已有备案？
4. 是否打算用 Docker 部署？
5. 是否使用云数据库，还是服务器内置 MySQL？

拿到这些信息后，我可以继续帮你把 `config.js` 和部署文件改成你的真实域名版本。
