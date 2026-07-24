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

并配置 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`。兼容百炼等第三方服务时使用其 OpenAI 兼容 Base URL。

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

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

更完整的验收步骤见 [spec/quickstart.md](spec/quickstart.md)。
