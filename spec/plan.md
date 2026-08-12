# 实施计划：多模态素材库 MVP

## 技术上下文

| 领域 | 决策 |
|---|---|
| 应用 | Next.js App Router、React、TypeScript strict |
| UI | Tailwind CSS、shadcn/ui 组件模式 |
| 包管理 | pnpm |
| 数据 | Drizzle ORM、MySQL 8（TLS、UTC、连接池） |
| 媒体 | worker 使用 Sharp/FFmpeg 正规化；视频经分镜服务切片；长期对象保存到私有 ZOS |
| 后台任务 | 独立 TypeScript worker 使用 MySQL 持久任务与行锁抢占 |
| 模型 | OpenAI Chat Completions / Responses 兼容 HTTP 适配器 |
| 校验 | Zod、文件签名、Sharp 图片解码、ffprobe 容器探测、FFmpeg 完整视频解码与输出复验 |
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
浏览器创建一个上传任务并逐项 PUT 字节流，最后封存任务
  → media/.staging 临时文件 → MySQL 持久任务 → 独立 worker
  → 图片正规化；父视频分镜并整批验证每个切片不超过 10 MiB
  → ZOS + MySQL 全有或全无持久化；每个子视频提取 1–5 帧 → 独立模型分析
  → 当前候选重试/Zod 校验一次修正 → 按顺序切换 VLM 候选
  → 保存实际成功模型 → 待审核或直接入库
  → 概览、详情、编辑、发布、重试、删除
```

视频模型输入只在 Chat Completions 且 `VLM_VIDEO_MODE=frames` 时开启。worker 读取已持久化的 JPEG 关键帧，按时间点标注后作为多图片输入发送。Responses 或禁用模式以 `model_video_unsupported` 终止；关键帧缺失或无效则以 `video_frames_missing` 终止并允许重试。

Qwen3.7 默认启用思考模式，但素材描述和标签提取属于直接结构化任务，因此通过 `VLM_ENABLE_THINKING=false` 关闭，以减少推理等待和输出成本。VLM 与 LLM 独立配置该扩展参数，显式值应用到对应模型组的全部候选，未显式配置时不跨模型组透传。

VLM 由 `VLM_NAME` 和按优先级排列的 `VLM_FALLBACK_NAMES` 组成候选链。同组候选共享协议、端点与密钥。配额耗尽和候选模型能力错误直接触发切换；限流、超时、网络及 5xx 错误先重试当前候选，耗尽后切换；鉴权及普通请求参数错误立即终止。无效结构化响应在当前候选纠正一次后切换。失败候选使用进程内冷却，worker 复用同一分析器保存冷却状态，并将实际成功候选写入分析结果。`LLM_FALLBACK_NAMES` 完成同规则配置解析，但当前尚无 LLM 业务执行器。

概览查询以 `pending` / `published` 视图区分审核状态，使用数字页码和固定 `limit=8`。标签子查询只在 `published` 视图构造，避免通过页面或 API 检索未入库素材。

## 运行边界

- Web 与 worker 是同一仓库的两个长期 Node 进程，共享远程 MySQL、Chroma 和 ZOS。
- worker 使用 MySQL `FOR UPDATE SKIP LOCKED` 抢占持久任务，并在启动及周期任务中恢复状态。
- 不依赖 Redis；分镜服务与应用部署在同一台素材库服务器，只监听回环地址。
- worker 将图片转换为目标扩展名格式；视频切片统一为 H.264/yuv420p MP4，只分析画面、不分析音轨。
- 原始上传只在本地 staging 保留 24 小时；成功持久化后立即清理，终态任务记录保留 7 天。
- 个人素材删除会释放为公共素材；公共素材删除由异步任务清理 MySQL、ZOS 与 Chroma。
- 模型密钥及原始模型响应不得写入日志或数据库。
