# MVP 实施任务

## Phase 1：Setup

- [x] T001 建立 Next.js App Router、TypeScript strict、pnpm 项目
- [x] T002 配置 Tailwind CSS、shadcn/ui、ESLint、Vitest、Playwright
- [x] T003 提供环境变量模板和忽略规则

## Phase 2：数据与媒体基础

- [x] T004 定义共享 Zod API 与分析契约
- [x] T005 建立 Drizzle schema、SQLite WAL 和迁移
- [x] T006 实现安全本地存储、临时文件和原子移动
- [x] T007 实现图片签名/元数据与 MP4/H.264 校验
- [x] T008 实现标签来源、拒绝记录和素材 repository
- [x] T009 实现事务式任务抢占与启动恢复

## Phase 3：上传与分析

- [x] T010 实现 Busboy 流式单文件上传 API
- [x] T011 实现上传状态与失败模型
- [x] T012 实现 Chat Completions 模型适配器
- [x] T013 实现 Responses 模型适配器
- [x] T014 实现视频能力失败（原短期签名 URL 方案已由 Phase 7 移除）
- [x] T015 实现分析持久化、自动标签和直接入库
- [x] T016 实现独立分析/清理 worker

## Phase 4：素材 API 和页面

- [x] T017 实现素材分页、详情、编辑、发布、重试、删除 API
- [x] T018 实现图片和视频 Range 媒体 API
- [x] T019 实现素材概览页
- [x] T020 实现 XHR 上传和进度页
- [x] T021 实现详情、轮询、分析展示和编辑页

## Phase 5：验证

- [x] T022 单元测试契约与媒体校验（签名路径已由 Phase 7 移除）
- [x] T023 测试两种模型协议与视频能力失败
- [x] T024 集成测试数据库与状态流
- [x] T025 Playwright 验证三页主路径
- [x] T026 通过 lint、typecheck、test、e2e 和 build
- [x] T027 同步 OpenAPI、quickstart 与规格文档
- [x] T028 增加仅按标签值搜索的概览栏、API 查询和回归测试

## Phase 6：视频视觉分析增强

- [x] T029 补充旧版视频直传策略测试（后由 Phase 7 的关键帧测试替换）
- [x] T030 实现旧版视频直传策略（后由 Phase 7 移除）
- [x] T031 完善视频视觉分段、关键时间点和时间轴展示
- [x] T032 同步错误契约、环境变量、OpenAPI、README 与规格文档
- [x] T033 通过 lint、typecheck、test、e2e 和 build

## Phase 7：浏览器分位抽帧

- [x] T034 补充分位采样、关键帧上传与多图片模型输入测试
- [x] T035 实现浏览器 Canvas 抽帧和上传准备进度
- [x] T036 实现关键帧 multipart 校验、持久化、重试复用与清理
- [x] T037 改用带时间点的多图片分析并删除公网签名视频路径
- [x] T038 同步共享契约、OpenAPI、README 与规格文档
- [x] T039 通过 lint、typecheck、test、e2e 和 build

## Phase 8：处理可靠性与概览审核

- [x] T040 关闭 Qwen3.7 素材提取的默认思考模式并覆盖请求测试
- [x] T041 为 worker 增加任务心跳和周期性失联任务恢复
- [x] T042 上传页卸载时停止状态轮询但保留后台任务
- [x] T043 概览展示所有未删除素材、处理状态和快捷入库操作
- [x] T044 补充任务恢复、概览查询和页面回归测试
- [x] T045 通过 lint、typecheck、test、e2e 和 build

## Phase 9：概览分区与分页

- [x] T046 将待入库和已入库素材拆分为独立概览视图
- [x] T047 实现每页 8 条的数字分页和 4 列 × 2 行布局
- [x] T048 将标签搜索限制为仅查询已入库素材
- [x] T049 补充分区、搜索范围和分页回归测试
- [x] T050 通过 lint、typecheck、test、e2e 和 build

## Phase 10：原文件下载与概览默认视图

- [x] T051 为媒体接口增加保留原始文件名的附件下载模式
- [x] T052 在素材详情删除按钮旁增加下载素材按钮
- [x] T053 将概览默认视图改为已入库并调整视图按钮顺序
- [x] T054 补充下载响应和默认视图回归测试
- [x] T055 通过 lint、typecheck、test、e2e 和 build
