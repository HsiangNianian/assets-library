# 素材库数据模型

当前关系数据存储使用 MySQL。数据库时间统一保存为 UTC；API v1 在响应边界转换为
带 `+08:00` 偏移的 ISO 8601 字符串。媒体正文长期保存在 ZOS，MySQL 只保存对象
引用、业务状态和分析结果；Chroma 保存可重建的检索向量。

## 1. 任务与上传清单

### `tasks`

所有异步操作的主表。`type` 为 `upload`、`update`、`publish`、`retry` 或
`delete`；稳定状态仅为 `queued`、`running`、`done`、`failed`，细粒度位置保存在
`phase`。该表同时保存总字节数、文件计数、进度、错误、结果、回调地址和过期时间。

`user_id IS NULL` 表示公共作用域；非空值表示个人素材作用域。任务记录默认保留
7 天。

### `task_items`

上传清单中的每一个原始文件。它通过 `task_id` 归属任务，保存顺序、文件名、声明
MIME、staging 路径、已接收/总字节数和逐文件状态。文件在三步上传封存前只存在于
`media/.staging`，不整体驻留进程内存。

### `idempotency_requests`

预留的幂等请求记录。幂等键按操作类型、用户作用域和 key 唯一，并关联已创建的
任务及其响应快照。

## 2. 媒体对象、父视频与切片

### `media_objects`

本地 staging 或 ZOS 中一个真实对象的统一引用。保存 provider、bucket、object key、
本地路径、SHA-256、MIME、字节数和 `staging` / `persisted` / `deleting` /
`deleted` 状态。业务表不直接保存云存储凭据。

### `video_sources`

正规化后的完整父视频。父视频是分镜来源和最后切片删除后的回收单元，不出现在素材
查询结果中，也不执行 VLM 分析。它可关联上传任务、任务 item 和父视频的 ZOS 对象。

### `task_item_segments`

分镜服务返回的子视频清单，记录 `segment_index`、起止毫秒、staging 路径、MIME、
字节数和校验状态。同一父视频的切片序号唯一。

视频持久化使用整批边界：所有切片必须完整、可解码且每个不超过 10 MiB，父视频和
全部切片才会写入 ZOS 并在一个 MySQL 事务中建档；失败时补偿删除本批已上传对象。

## 3. 素材实体与分析

### `assets`

素材库中可查询、可检索的实体。图片一份上传对应一条素材；视频只有分镜后的子视频
是素材，并通过 `video_source_id`、`segment_index` 和起止毫秒关联父视频。

- `user_id IS NULL`：公共素材。
- `user_id IS NOT NULL`：该用户的个人素材。
- 个人删除把 `user_id` 清空，不删除对象。
- 公共删除会删除 Chroma 向量、ZOS 对象和素材记录。
- 删除父视频的最后一个切片时，同时回收父视频对象和记录。

素材还保存名称、描述、媒体类型、原文件名、对象引用、处理状态、审核状态、失败信息
和审计时间。数据库内部的发布布尔值在 API v1 中暴露为 `auto_publish`。

### `analysis_results`

与素材一对一，保存版本化分析 JSON、模型协议、模型名称和完成时间。数据库保留模型
内部契约；API v1 在输出边界把嵌套字段转换为 `snake_case`。

### `tags`、`asset_tags`、`asset_tag_rejections`

`tags` 按分类和规范化值唯一。`asset_tags` 是素材与标签的多对多关系，记录标签来自
`model` 或 `human` 以及可选置信度。`asset_tag_rejections` 记录人工明确拒绝的模型
标签，后续分析重试不得自动恢复。

## 4. 作业、回调与检索一致性

### `jobs`

worker 可抢占的作业队列，类型包括 `validate`、`scene_detect`、`persist`、
`analyze`、`embed`、`update`、`publish`、`retry`、`delete`、`cleanup` 和
`callback`。领取作业使用带租约的并发控制；失败作业保留稳定错误码和结构化详情。

### `outbox_events`

数据库事务内写入的可靠事件。外部副作用由 dispatcher 异步处理，使数据库提交与
ZOS、Chroma、回调等外部系统之间具备可重试的最终一致性边界。

### `callback_deliveries`

记录每次终态回调的请求快照、尝试次数、HTTP 响应和错误。回调最多尝试 5 次；回调
失败不会回滚已完成的业务事务。

### `search_index_state`

每个素材一条 Chroma 索引水位，记录 `queued`、`running`、`done`、`failed` 或
`deleted` 状态、内容哈希和索引时间。MySQL 是业务事实来源，向量索引可从分析结果
重新构建。

## 5. 核心状态流

```text
上传任务：
receiving → waiting_for_seal → validating → [splitting] → persisting
          → analyzing → [publishing] → notifying → finished

素材变更任务：
queued → updating | publishing | retrying | deleting → notifying → finished

稳定状态：
queued → running → done
                 ↘ failed
```

方括号中的阶段只在对应媒体或请求选项需要时出现。图片跳过 `splitting`；
`auto_publish=false` 时分析完成后保持 `pending_review`，显式发布后变为 `published`。
