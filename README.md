# 素材中枢

一个基于 Next.js、TypeScript、Tailwind CSS、shadcn/ui、SQLite 和本地文件系统的单机多模态素材库 MVP。

第一阶段支持一次选择多个本地素材，浏览器会将每个素材作为独立请求逐个上传：

- JPEG、PNG、WebP 图片，默认最大 20 MB
- H.264 编码的 MP4 视频，默认最大 200 MB

视频会在浏览器中提取少量 JPEG 关键帧供视觉分析。音频、URL 上传、服务端抽帧、音轨分析、批量编辑和转码不在本阶段范围内。

## 本地运行

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:3000>。开发命令会同时启动 Web 和后台 worker。

数据库结构以 `src/server/db/schema.ts` 为来源，由 Drizzle migration
负责创建和升级。Web 与 worker 只打开、配置并复用数据库连接，不会在启动时隐式建表；
首次运行或拉取包含新迁移的代码后，需要先执行 `pnpm db:migrate`。

## 模型配置

设置 `MODEL_PROTOCOL` 为：

- `openai_chat_completions`
- `openai_responses`

并配置 `MODEL_BASE_URL` 和 `MODEL_NAME`。兼容 NewAPI、百炼等第三方服务时使用其 OpenAI
兼容 Base URL（通常以 `/v1` 结尾）。`MODEL_API_KEY` 是可选的：网关启用鉴权时填写
NewAPI 令牌，网关关闭鉴权时可以留空；留空后请求不会发送 `Authorization` 请求头。

`qwen3.7` 系列默认开启思考模式。素材结构化提取不需要长推理，建议关闭以降低等待时间：

```dotenv
MODEL_ENABLE_THINKING=false
```

视频分析使用 Chat Completions 的多图片输入。浏览器按视频时长提取 1–5 张 JPEG 关键帧，worker 将关键帧及其时间点交给模型；原始 MP4 只用于存储和预览。配置：

```dotenv
MODEL_VIDEO_MODE=frames
MODEL_VIDEO_TIMEOUT_MS=300000
```

不超过 5 秒的视频每秒取一帧（向上取整，至少一帧），超过 5 秒的视频固定取五帧；时间点均为各等分区间的中点，因此长视频取 10%、30%、50%、70%、90% 位置。关键帧最长边限制为 1280 像素，并以质量 0.85 的 JPEG 保存。视频大小不再影响模型传递策略，也不需要公网 URL。

Responses 协议或禁用视频能力时，视频任务会明确失败为 `model_video_unsupported`。当前只分析画面，不处理音轨、ASR、语言或字幕。

素材上传成功后会立即出现在概览中。排队、分析中和失败素材会显示状态；分析完成且待审核的素材可以在概览直接入库。关闭上传页只会停止该页面的状态轮询，不会取消已经入队的后台任务。

概览默认打开“已入库”，并可切换到“待入库”；每页按 4 列 × 2 行展示 8 个素材。标签搜索只在“已入库”视图提供，不会检索处理中、失败或等待审核的素材。素材详情可通过受控媒体接口按原始文件名下载上传文件。

## 生产运行

Web 与 worker 必须共享同一 SQLite 文件和媒体目录：

```bash
pnpm build
pnpm start:web
pnpm start:worker
```

该模式要求持久磁盘和长期 Node 进程，不支持 Serverless。建议由反向代理提供 HTTPS、请求体限制和内网访问控制。

## Docker 部署

镜像只包含程序和默认配置，**不包含本机的 `.env`、SQLite 数据库或上传的媒体文件**。这样可以安全地发布到镜像仓库；运行容器时再注入模型配置，并挂载持久存储。

### 前置条件

- Docker Engine 已安装并处于运行状态。
- 已准备模型服务配置。以示例文件为起点创建本机配置：

  ```bash
  cp .env.example .env
  ```

  至少确认 `.env` 中的 `MODEL_PROTOCOL`、`MODEL_BASE_URL`、`MODEL_API_KEY`（如需要）和 `MODEL_NAME` 适用于你的模型服务。不要将 `.env` 提交到 Git 或打包进镜像。

### 构建镜像

在仓库根目录执行：

```bash
docker build --network host -t ghcr.io/onestudentforcode/assets-library:latest .
```

