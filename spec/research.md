# 技术研究结论

## SQLite 任务队列

单机 MVP 使用 SQLite WAL。worker 在 `BEGIN IMMEDIATE` 事务内选择并抢占最早可用任务，运行期间每 30 秒更新任务心跳并周期扫描；超过两分钟没有心跳的 `running` 任务重新排队。这样既不需要 Redis，也避免 worker 异常退出后素材永久停留在“分析中”。

## 流式 multipart

Next.js Route Handler 使用 Busboy 读取 Web Stream 并直接写临时文件。类型校验完成后使用原子重命名，避免大视频进入 JS 堆内存或留下半成品素材。

## 不转码策略

图片只接受浏览器和模型普遍可用的 JPEG、PNG、WebP。视频限定为 MP4/H.264；检测到 HEVC、VP9 或 AV1 时直接拒绝。原文件通过 Range API 预览。

## 模型兼容层

两种协议各自构造请求并统一解析为内部 Zod 模式。图片使用 data URL。视频不直接发送原文件：浏览器用原生 `<video>` 和 Canvas 生成 JPEG 关键帧，服务端保存后由 Chat Completions 以多图片输入分析，因此不依赖公网媒体地址。

帧数规则为 `min(5, max(1, ceil(durationSeconds)))`，时间点采用每个等分区间的中点。这样短视频约每秒一帧且避开首尾黑场，超过 5 秒的视频固定覆盖 10%、30%、50%、70%、90%。帧最长边缩放至 1280 像素并以质量 0.85 的 JPEG 编码，在覆盖范围和请求体大小之间取得平衡。

本应用不运行 FFmpeg，也不分析音轨。Qwen3.7 仅用于视觉理解，ASR、语言和字幕输出保持在范围外。Responses 不假设非标准多图片视频分析能力。
