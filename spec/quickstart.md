# 快速验证

## 准备

1. 安装 Node.js 22+ 和 pnpm。
2. 执行 `cp .env.example .env` 并配置模型地址、密钥和模型名。
3. 使用 Qwen3.7 时设置 `MODEL_ENABLE_THINKING=false`；Chat Completions 视频分析设置 `MODEL_VIDEO_MODE=frames` 和 `MODEL_VIDEO_TIMEOUT_MS=300000`。

## 启动

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3000`。`pnpm dev` 同时启动 Next.js 和 worker。

## 验证

1. 上传不超过 20 MB 的 JPEG/PNG/WebP，确认上传成功后立即出现在概览并显示分析状态。
2. 分析完成后在概览直接确认入库；离开上传页后确认该页不再轮询，而 worker 继续处理。
3. 打开概览确认默认进入“已入库”，其按钮位于“待入库”之前；分别切换两个视图，确认每页最多显示 8 个素材并可通过页码、上一页和下一页切换。
4. 确认标签搜索栏只在“已入库”视图出现，且搜索结果不包含任何待入库素材。
5. 上传 1–5 秒的 H.264 MP4，确认接口先返回排队状态，worker 在服务端分别提取 1–5 张关键帧，并生成视觉分段、关键时间点和时间轴。
6. 上传超过 5 秒且不超过 200 MB 的 H.264 MP4，确认固定取 10%、30%、50%、70%、90% 五帧，且不要求公网地址。
7. 验证 Responses 视频失败为 `model_video_unsupported`；音频、多文件、错误 MIME 和超限素材在上传阶段被拒绝；HEVC、损坏媒体或抽帧失败在 `validating` 阶段标记失败。
8. 重试失败素材时确认复用已有帧；删除后确认概览、详情、媒体 URL 和素材目录均不可访问。
9. 分析期间终止并重启 worker，确认失联任务在心跳过期后重新排队并最终完成。
10. 打开素材详情，点击删除按钮旁的“下载素材”，确认响应使用原始上传文件名且文件内容可读取。

## 质量命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
