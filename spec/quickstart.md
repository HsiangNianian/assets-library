# 快速验证

## 准备

1. 安装 Node.js 22+、pnpm、uv、FFmpeg/ffprobe，并将 `scene-detect-service` 放在同级目录或配置 `SCENE_DETECT_PROJECT_DIR`。
2. 执行 `cp .env.example .env`，配置 MySQL TLS、私有 ZOS、模型地址与按优先级排列的 `VLM_FALLBACK_NAMES`；真实密钥不得提交。
3. 使用 Qwen3.7 VLM 时设置 `VLM_ENABLE_THINKING=false`；该值应用到全部 VLM 候选。Chat Completions 视频分析设置 `VLM_VIDEO_MODE=frames` 和 `VLM_VIDEO_TIMEOUT_MS=300000`。
4. 如需预配置纯文本模型链，设置 `LLM_NAME`、`LLM_FALLBACK_NAMES` 和 `LLM_ENABLE_THINKING=false`；当前业务尚不调用 LLM。

## 启动

```bash
pnpm install
./scripts/start.sh
```

打开 `.env` 中 `PORT` 对应的地址即可使用，无需登录。脚本会依次检查 Chroma、同机分镜服务、MySQL 迁移、Web 和 worker；使用 `./scripts/stop.sh` 停止本项目进程。无鉴权部署只能放在可信内网，不能直接暴露到公网。

## 验证

1. 通过 `/api/v1/uploads` 创建任务、逐 item PUT、封存任务；确认一个 `task_id` 同时展示总状态和每个文件状态。
2. 分析完成后在概览直接确认入库；离开上传页后确认该页不再轮询，而 worker 继续处理。
3. 打开概览确认默认进入“已入库”，其按钮位于“待入库”之前；分别切换两个视图，确认每页最多显示 8 个素材并可通过页码、上一页和下一页切换。
4. 确认标签搜索栏只在“已入库”视图出现，且搜索结果不包含任何待入库素材。
5. 上传可解码的 MP4 父视频，确认其经分镜后只在素材库中出现子视频；每个子视频继续走 1–5 张关键帧分析，父视频不出现在查询结果。
6. 模拟任一切片损坏或超过 10 MiB，确认任务返回逐切片 detail，整批不创建 ZOS/MySQL 素材；成功批次的本地 staging 立即清理。
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
