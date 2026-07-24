# 实施计划：多模态素材库 MVP

## 技术上下文

| 领域 | 决策 |
|---|---|
| 应用 | Next.js App Router、React、TypeScript strict |
| UI | Tailwind CSS、shadcn/ui 组件模式 |
| 包管理 | pnpm |
| 数据 | Drizzle ORM、better-sqlite3、SQLite WAL |
| 媒体 | 浏览器 Canvas 提取视频关键帧；本地文件系统保存原文件和帧；不转码 |
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
│   ├── db/                 # Drizzle schema、SQLite 初始化
│   ├── media/              # 校验、关键帧存储、Range
│   ├── model/              # 两种 OpenAI 兼容协议
│   ├── repositories/       # 素材、标签、任务持久化
│   └── services/           # 分析与清理任务
├── shared/                 # API/分析 Zod 契约
└── worker/                 # 持久任务轮询入口
```

## 数据流

```text
浏览器校验视频时长并按分位点提取 1–5 帧
  → XHR multipart 流式上传原文件、关键帧和时间点
  → 临时文件 → 类型/大小/内容校验 → 原子移动
  → SQLite 素材与任务 → 独立 worker → 模型分析
  → Zod 校验/一次修正 → 待审核或直接入库
  → 概览、详情、编辑、发布、重试、删除
```

视频模型输入只在 Chat Completions 且 `MODEL_VIDEO_MODE=frames` 时开启。worker 读取已持久化的 JPEG 关键帧，按时间点标注后作为多图片输入发送。Responses 或禁用模式以 `model_video_unsupported` 终止；关键帧缺失或无效则以 `video_frames_missing` 终止并允许重试。

## 运行边界

- Web 与 worker 是同一仓库的两个长期 Node 进程，共享数据库和媒体目录。
- 不依赖 Redis、消息队列、对象存储或 FFmpeg。
- 浏览器执行关键帧采样；服务端不依赖 FFmpeg，也不从原视频解码或转码。
- 关键帧保存在素材 UUID 目录中，分析重试复用原帧，清理任务删除整个素材目录。
- 删除先软删除，再由 worker 清理素材目录。
- 模型密钥及原始模型响应不得写入日志或数据库。
