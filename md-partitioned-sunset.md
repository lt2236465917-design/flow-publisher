# 多平台视频同步发布工具 — 分阶段实现计划

## Context

PRD 文档 `pc-4-joyful-blossom.md` 定义了一款跨平台桌面应用，帮助内容创作者将视频一键同步发布到抖音、小红书、视频号、快手四大平台，并提供数据统计分析。当前项目为全新状态，仅有一份需求文档，无任何代码。

## 核心架构决策

### 平台适配器模式（最重要的设计选择）

所有平台交互（登录、发布、数据分析）通过统一的 `PlatformAdapter` 接口实现。新增平台只需实现一个新文件，无需重构应用。

```typescript
interface IPlatformAdapter {
  id: PlatformId;
  displayName: string;
  launchLogin(): Promise<LoginSession>;
  checkSession(): Promise<SessionStatus>;
  restoreSession(storedCookies: Cookie[]): Promise<boolean>;
  getVideoConstraints(): VideoConstraints;
  uploadVideo(filePath: string, onProgress: ProgressCallback): Promise<UploadResult>;
  submitContent(content: PlatformPublishContent): Promise<PublishResult>;
  getPlatformFields(): PlatformFieldDefinition[];
  fetchAnalytics(options: AnalyticsQuery): Promise<PlatformAnalytics>;
}
```

### 进程架构

- **主进程 (Node.js)**: Playwright 浏览器池、SQLite (better-sqlite3)、FFmpeg 子进程、定时调度器、平台适配器
- **渲染进程 (React)**: Zustand 状态管理、Ant Design UI、ECharts 图表、通过 preload 桥接的 IPC 通信

### 目标目录结构

```
D:\PC APP\
├── electron/                          # 主进程
│   ├── main.ts                        # Electron 入口
│   ├── preload.ts                     # contextBridge API
│   ├── ipc/                           # IPC 处理器
│   ├── services/
│   │   ├── database/                  # SQLite 数据库层
│   │   ├── platform-adapters/         # 平台适配器
│   │   ├── browser/                   # Playwright 管理
│   │   ├── ffmpeg/                    # 视频处理
│   │   ├── scheduler/                 # 定时发布
│   │   └── analytics/                 # 数据分析
│   └── utils/
├── src/                               # 渲染进程 (React)
│   ├── pages/                         # 5个页面
│   ├── components/                    # 按功能分组的组件
│   ├── stores/                        # Zustand 状态
│   ├── hooks/                         # 自定义 hooks
│   ├── types/                         # TypeScript 类型
│   └── constants/
├── shared/contracts/                  # 主进程/渲染进程共享类型
└── resources/                         # 图标、FFmpeg 二进制
```

---

## Phase 1: 项目基础搭建

**目标**: 一个可运行的 Electron + React + TypeScript 应用，具备构建工具、代码规范和基本窗口。

### 关键交付物
1. 通过 `electron-vite` 脚手架搭建 React + TypeScript 项目
2. 主进程创建 BrowserWindow，加载渲染进程
3. Preload 脚本暴露类型安全的 IPC 桥接（初始为空）
4. ESLint + Prettier 配置
5. Vitest 测试配置
6. electron-builder 打包配置（macOS + Windows）
7. `MainLayout` 侧边栏导航 + 5个空页面桩

