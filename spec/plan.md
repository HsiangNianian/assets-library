# 实施计划：多模态素材库 MVP

## 技术上下文

| 领域 | 决策 |
|---|---|
| 应用 | Next.js App Router、React、TypeScript strict |
| UI | Tailwind CSS、shadcn/ui 组件模式 |
| 包管理 | pnpm |
| 数据 | Drizzle ORM、better-sqlite3、SQLite WAL |
| 媒体 | 本地文件系统；原文件直接预览，不转码 |
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
│   ├── media/              # 校验、存储、Range、签名
│   ├── model/              # 两种 OpenAI 兼容协议
│   ├── repositories/       # 素材、标签、任务持久化
│   └── services/           # 分析与清理任务
├── shared/                 # API/分析 Zod 契约
└── worker/                 # 持久任务轮询入口
```

## 数据流

```text
XHR 流式上传 → 临时文件 → 类型/大小/内容校验 → 原子移动
  → SQLite 素材与任务 → 独立 worker → 模型分析
  → Zod 校验/一次修正 → 待审核或直接入库
  → 概览、详情、编辑、发布、重试、删除
```

视频模型输入只在 Chat Completions 下开启，统一构造 `video_url` 并传入默认 `fps=1`。`auto` 模式对严格小于 7 MiB 的原文件使用 Base64 Data URL，达到 7 MiB 时改用短期签名公网 URL；大视频缺少公网 HTTPS 配置时以 `model_video_public_url_required` 终止并允许配置后重试。兼容模式 `chat_video_url` 始终使用签名 URL。Responses 或禁用模式以 `model_video_unsupported` 终止。

## 运行边界

- Web 与 worker 是同一仓库的两个长期 Node 进程，共享数据库和媒体目录。
- 不依赖 Redis、消息队列、对象存储或 FFmpeg。
- 应用不抽帧；帧采样由支持 `video_url` 的模型服务完成，不产生本地中间媒体。
- 删除先软删除，再由 worker 清理素材目录。
- 模型密钥、签名密钥及原始模型响应不得写入日志或数据库。
