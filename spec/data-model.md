# 数据模型

## Asset

保存 UUID、名称、最终描述、媒体类型、原文件名/相对路径/MIME/大小、直接入库标志、处理状态、审核状态、失败信息和审计时间。

## UploadRequest

与 Asset 一对一，保存上传 UUID、客户端文件名、声明 MIME、大小和创建时间。

## ProcessingJob

与 Asset 多对一，类型为 `analyze` 或 `cleanup`，包含队列状态、尝试次数、可执行时间、抢占时间和审计时间。

## AnalysisResult

与 Asset 一对一，保存版本化 JSON、模型协议、模型名和完成时间。JSON 必须满足 `ImageAnalysis` 或 `VideoAnalysis` 的 Zod 契约。

## VideoFrameManifest（文件系统派生物）

视频素材目录中的 `frames/manifest.json` 保存原视频时长、1–5 个 JPEG 帧文件名及对应时间点。它不单独写入数据库；分析重试从该清单复用关键帧，软删除后的 cleanup 任务随素材目录一并移除。

## Tag / AssetTag / AssetTagRejection

Tag 以分类和规范化值唯一；AssetTag 记录 `model` 或 `human` 来源。AssetTagRejection 记录用户明确删除的模型标签，后续重试不得恢复。

## 状态转换

```text
queued → validating → analyzing → completed
任一非终态 → failed
failed → queued（显式重试）
completed + directPublish → published
completed + 人工确认 → published
pending_review / published → deleted → cleanup
```
