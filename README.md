# 素材中枢

一个基于 Next.js、TypeScript、Tailwind CSS、shadcn/ui、SQLite 和本地文件系统的单机多模态素材库 MVP。

第一阶段只接受本地单文件上传：

- JPEG、PNG、WebP 图片，默认最大 20 MB
- H.264 编码的 MP4 视频，默认最大 200 MB

音频、URL 上传、批量上传、应用侧抽帧、音轨分析和转码不在本阶段范围内。

## 本地运行

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:3000>。开发命令会同时启动 Web 和后台 worker。

## 模型配置

设置 `MODEL_PROTOCOL` 为：

- `openai_chat_completions`
- `openai_responses`

并配置 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`。兼容百炼等第三方服务时使用其 OpenAI 兼容 Base URL。

视频分析只支持声明兼容 `video_url` 的 Chat Completions 服务。千问在模型服务端按默认 1 FPS 抽帧，本应用不生成帧文件。配置：

```dotenv
MODEL_VIDEO_MODE=auto
MODEL_VIDEO_FPS=1
MODEL_VIDEO_TIMEOUT_MS=300000
APP_PUBLIC_URL=
MEDIA_SIGNING_SECRET=a-long-random-secret
```

严格小于 7 MiB 的视频优先以 Base64 Data URL 传递，不需要公网地址。达到 7 MiB 的视频改用短期签名 URL，此时必须配置公网 HTTPS `APP_PUBLIC_URL` 和非默认 `MEDIA_SIGNING_SECRET`；缺少配置时任务失败为 `model_video_public_url_required`，配置后可重试。`chat_video_url` 作为仅使用签名 URL 的兼容模式继续保留。

Responses 协议或禁用视频能力时，视频任务会明确失败为 `model_video_unsupported`。当前只分析画面，不处理音轨、ASR、语言或字幕。

## 生产运行

Web 与 worker 必须共享同一 SQLite 文件和媒体目录：

```bash
pnpm build
pnpm start:web
pnpm start:worker
```

该模式要求持久磁盘和长期 Node 进程，不支持 Serverless。建议由反向代理提供 HTTPS、请求体限制和内网访问控制。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

更完整的验收步骤见 [spec/quickstart.md](spec/quickstart.md)。
