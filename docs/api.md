# 素材库 HTTP API

本文档描述当前服务端实际提供的 API。除媒体上传外，所有请求和响应均使用 JSON；当前版本没有应用层鉴权。

## 约定

- Base URL：`http://<host>:3000`
- 素材、上传记录 ID 均为 UUID。
- 日期时间字段使用 ISO 8601 字符串；媒体文件大小使用字节数。
- 除明确标注外，失败响应均使用以下格式：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "请求字段无效。"
  }
}
```

常见错误码：`invalid_request`、`multiple_files`、`unsupported_media_type`、`file_too_large`、`corrupt_file`、`unsupported_video_codec`、`invalid_video_frames`、`model_not_configured`、`model_video_unsupported`、`video_frames_missing`、`model_request_failed`、`model_response_invalid`、`storage_error`、`internal_error`。

## 上传与处理状态

### `POST /api/uploads/images`

上传一张图片。请求会立即返回 `202`，实际分析与向量索引由后台 worker 异步执行。

请求类型：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | 文件 | 是 | 单个 JPEG、PNG、WebP 图片。 |
| `directPublish` | `"true"` / `"false"` | 否 | 为 `true` 时，分析成功后直接入库；默认 `false`。 |

图片默认最大 20 MiB，视频默认最大 7 MiB（千问调用方决定，留有3MiB余量）；可由 `MAX_IMAGE_BYTES`、`MAX_VIDEO_BYTES` 配置覆盖。

### `POST /api/uploads/videos`

上传一个 H.264 MP4 视频。请求只需包含视频文件；服务端使用 FFmpeg 自动均匀抽取 1–5 张 JPEG 关键帧，再由后台 worker 分析。

视频示例：

```bash
curl -X POST http://localhost:3000/api/uploads/videos \
  -F 'file=@demo.mp4;type=video/mp4' \
  -F 'directPublish=false'
```

成功响应：`202 Accepted`

```json
{
  "uploadId": "0bd9d30b-4f29-4ab8-8d0c-9af5b3e6f6e6",
  "assetId": "3c3eb3fd-e239-4d85-8a2c-e99f2b175c4a",
  "mediaType": "image",
  "processingStatus": "queued",
  "reviewStatus": "pending_review",
  "progressPercent": 10,
  "failureCode": null,
  "failureMessage": null
}
```

### `GET /api/uploads/{uploadId}`

查询上传任务状态。前端可在处理中的素材上定时轮询此接口。

成功响应：`200 OK`，字段与上传接口响应相同。

`processingStatus` 可能为：`queued`、`validating`、`analyzing`、`completed`、`failed`。

## 素材查询

### `GET /api/assets`

分页获取未删除素材。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `view` | `published` / `pending` | `published` | `published` 仅返回已入库素材；`pending` 返回待审核和处理中素材。 |
| `page` | 正整数 | `1` | 页码。 |
| `limit` | `1`–`50` | `8` | 每页数量。 |
| `tag` | 字符串，最长 128 | 无 | 仅 `published` 视图生效。执行标签精确、前缀、包含与轻微错别字匹配；启用向量服务时也会合并分析结果的语义召回。 |

```bash
curl 'http://localhost:3000/api/assets?view=published&page=1&limit=8&tag=%E6%B0%B4%E6%9E%9C'
```

成功响应：`200 OK`

```json
{
  "items": [
    {
      "id": "3c3eb3fd-e239-4d85-8a2c-e99f2b175c4a",
      "name": "产品主视觉",
      "description": "白色背景下的橙子产品图。",
      "mediaType": "image",
      "processingStatus": "completed",
      "reviewStatus": "published",
      "tags": [
        { "category": "object", "value": "橙子", "source": "human", "confidence": null }
      ],
      "mediaUrl": "/api/media/3c3eb3fd-e239-4d85-8a2c-e99f2b175c4a",
      "createdAt": "2026-08-03T10:00:00.000Z",
      "searchScore": 1000,
      "semanticScore": 0.612
    }
  ],
  "page": 1,
  "pageSize": 8,
  "total": 1,
  "totalPages": 1
}
```

`searchScore` 与 `semanticScore` 仅在提供 `tag` 参数且命中结果时出现，便于检索诊断：

- `searchScore` 是最终排序分，取标签匹配与语义匹配的较高值。
- `semanticScore` 是 0–1 的向量相似度。仅大于 `0.55` 的语义结果可单独返回；`(0.45, 0.55]` 区间必须同时命中标签；不超过 `0.45` 的语义结果会过滤。

### `POST /api/search`

根据自然语言描述检索已入库素材。该接口默认返回相似度最高的 5 个结果；传入 `keywords` 时，服务会先复用标签搜索的模糊匹配规则（精确、前缀、包含与轻微错别字容错）进行 **AND** 粗筛，再把候选 ID 交给 Chroma 执行向量检索。

```bash
curl -X POST http://localhost:3000/api/search \
  -H 'content-type: application/json' \
  --data '{
    "description": "白色背景下的橙色柑橘产品静物图",
    "keywords": ["白色", "橙子"],
    "limit": 5
  }'
