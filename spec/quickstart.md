# 快速验证

## 准备

1. 安装 Node.js 22+ 和 pnpm。
2. 执行 `cp .env.example .env` 并配置模型地址、密钥和模型名。
3. Chat Completions 视频分析还需设置 `MODEL_VIDEO_MODE=chat_video_url`、公网 `APP_PUBLIC_URL` 和随机 `MEDIA_SIGNING_SECRET`。

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
3. 上传 H.264 MP4；支持视频的 Chat 配置应生成视觉时间轴，Responses 配置应明确失败为 `model_video_unsupported`。
4. 验证音频、多文件、HEVC MP4、错误 MIME 和超限素材被拒绝。
5. 重试失败素材；删除后确认概览、详情和媒体 URL 均不可访问。

## 质量命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
