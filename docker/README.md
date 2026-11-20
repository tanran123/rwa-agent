# Docker 部署

一个镜像里包含三部分：

| 进程 | 端口 | 作用 |
| --- | --- | --- |
| Nginx | 容器内 80 | 提供前端静态文件，把 `/api/` 转到 Koa |
| Koa | 容器内 8780 | 全部 `/api/*` 接口，读 MySQL |
| Flask | 容器内 8766 | 智能体对话、底稿和规则库接口 |

MySQL 不在镜像里，需要服务器上已有 MySQL 8，或者另有 MySQL 容器。

```text
浏览器 → Nginx:80 → /api/ → Koa:8780 → MySQL
                              ├→ Flask:8766（智能体、底稿、规则库）
                              └→ MySQL
```

镜像内目录：

| 路径 | 说明 |
| --- | --- |
| `/usr/share/nginx/html` | Vue 构建产物 |
| `/app` | 仓库代码 |
| `/opt/venv` | Python 虚拟环境 |
| `/app/server/node_modules` | Koa 生产依赖 |
| `/app/output` | 上传、留痕、结果工作簿，建议挂载到宿主机 |
| `/app/.env` | 运行时环境文件，容器启动时自动创建 |

## 一、服务器准备

服务器需要：

- Linux x86_64
- Docker Engine 24+
- Docker Compose v2
- MySQL 8，数据库字符集 `utf8mb4`
- 能访问模型 API（如果使用在线模型）

检查：

```bash
docker --version
docker compose version
```

## 二、初始化 MySQL

在仓库根目录把 SQL 拷到服务器，或在服务器上的源码目录执行：

```bash
mysql -h 127.0.0.1 -u root -p < sql/001_schema.sql
mysql -h 127.0.0.1 -u root -p < sql/002_seed.sql
```

如果 MySQL 只监听 `127.0.0.1`，容器里的 `host.docker.internal` 无法访问。需要把 MySQL 的 `bind-address` 改为 `0.0.0.0`，或者为应用单独创建可通过宿主机桥接地址访问的账号。

示例：

```sql
CREATE DATABASE IF NOT EXISTS rwa DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'rwa'@'%' IDENTIFIED BY '请填写数据库密码';
GRANT ALL PRIVILEGES ON rwa.* TO 'rwa'@'%';
FLUSH PRIVILEGES;
```

## 三、配置部署目标

在本地仓库执行：

```bash
cp docker/deploy.env.example docker/deploy.env
```

填写：

```bash
SERVER=root@你的服务器IP
SSH_KEY=/path/to/你的私钥.pem   # 使用 ssh-agent 时可留空
SSH_PORT=22
REMOTE_DIR=/opt/rwa-agent
```

`docker/deploy.env` 已被 gitignore，不要提交。

## 四、配置应用环境

部署脚本会使用三个 env 文件：

| 文件 | 必填 | 内容 |
| --- | --- | --- |
| `app.env` | 是 | `RWA_VERSION`、`RWA_HTTP_PORT`、`TZ` 等非敏感配置 |
| `mysql.env` | 是 | `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` |
| `model.env` | 建议 | `MODEL_API_KEY`、`MODEL_NAME`、`WEKNORA_*` |

`app.env.example` 会自动复制成 `app.env`。如果 `docker/deploy.env` 里 `UPLOAD_ENV=1`，部署脚本会把本地的 `server/.env` 上传为 `mysql.env`，把根目录 `.env` 上传为 `model.env`。

也可以登录服务器手工维护：

```bash
ssh root@你的服务器IP
cd /opt/rwa-agent/docker
chmod 600 app.env mysql.env model.env
vi mysql.env
vi model.env
```

`mysql.env` 至少包含：

```bash
MYSQL_HOST=数据库地址
MYSQL_PORT=3306
MYSQL_USER=rwa
MYSQL_PASSWORD=数据库密码
MYSQL_DATABASE=rwa
```

如果 MySQL 是另一个 Docker 容器，把 `MYSQL_HOST` 改成该容器所在网络里的服务名或 IP。

## 五、部署方式

### 方式 A：在服务器上构建（推荐，不要求本机有 Docker）

```bash
./docker/deploy-remote.sh
```

脚本会：

1. 打包源码，排除 `.env`、`node_modules`、`output`、`release`；
2. 上传到 `REMOTE_DIR`；
3. 在服务器上执行 `docker compose --env-file app.env up -d --build`。

如果服务器上还没有 `app.env`，脚本会先生成模板；如果 `mysql.env` 或 `model.env` 缺失，会提示先补齐再启动。

### 方式 B：本地构建镜像，导出 tar

