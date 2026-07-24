# 快速验证

## 准备

1. 安装 Node.js 22+ 和 pnpm。
2. 执行 `cp .env.example .env` 并配置模型地址、密钥和模型名。
3. Chat Completions 视频分析设置 `MODEL_VIDEO_MODE=frames` 和 `MODEL_VIDEO_TIMEOUT_MS=300000`；无需公网 URL。

## 启动

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3000`。`pnpm dev` 同时启动 Next.js 和 worker。

## 验证

1. 上传不超过 20 MB 的 JPEG/PNG/WebP，确认进度、分析和待审核详情。
2. 编辑描述及标签并确认入库，确认概览出现最终内容。
3. 上传 1–5 秒的 H.264 MP4，确认浏览器分别提取 1–5 张关键帧，并生成视觉分段、关键时间点和时间轴。
4. 上传超过 5 秒且不超过 200 MB 的 H.264 MP4，确认固定取 10%、30%、50%、70%、90% 五帧，且不要求公网地址。
5. 验证 Responses 视频失败为 `model_video_unsupported`；音频、多文件、HEVC MP4、错误 MIME、缺少关键帧和超限素材被拒绝。
6. 重试失败素材时确认复用已有帧；删除后确认概览、详情、媒体 URL 和素材目录均不可访问。

## 质量命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