```

请求字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `description` | 字符串，1–1,000 字符 | — | 用于 embedding 的自然语言描述。 |
| `keywords` | 字符串数组，最多 10 项 | 无 | 可选的标签粗筛条件；每个关键词都必须按现有标签模糊匹配规则命中同一素材。 |
| `limit` | 整数，1–20 | `5` | 返回的最大素材数量。 |

成功响应：`200 OK`

```json
{
  "items": [
    {
      "id": "3c3eb3fd-e239-4d85-8a2c-e99f2b175c4a",
      "name": "产品主视觉",
      "mediaType": "image",
      "semanticScore": 0.612,
      "searchScore": 153
    }
  ]
}
```

Chroma 或 embedding 服务未配置时返回 `503`；没有符合关键词粗筛或语义阈值的结果时返回 `200` 与空数组。

### `GET /api/assets/{assetId}`

获取单个素材的完整详情与原始分析结果。

成功响应：`200 OK`

除列表字段外，还会返回：

| 字段 | 说明 |
| --- | --- |
| `originalFilename` | 原始上传文件名。 |
| `mimeType` | 服务端验证后的 MIME 类型。 |
| `sizeBytes` | 文件大小。 |
| `directPublish` | 是否在分析完成后自动入库。 |
| `failureCode` / `failureMessage` | 处理失败时的错误信息。 |
| `analysis` | 模型原始分析结果；未完成时为 `null`。图片包含描述、分类标签和 OCR；视频包含描述、主题、视觉分段、关键时间点和时间轴。 |
| `updatedAt` | 最后一次元数据更新日期。 |

素材不存在或已删除时返回 `404`。

## 编辑与审核

### `PATCH /api/assets/{assetId}`

整体更新素材名称、描述和标签。标签每项必须指定分类与值；提交的标签会替换该素材现有标签。

```bash
curl -X PATCH http://localhost:3000/api/assets/3c3eb3fd-e239-4d85-8a2c-e99f2b175c4a \
  -H 'content-type: application/json' \
  --data '{
    "name": "产品主视觉",
    "description": "人工确认后的描述。",
    "tags": [
      { "category": "scene", "value": "白色背景" },
      { "category": "object", "value": "橙子" }
    ]
  }'
```

字段限制：

- `name`：去除首尾空白后 1–255 字符。
- `description`：最长 10,000 字符。
- `tags`：最多 100 项；`category` 最长 64 字符，`value` 最长 128 字符。

成功响应：`200 OK`，返回更新后的素材详情。

### `POST /api/assets/{assetId}/publish`

将分析已完成的待审核素材正式入库。

成功响应：`200 OK`，返回已更新的素材详情。

若分析尚未完成，返回 `409` 与 `invalid_request`。

### `POST /api/assets/{assetId}/retry`

仅对处理失败的素材重新排队分析。

成功响应：`202 Accepted`，返回上传状态。

### `DELETE /api/assets/{assetId}`

软删除素材，并异步清理媒体文件。

成功响应：`204 No Content`。

## 媒体访问

### `GET /api/media/{assetId}`

流式返回原始图片或视频，支持 HTTP `Range` 请求，适合 `<img>`、`<video>` 与断点续传。

| 参数 | 说明 |
| --- | --- |
| `download=1` | 以原始文件名作为附件下载。 |

响应可能为：

- `200 OK`：返回完整媒体。
- `206 Partial Content`：响应 `Range` 请求，包含 `Content-Range`。
- `404`：素材不存在、已删除或媒体文件不可用。

```bash
curl -L -OJ 'http://localhost:3000/api/media/3c3eb3fd-e239-4d85-8a2c-e99f2b175c4a?download=1'
```
