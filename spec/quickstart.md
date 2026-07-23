# 快速验证

## 准备

1. 安装 Node.js 22+ 和 pnpm。
2. 执行 `cp .env.example .env` 并配置模型地址、密钥和模型名。
3. Chat Completions 视频分析设置 `MODEL_VIDEO_MODE=auto`、`MODEL_VIDEO_FPS=1` 和 `MODEL_VIDEO_TIMEOUT_MS=300000`。严格小于 7 MiB 的视频可直接使用 Base64；更大视频还需公网 HTTPS `APP_PUBLIC_URL` 和随机 `MEDIA_SIGNING_SECRET`。

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
3. 上传严格小于 7 MiB 的 H.264 MP4；支持视频的 Chat 配置应通过 Base64 生成视觉分段、关键时间点和时间轴。
4. 上传达到 7 MiB 的 H.264 MP4；配置公网地址时应使用签名 URL，未配置时应失败为 `model_video_public_url_required`，配置后重试成功。
5. 验证 Responses 视频失败为 `model_video_unsupported`；音频、多文件、HEVC MP4、错误 MIME 和超限素材被拒绝。
6. 重试失败素材；删除后确认概览、详情和媒体 URL 均不可访问。

## 质量命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
