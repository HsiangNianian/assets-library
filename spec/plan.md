# 实施计划：多模态素材库 MVP

## 技术上下文

| 领域 | 决策 |
|---|---|
| 应用 | Next.js App Router、React、TypeScript strict |
| UI | Tailwind CSS、shadcn/ui 组件模式 |
| 包管理 | pnpm |
| 数据 | Drizzle ORM、better-sqlite3、SQLite WAL |
| 媒体 | worker 使用 FFmpeg 提取视频关键帧；本地文件系统保存原文件和帧；不转码 |
| 后台任务 | 独立 TypeScript worker 事务轮询 SQLite |
| 模型 | OpenAI Chat Completions / Responses 兼容 HTTP 适配器 |
| 校验 | Zod、文件签名、Sharp 图片元数据、MP4/H.264 结构标记 |
| 测试 | Vitest、Playwright、模型 HTTP 测试替身 |

## 结构

```text
src/
├── app/                    # 三个页面与 Route Handlers
├── components/             # shadcn 风格组件与媒体预览
├── server/
│   ├── db/                 # Drizzle schema、显式迁移、连接与应用单例
│   ├── media/              # 校验、关键帧存储、Range
│   ├── model/              # 两种 OpenAI 兼容协议
│   ├── repositories/       # 素材、标签、任务持久化
│   └── services/           # 分析与清理任务
├── shared/                 # API/分析 Zod 契约
└── worker/                 # 持久任务轮询入口
```

## 数据流

```text
浏览器通过 XHR multipart 流式上传单个原文件
  → 扩展名/声明 MIME/大小检查 → 临时文件 → 原子移动
  → SQLite 素材与任务 → 独立 worker
  → 内容校验；视频按分位点提取 1–5 帧 → 模型分析
  → Zod 校验/一次修正 → 待审核或直接入库
  → 概览、详情、编辑、发布、重试、删除
```

视频模型输入只在 Chat Completions 且 `VLM_VIDEO_MODE=frames` 时开启。worker 读取已持久化的 JPEG 关键帧，按时间点标注后作为多图片输入发送。Responses 或禁用模式以 `model_video_unsupported` 终止；关键帧缺失或无效则以 `video_frames_missing` 终止并允许重试。

Qwen3.7 默认启用思考模式，但素材描述和标签提取属于直接结构化任务，因此通过 `VLM_ENABLE_THINKING=false` 关闭，以减少推理等待和输出成本。VLM 与 LLM 独立配置该扩展参数，未显式配置时不跨模型组透传。

概览查询以 `pending` / `published` 视图区分审核状态，使用数字页码和固定 `limit=8`。标签子查询只在 `published` 视图构造，避免通过页面或 API 检索未入库素材。

## 运行边界

- Web 与 worker 是同一仓库的两个长期 Node 进程，共享数据库和媒体目录。
- worker 每 30 秒更新运行任务心跳并扫描失联任务；超过两分钟没有心跳的任务重新排队。
- 不依赖 Redis、消息队列或对象存储；视频抽帧需要服务端 FFmpeg/ffprobe。
- worker 执行关键帧采样，只解码画面，不转码原视频或分析音轨。
- 关键帧保存在素材 UUID 目录中，分析重试复用原帧，清理任务删除整个素材目录。
- 删除先软删除，再由 worker 清理素材目录。
- 模型密钥及原始模型响应不得写入日志或数据库。