### 需创建的文件
- `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- `electron-builder.yml`, `.eslintrc.cjs`, `.prettierrc`, `vitest.config.ts`
- `electron/main.ts`, `electron/preload.ts`
- `src/main.tsx`, `src/App.tsx`, `src/layouts/MainLayout.tsx`
- `src/components/common/AppSidebar.tsx`, `src/components/common/ErrorBoundary.tsx`
- `src/pages/AccountPage.tsx`, `src/pages/PublishPage.tsx`, `src/pages/PublishRecordsPage.tsx`, `src/pages/AnalyticsPage.tsx`, `src/pages/SettingsPage.tsx`
- `src/styles/global.css`, `src/constants/platforms.ts`, `src/constants/ipc-channels.ts`
- `src/types/platform.types.ts`, `src/types/ipc.types.ts`
- `shared/contracts/ipc.contract.ts`, `shared/contracts/platform.contract.ts`

### 依赖
```
react, react-dom, react-router-dom, antd, @ant-design/icons, zustand
electron, electron-builder, electron-vite, @vitejs/plugin-react
typescript, vitest, eslint, prettier, @electron/rebuild
```

### 验证标准
- `npm run dev` 启动 Electron 窗口，显示 React 应用
- 侧边栏导航可切换 5 个空页面
- `npm run build` 可产出可分发包

---

## Phase 2: 账号管理

**目标**: 用户可通过扫码登录各平台，登录状态持久化，UI 实时显示状态。

### 关键交付物
1. SQLite 数据库初始化 + accounts 表
2. `BrowserManager` 管理 Playwright 浏览器上下文
3. `BasePlatformAdapter` 实现共享登录流程
4. 至少一个具体适配器（Douyin，登录流程最成熟）
5. `CookieStore` 持久化 Cookie 到 SQLite
6. `PlatformCard` 组件显示登录状态
7. `QRLoginDialog` 显示登录流程状态

### 需创建的文件
- `electron/services/database/` — index.ts, schema.ts, migrations/001_accounts.ts, repositories/account.repo.ts
- `electron/services/browser/` — BrowserManager.ts, CookieStore.ts, StealthConfig.ts
- `electron/services/platform-adapters/` — IPlatformAdapter.ts, BasePlatformAdapter.ts, PlatformAdapterRegistry.ts
- `electron/services/platform-adapters/douyin/` — DouyinAdapter.ts, douyin-selectors.ts, douyin-urls.ts
- `electron/ipc/account.ipc.ts`
- `electron/utils/` — logger.ts, errors.ts, delays.ts
- `src/stores/accountStore.ts`
- `src/components/account/` — PlatformCard.tsx, QRLoginDialog.tsx, SessionStatusBadge.tsx
- `src/hooks/` — useIpc.ts, usePolling.ts
- `src/types/account.types.ts`

### 新增依赖
```
playwright-core, better-sqlite3, electron-log
```

### 关键实现细节
- **BrowserManager**: 使用 `chromium.launchPersistentContext()`，应用反检测补丁（navigator.webdriver=false 等）
- **登录流程**: 打开浏览器 → 等待二维码 → 截图发送到渲染进程 → 轮询登录成功 → 提取 Cookie 存入 SQLite
- **SQLite accounts 表**: id, platform, display_name, cookies (JSON), session_status, last_login_at

### 验证标准
- 点击抖音卡片的"登录"按钮，Playwright 浏览器打开抖音登录页
- 二维码出现在应用对话框中
- 手机扫码后 30 秒内检测到登录成功
- Cookie 存入 SQLite
- 关闭重启应用后抖音显示"已登录"

---

## Phase 3: 内容发布核心

**目标**: 用户可选择视频、填写统一编辑表单，通过 Playwright 自动化发布到抖音。

### 关键交付物
1. `VideoDropZone` 拖拽/选择视频文件
2. `FFmpegService` 验证视频格式/大小 + 提取封面帧
3. `UnifiedEditor` 统一编辑表单（标题、描述、话题标签、封面、声明）
4. `CoverSelector` 显示提取的帧 + 自定义上传
5. `HashtagInput` 标签输入组件
6. `DeclarationPicker` 声明多选组件
7. 抖音适配器扩展 `uploadVideo()` 和 `submitContent()`
8. `PublishRecord` 存入 SQLite

### 需创建的文件
- `electron/services/ffmpeg/` — FFmpegService.ts, VideoValidator.ts
- `electron/services/database/migrations/002_publish_records.ts`, `repositories/publish-record.repo.ts`
- `electron/ipc/publish.ipc.ts`, `electron/ipc/file-dialog.ipc.ts`
- `src/components/publish/` — VideoDropZone.tsx, VideoPreview.tsx, UnifiedEditor.tsx, HashtagInput.tsx, DeclarationPicker.tsx, CoverSelector.tsx, PublishTargetPicker.tsx
- `src/stores/publishStore.ts`, `src/hooks/usePublishFlow.ts`
- `src/types/publish.types.ts`, `src/types/video.types.ts`

### 新增依赖
```
fluent-ffmpeg, ffmpeg-static
```

### 关键实现细节
- **FFmpegService**: probeVideo() 提取元数据，extractFrames() 提取 8 帧封面候选
- **VideoValidator**: 按平台校验大小/时长/格式限制
- **抖音发布流程**: 导航到创作者页面 → 恢复 Cookie → setInputFiles() 上传视频 → 填写表单（模拟人类输入速度 50-150ms/字符）→ 点击发布

### 验证标准
- 拖入 .mp4 文件显示缩略图和元数据
- 封面选择器显示 8 帧提取结果
- 填写表单后点击发布，Playwright 自动完成上传和提交
- 发布记录保存到数据库

---

## Phase 4: 平台适配器扩展

**目标**: 四个平台全部可用，支持多平台一键发布。

### 关键交付物
1. `XiaohongshuAdapter`、`WechatChannelsAdapter`、`KuaishouAdapter`
2. 每个适配器定义 `getPlatformFields()` 返回平台专属字段
3. `PlatformCustomizer` + `PlatformFieldRenderer` 动态渲染平台字段
4. 多平台发布流程：上传一次，逐平台发布（串行，避免触发反爬）

### 需创建的文件
- `electron/services/platform-adapters/xiaohongshu/` — XiaohongshuAdapter.ts, xhs-selectors.ts, xhs-urls.ts
- `electron/services/platform-adapters/wechat-channels/` — WechatChannelsAdapter.ts, wc-selectors.ts, wc-urls.ts
- `electron/services/platform-adapters/kuaishou/` — KuaishouAdapter.ts, ks-selectors.ts, ks-urls.ts
- `src/components/publish/PlatformCustomizer.tsx`, `src/components/publish/PlatformFieldRenderer.tsx`

### 特殊处理
- **视频号**: 需要微信桌面端扫码，需检测微信是否安装
- **选择器隔离**: 每个平台的 DOM 选择器独立在 `*-selectors.ts` 中，平台页面更新只需改一个文件

### 验证标准
- 四个平台均可扫码登录
- 每个平台的自定义标签页显示专属字段
- 选择 3 个平台点击"全部发布"，串行依次完成

---

## Phase 5: 定时发布

**目标**: 支持定时发布，可管理待发布任务。

### 关键交付物
1. `PublishScheduler` 基于 node-cron 的定时调度
2. `TaskQueue` 串行任务执行 + 重试逻辑（最多 3 次，指数退避）
3. `SchedulePicker` 时间选择器（统一/分平台）
4. `PublishRecordsPage` 展示已发布和待发布内容
5. `PublishPreviewCard` 各平台预览效果

### 需创建的文件
- `electron/services/scheduler/` — PublishScheduler.ts, TaskQueue.ts
- `electron/services/database/migrations/003_scheduled_tasks.ts`, `repositories/scheduled-task.repo.ts`
- `src/components/publish/SchedulePicker.tsx`, `src/components/publish/PublishPreviewCard.tsx`
- `src/components/records/PublishRecordTable.tsx`, `src/components/records/TaskStatusTag.tsx`
- `src/stores/recordStore.ts`

### 新增依赖
```
node-cron, dayjs
```

### 关键实现细节
- 每 30 秒检查到期任务，串行执行避免触发反爬
- 应用重启后自动补发错过的定时任务
- 最小定时时间：当前时间 + 5 分钟

### 验证标准
- 定时 2 分钟后发布，到期自动执行
- 关闭应用后重启，错过的任务自动补发
- 可取消待发布的定时任务

---

## Phase 6: 数据统计分析

**目标**: 发布后可查看播放、互动、粉丝数据及跨平台对比。

### 关键交付物
1. `AnalyticsService` 通过 Playwright 抓取各平台数据
2. 数据缓存到 SQLite（30 分钟冷却期）
3. `AnalyticsPage` 仪表盘 + 图表
4. `PlaybackTrendChart`、`EngagementChart`、`FollowerGrowthChart`
5. `CrossPlatformCompare` 跨平台对比表格和图表

### 需创建的文件
- `electron/services/analytics/AnalyticsService.ts`
- `electron/services/database/migrations/004_analytics_cache.ts`, `repositories/analytics.repo.ts`
- `electron/ipc/analytics.ipc.ts`
- `src/components/analytics/` — DashboardOverview.tsx, PlaybackTrendChart.tsx, EngagementChart.tsx, FollowerGrowthChart.tsx, CrossPlatformCompare.tsx
- `src/stores/analyticsStore.ts`, `src/types/analytics.types.ts`

### 新增依赖
```
echarts, echarts-for-react
```

### 关键实现细节
- 中文数字格式（1.2万）、中文日期格式（YYYY年MM月DD日）
- 平台配色：抖音黑、小红书红、视频号绿、快手橙
- 跨平台对比高亮最佳平台，给出推荐

### 验证标准
- 发布后显示初始数据（0 播放）
- 点击刷新抓取最新数据
- 图表正确显示中文格式
- 跨平台对比表格正确展示

---

## Phase 7: 打磨与加固

**目标**: 生产级质量，健壮的错误处理和性能优化。

### 关键交付物
1. 全局错误处理 + 用户友好提示
2. 验证码检测：暂停自动化，提示用户手动处理
3. electron-updater 自动更新
4. 系统托盘集成
5. 键盘快捷键（Ctrl+N 新建发布，Ctrl+R 刷新数据）
6. 内存优化：限制并发浏览器实例，闲置 5 分钟后释放
7. 首次使用引导
8. 设置页：FFmpeg 路径、代理配置、数据目录、日志级别
9. 数据库导入/导出备份

### 需新增依赖
```
electron-updater, electron-store
```

### 验证标准
- 断网时上传显示清晰错误并重试
- 验证码出现时暂停并提示用户
- 应用内存占用 < 500MB（无活跃浏览器时）
- 设置项跨重启持久化
- 日志文件自动轮转

---

## 风险缓解

| 风险 | 缓解措施 |
|------|----------|
| Playwright 反爬检测 | StealthConfig 反检测补丁 + 人类行为模拟（随机延迟、打字速度） + `*-selectors.ts` 隔离选择器便于更新 |
| 平台页面变动 | 选择器集中管理，每月测试，支持手动 Cookie 导入作为降级方案 |
| FFmpeg 分发体积 | 开发用 ffmpeg-static，生产用 electron-builder extraResources 打包精简版 |
| SQLite Electron 兼容 | 必须用 @electron/rebuild 重新编译 better-sqlite3 |
| 视频号需微信桌面端 | 检测微信安装状态，提供手动 Cookie 导入降级 |

## 依赖总览

**生产依赖**: react, react-dom, react-router-dom, antd, @ant-design/icons, zustand, playwright-core, better-sqlite3, electron-log, fluent-ffmpeg, ffmpeg-static, node-cron, dayjs, echarts, echarts-for-react, electron-updater, electron-store, uuid

**开发依赖**: electron, electron-builder, electron-vite, @vitejs/plugin-react, typescript, vitest, eslint, prettier, @electron/rebuild, 各种 @types