本机需要 Docker：

```bash
./docker/build-and-save.sh
```

生成：

```text
release/rwa-agent-1.0.0-linux-amd64.tar
```

拷到服务器：

```bash
scp release/rwa-agent-1.0.0-linux-amd64.tar root@服务器:/opt/rwa-agent/
scp docker/docker-compose.yml root@服务器:/opt/rwa-agent/docker/
scp docker/app.env.example root@服务器:/opt/rwa-agent/docker/
```

服务器上：

```bash
cd /opt/rwa-agent
docker load -i rwa-agent-1.0.0-linux-amd64.tar
cd docker
cp -n app.env.example app.env   # 第一次需要填写
mkdir -p output
docker compose --env-file app.env up -d
```

如果本机是 Apple Silicon，构建脚本默认使用 `linux/amd64`，以便在 x86_64 服务器运行。

## 六、启动后检查

```bash
cd /opt/rwa-agent/docker
docker compose --env-file app.env ps
docker compose --env-file app.env logs -f --tail=200
curl http://127.0.0.1:8080/api/health
```

默认访问地址：

```text
http://服务器IP:8080
```

容器内部端口：

- Nginx 80
- Koa 8780
- Flask 8766

只有 Nginx 的 80 映射到宿主机，默认映射为 8080。改 `app.env` 里的 `RWA_HTTP_PORT` 可以换端口。

## 七、数据持久化

`docker-compose.yml` 把宿主机的 `docker/output` 挂到容器 `/app/output`。上传文件、留痕和结果工作簿都在这里，升级镜像不会丢失。

备份：

```bash
tar -czf rwa-output-$(date +%F).tar.gz -C /opt/rwa-agent/docker output
```

MySQL 备份请在数据库侧单独做。

## 八、升级

改完代码后重新执行：

```bash
./docker/deploy-remote.sh
```

或在服务器上：

```bash
cd /opt/rwa-agent
git pull   # 如果服务器上是 git 工作区
cd docker
docker compose --env-file app.env up -d --build
```

升级不会动 `docker/output`，也不会重建 MySQL。

## 九、回滚

保留上一个镜像 tag：

```bash
docker images rwa-agent
```

在 `app.env` 里把 `RWA_VERSION` 改成上一个版本，然后：

```bash
docker compose --env-file app.env up -d
```

如果使用 tar 部署，重新 `docker load` 旧 tar 后再启动。

## 十、常见问题

**构建时解析 docker.m.daocloud.io 超时**

服务器 DNS 或镜像加速器不通。可以：

- 修复服务器的 DNS / 镜像加速器后重试；
- 或在本机有 Docker 的环境执行 `./docker/build-and-save.sh`，把生成的 tar 传到服务器 `docker load`；
- 或临时删除 Dockerfile 第一行的前端镜像语法声明（当前文件已不再依赖它），并确认 `node:18-bookworm-slim` 能拉取。

**页面能打开，接口 502**

Koa 没起来。查看：

```bash
docker compose --env-file app.env logs rwa-api
```

常见原因是 MySQL 连不上、数据库密码错误、库表还没初始化。

**接口返回“服务异常”**

```bash
docker compose --env-file app.env logs --tail=200 rwa-api
```

如果是 `ER_OUT_OF_SORTMEMORY`，说明 MySQL 排序缓冲区太小，或注册文档过大。当前代码已避免按 `body` 排序；如果仍出现，调大 MySQL `sort_buffer_size`。

**模型调用失败**

检查 `app.env` 里的 `MODEL_API_KEY`、`MODEL_NAME`、`MODEL_BASE_URL`。容器内可以测试网络：

```bash
docker exec -it rwa-agent curl -I https://dashscope.aliyuncs.com
```

**上传大文件失败**

Nginx 限制为 64MB，Koa JSON 限制为 32MB，Flask 限制为 120MB。需要更大上传时同步调整 `docker/nginx.conf`、`server/src/index.js` 和 `app.py`。

**文件上传后不见了**

检查 `docker/output` 是否有写权限，以及 compose 的 volume 是否挂载。

**时区不对**

镜像默认 `Asia/Shanghai`，也可以在 `app.env` 里覆盖 `TZ`。

## 十一、安全说明

- 镜像不包含 `.env`、`server/.env`、`docker/app.env`、`docker/deploy.env`。
- 不要把模型密钥、数据库密码写进 Dockerfile 或 compose 文件。
- 对外暴露前建议在 Nginx 前再加一层 HTTPS 反向代理。
- 默认容器以 root 运行；如需非 root，需要同时调整 `/app/output` 和 Nginx 缓存目录权限。
