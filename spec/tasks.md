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
- [x] T014 实现短期签名视频 URL 与能力失败
- [x] T015 实现分析持久化、自动标签和直接入库
- [x] T016 实现独立分析/清理 worker

## Phase 4：素材 API 和页面

- [x] T017 实现素材分页、详情、编辑、发布、重试、删除 API
- [x] T018 实现图片和视频 Range 媒体 API
- [x] T019 实现素材概览页
- [x] T020 实现 XHR 上传和进度页
- [x] T021 实现详情、轮询、分析展示和编辑页

## Phase 5：验证

- [x] T022 单元测试契约、媒体校验和签名
- [x] T023 测试两种模型协议与视频能力失败
- [x] T024 集成测试数据库与状态流
- [x] T025 Playwright 验证三页主路径
- [x] T026 通过 lint、typecheck、test、e2e 和 build
- [x] T027 同步 OpenAPI、quickstart 与规格文档
- [x] T028 增加仅按标签值搜索的概览栏、API 查询和回归测试
