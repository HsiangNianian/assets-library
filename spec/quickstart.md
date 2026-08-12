# 快速验证

## 准备

1. 安装 Node.js 22+ 和 pnpm。
2. 执行 `cp .env.example .env` 并配置模型地址、密钥、主模型名以及按优先级排列的 `VLM_FALLBACK_NAMES`；候选名必须是网关的精确模型 ID。
3. 使用 Qwen3.7 VLM 时设置 `VLM_ENABLE_THINKING=false`；该值应用到全部 VLM 候选。Chat Completions 视频分析设置 `VLM_VIDEO_MODE=frames` 和 `VLM_VIDEO_TIMEOUT_MS=300000`。
4. 如需预配置纯文本模型链，设置 `LLM_NAME`、`LLM_FALLBACK_NAMES` 和 `LLM_ENABLE_THINKING=false`；当前业务尚不调用 LLM。

## 启动

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3000`。`pnpm dev` 同时启动 Next.js 和 worker。

## 验证

1. 上传不超过 20 MB 的 JPEG/PNG/WebP；再把 JPEG 内容重命名为 `.png` 上传，确认 worker 将磁盘文件实际转换为 PNG，下载 MIME、文件名和内容格式一致。
2. 分析完成后在概览直接确认入库；离开上传页后确认该页不再轮询，而 worker 继续处理。
3. 打开概览确认默认进入“已入库”，其按钮位于“待入库”之前；分别切换两个视图，确认每页最多显示 8 个素材并可通过页码、上一页和下一页切换。
4. 确认标签搜索栏只在“已入库”视图出现，且搜索结果不包含任何待入库素材。
5. 将可解码的 AVI/WebM/MOV 文件重命名为 `.mp4` 后上传，确认接口先返回排队状态，worker 将磁盘文件实际转换为 H.264/yuv420p MP4，再按 1–5 秒时长提取 1–5 张关键帧并生成时间轴。
6. 上传超过 5 秒且不超过 200 MB 的视频，确认正规化后固定取 10%、30%、50%、70%、90% 五帧，且不要求公网地址。
7. 验证 Responses 视频失败为 `model_video_unsupported`；音频、多文件、错误目标扩展名和超限素材在上传阶段被拒绝；损坏图片、图片伪装视频、损坏/截断视频或抽帧失败在 `validating` 阶段标记失败，且上传项无需悬停即可看到具体原因。
8. 重试失败素材时确认复用已有帧；删除后确认概览、详情、媒体 URL 和素材目录均不可访问。
9. 分析期间终止并重启 worker，确认失联任务在心跳过期后重新排队并最终完成。
10. 打开素材详情，点击删除按钮旁的“下载素材”，确认响应使用原始上传文件名且文件内容可读取。
11. 将主 VLM 模拟为配额耗尽或不可用，确认 worker 按 `VLM_FALLBACK_NAMES` 的顺序切换，并在分析结果中保存实际成功的模型名。

## 质量命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
