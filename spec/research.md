# 技术研究结论

## SQLite 任务队列

单机 MVP 使用 SQLite WAL。worker 在 `BEGIN IMMEDIATE` 事务内选择并抢占最早可用任务；启动时恢复超过十分钟仍处于 `running` 的任务。这样不需要 Redis，同时避免 Web 请求承担长时间模型调用。

## 流式 multipart

Next.js Route Handler 使用 Busboy 读取 Web Stream 并直接写临时文件。类型校验完成后使用原子重命名，避免大视频进入 JS 堆内存或留下半成品素材。

## 不转码策略

图片只接受浏览器和模型普遍可用的 JPEG、PNG、WebP。视频限定为 MP4/H.264；检测到 HEVC、VP9 或 AV1 时直接拒绝。原文件通过 Range API 预览。

## 模型兼容层

两种协议各自构造请求并统一解析为内部 Zod 模式。图片使用 data URL。视频使用 Chat Completions 的 `video_url`：原文件严格小于 7 MiB 时优先使用 Base64 Data URL，避免本地开发依赖公网入口；更大文件使用短期 HMAC 公网链接。Base64 编码后的单文件上限为 10 MB，因此按供应商建议将原始文件边界固定为小于 7 MiB。

视频请求传入 `fps=1`，由模型服务完成画面采样。本应用不运行 FFmpeg、不生成帧文件，也不分析音轨。Qwen3.7 仅用于视觉理解，ASR、语言和字幕输出保持在范围外。Responses 不假设非标准视频扩展。