如已从 GHCR 获取镜像，可跳过此步骤：

```bash
docker pull ghcr.io/onestudentforcode/assets-library:latest
```

GHCR 中由 GitHub Actions 发布的镜像同时支持 `linux/amd64` 与 `linux/arm64`；Docker 会在 x86-64 或 ARM 主机上自动拉取对应架构。若需要在本机手动发布多架构镜像，先安装并启用 Docker Buildx，再执行：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/onestudentforcode/assets-library:latest \
  --push .
```

Dockerfile 的 Debian 构建依赖和 npm 依赖默认使用阿里云镜像：`mirrors.aliyun.com` 与 `registry.npmmirror.com`。Debian slim 初始镜像没有系统 CA 证书，因此首次 apt 安装使用 HTTP 阿里源并立即安装 `ca-certificates`；软件包索引和软件包仍由 Debian 签名验证。如需使用官方源，可通过构建参数覆盖：

```bash
docker build \
  --network host \
  --build-arg NPM_REGISTRY=https://registry.npmjs.org \
  --build-arg DEBIAN_MIRROR=http://deb.debian.org/debian \
  --build-arg DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security \
  -t ghcr.io/onestudentforcode/assets-library:latest .
```

Docker Hub 基础镜像（例如 `node:22-bookworm-slim`）的拉取加速由 Docker 守护进程控制，无法写入 Dockerfile。请从阿里云容器镜像服务控制台获取个人加速地址，并写入宿主机 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": ["https://<你的阿里云专属地址>.mirror.aliyuncs.com"]
}
```

在 Arch Linux 上重启 Docker 使配置生效：

```bash
sudo systemctl restart docker
```

### 一键启动（推荐）

确认已创建并配置 `.env` 后，在仓库根目录执行：

```bash
docker compose up -d
```

Compose 会自动构建本地镜像、创建两个持久化 volume，然后启动 Web 和 worker。镜像入口脚本会在每个服务启动前检查并升级数据库结构；共享锁会确保 SQLite 迁移不会并发执行。当前 Compose 配置让构建与运行均使用 Linux host 网络模式，以兼容不支持 Docker bridge veth 的宿主环境，因此 Web 直接监听宿主机的 <http://localhost:3000>。

查看服务状态与日志：

```bash
docker compose ps
docker compose logs -f web worker
```

代码或 Dockerfile 更新后，使用下面的命令重新构建并启动：

```bash
docker compose up -d --build
```

停止服务但保留数据库和媒体文件：

```bash
docker compose down
```

### 首次启动

Web 服务和后台 worker 是两个独立进程，必须共享同一份 SQLite 数据库和媒体目录。下面使用 Docker named volumes 保存它们；删除容器不会删除其中的数据。

```bash
docker volume create assets-library-data
docker volume create assets-library-media
```

启动 Web 服务。镜像会先自动检查并升级数据库，然后在宿主机的 <http://localhost:3000> 提供服务：


```bash
docker run -d \
  --name assets-library-web \
  --restart unless-stopped \
  --env-file .env \
  --network host \
  -v assets-library-data:/app/data \
  -v assets-library-media:/app/media \
  ghcr.io/onestudentforcode/assets-library:latest
```

启动后台 worker。它负责领取并处理上传后的分析任务：

```bash
docker run -d \
  --name assets-library-worker \
  --restart unless-stopped \
  --env-file .env \
  --network host \
  -v assets-library-data:/app/data \
  -v assets-library-media:/app/media \
  ghcr.io/onestudentforcode/assets-library:latest \
  pnpm start:worker
```

查看运行状态与日志：

```bash
docker ps --filter name=assets-library
docker logs -f assets-library-web
docker logs -f assets-library-worker
```

停止服务但保留数据：

```bash
docker stop assets-library-web assets-library-worker
docker rm assets-library-web assets-library-worker
```

升级镜像时，先拉取或重新构建新标签，删除旧容器，再按照“首次启动”中的迁移、Web 和 worker 命令重新创建容器。请勿删除 `assets-library-data` 或 `assets-library-media` volume，除非你确认要永久清空素材库。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

更完整的验收步骤见 [spec/quickstart.md](spec/quickstart.md)。
