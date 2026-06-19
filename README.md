<div align="center">

# Flow

### Create once. Flow everywhere.

多平台视频同步发布工具 — 一次创作，一键发布到抖音、小红书、视频号、快手。

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## ✨ 功能特性

### 支持平台

| 平台 | 登录方式 | 发布模式 | 数据采集 | 状态 |
|:----:|:-------:|:-------:|:-----:|:----:|
| 🎵 抖音 | 扫码登录 | API 直调 | ✅ | ✅ |
| 📕 小红书 | 扫码登录 | API 直调 | ✅ | ✅ |
| 💬 微信视频号 | 扫码登录 | API 直调 | ✅ | ✅ |
| ⚡ 快手 | 扫码登录 | API 直调 | ✅ | ✅ |

### 核心能力

- 🚀 **统一 API 发布** — 官方 OpenAPI 优先；未接入官方能力的平台仅在用户授权下回落到网页 API + 本机 signer
- 🔐 **隔离登录** — 原生 Electron BrowserWindow 扫码登录，按账号使用独立 session 分区，降低串号和 Cookie 污染风险
- 🔑 **本机自托管签名** — 平台网页签名（`a_bogus`、`X-s/X-t`、`__NS_sig3`）优先走本机 signer，不再默认依赖第三方签名服务
- 🛡️ **签名兜底策略** — 本机 signer 不可用时默认自动启用 App 内置本机浏览器签名；可通过环境变量恢复确认弹窗
- 🧯 **发布风险守卫** — 同账号同平台串行发布，提交默认间隔 60 秒，遇到风控/验证类错误自动冷却
- 🖼️ **智能封面** — 自动提取推荐帧作为封面，支持横版/竖版自由裁剪
- ✏️ **内容定制** — 话题标签、@提及、POI 地点搜索、内容声明，各平台独立字段覆盖
- 📏 **字数智能校验** — 按平台区分标题、描述、话题标签字数限制，多平台发布自动取交集
- ⏰ **定时发布** — Cron 调度引擎，每 30 秒轮询待执行任务，支持重试机制
- 📊 **数据中心** — 视频数据自动采集、多平台分组对比、趋势图表分析
- 🔄 **登录状态检测** — 启动时 API 验证账号有效性，过期/失效账号实时提醒
- 🍪 **Cookie 安全存储** — 基于 Electron `safeStorage` 的操作系统级加密，HTTP 客户端自动刷新合法 Cookie

### 发布模式硬约束

Flow 的发布链路只允许使用 API/HTTP 模式。所有平台，包括小红书，禁止使用创作者中心 UI 自动化作为发布方案或失败兜底。

允许的范围：

- 通过官方 OpenAPI、平台网页 API、上传接口、签名接口、状态查询接口完成发布。
- 使用登录窗口获取用户授权会话。
- 使用本机 signer 或隐藏签名上下文生成 API/HTTP 请求所需的签名和请求头。
- 在 API/HTTP 返回异常、HTTP 461、缺少 `note_id`、缺少内容 ID 或结果无法确认时，保留日志并继续排查 API/HTTP 请求链路。

禁止的范围：

- 打开平台创作者中心发布页，自动上传视频或封面。
- 自动填写标题、正文、话题、位置、声明、封面等页面表单。
- 自动点击发布、提交、确认发布等 UI 按钮。
- 使用 Playwright、Chrome、Electron BrowserWindow、DOM 注入、`setInputFiles`、键盘/鼠标事件或文件选择器模拟用户完成发布。
- 在 API/HTTP 失败后切换到“真实页面发布”“创作者中心发布”“RPA 发布”等 UI 自动化兜底。

这条约束是项目级规则。新对话、新 Agent 或新的排查方案也必须继续按 API/HTTP 发布模式推进，不得改成模拟用户在平台创作中心发布。

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- FFmpeg（需在 PATH 中或手动配置路径）

### 安装运行

```bash
# 克隆仓库
git clone https://github.com/lt2236465917-design/flow-publisher.git
cd flow-publisher

# 安装依赖
npm install

# 启动开发
npm run dev
```

### 构建打包

```bash
# Windows (NSIS 安装包)
npm run build:win

# macOS (DMG，支持 x64 + arm64)
npm run build:mac
```

---

## 🏗️ 架构设计

### 双模式架构

项目曾经历从 **浏览器自动化模式**（Playwright 操控页面）到 **API 直调模式**（HTTP 接口直连）的全面迁移。当前所有平台均已切换为 API 直调模式，Playwright 仅保留用于本地签名服务的回退方案。

```
┌─────────────────────────────────────────────────┐
│                   Renderer (React)               │
│  AccountPage  PublishPage  DataPage  SettingsPage│
│        │            │           │          │     │
│        └────────────┼───────────┼──────────┘     │
│                     │   IPC     │                │
├─────────────────────┼───────────┼────────────────┤
│                Main Process (Electron)           │
│  ┌──────────────────┴───────────┴──────────┐    │
│  │           IPC Handlers                   │    │
│  │  account  publish  scheduler  analytics  │    │
│  └──────────────────┬───────────────────────┘    │
│                     │                            │
│  ┌──────────────────┴───────────────────────┐    │
│  │          Service Layer                    │    │
│  │  PlatformAdapter  SignService  FFmpeg    │    │
│  │  Scheduler  AnalyticsCollector  Database │    │
│  │  HttpClient  LocationService             │    │
│  └──────────────────────────────────────────┘    │
│                     │                            │
│  ┌──────────────────┴───────────────────────┐    │
│  │          Platform APIs                    │    │
│  │  抖音 · 小红书 · 视频号 · 快手              │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 平台适配器架构

```
IPlatformAdapter (接口)
  ├── IPublishable        — 视频上传 + 内容提交
  ├── ISessionCheckable   — 会话有效性验证
  ├── IAnalyticsCapable   — 数据采集
  ├── ILocationCapable    — 位置搜索
  └── ICollectionCapable  — 合集/专辑管理
       │
       └── BasePlatformAdapter (抽象基类)
              ├── DouyinApiAdapter      抖音
              ├── XhsApiAdapter         小红书
              ├── KsApiAdapter          快手
              └── WcApiAdapter          微信视频号
```

### 签名服务

```
SignService
  ├── 优先级 1: 本机自托管 signer (默认 http://127.0.0.1:17321/sign)
  │     — Cookie/请求数据不发送到第三方签名服务
  ├── 优先级 2: 快手蚁小二兼容 __NS_sig3 signer
  │     — 仅发送 md5(requestBody)，不发送登录 Cookie；可设 FLOW_PUBLISHER_KUAISHOU_YIXIAOER_SIGNER=disabled 关闭
  ├── 优先级 3: App 内置本机 Playwright 签名
  │     — 默认自动启用；可设置 FLOW_PUBLISHER_AUTO_CONFIRM_BUILTIN_SIGNER=false 恢复确认弹窗
  └── 优先级 4: 蚁小二兼容签名服务
        — 小红书 note create 默认使用 newxiaohongshu signer 获取完整 X-S-Common
        — 仅发送接口路径和最终请求 body，不发送登录 Cookie
        — 可设置 FLOW_PUBLISHER_XHS_YIXIAOER_SIGNER=disabled 关闭
        — 其他旧外部签名默认禁用，仅 FLOW_PUBLISHER_ALLOW_LEGACY_EXTERNAL_SIGNER=true 时启用
        — 也可通过 FLOW_PUBLISHER_LEGACY_SIGNER_URL 或按平台 URL 显式启用
        — 抖音 a_bogus / 小红书 X-s, X-t, X-S-Common / 快手 __NS_sig3
```

官方 OpenAPI 会优先于网页私有 API。当前快手可通过
`FLOW_PUBLISHER_KUAISHOU_OPENAPI_APP_ID` 和
`FLOW_PUBLISHER_KUAISHOU_OPENAPI_ACCESS_TOKEN` 启用官方发布通道；未配置时
回落到网页 API + 本机 signer。抖音内容发布 OpenAPI 仍需平台内测开通，拿到
权限和接口参数后再启用官方通道。

本机 signer 默认请求 `http://127.0.0.1:17321/sign`。未配置
`FLOW_PUBLISHER_SIGNER_URL` 时，App 只会尝试连接本机默认端口；如果不可用，会自动启用
App 内置本机浏览器签名。托管 signer 默认关闭，需要显式设置
`FLOW_PUBLISHER_MANAGED_SIGNER=true` 才会启动只监听本机 loopback 的 signer。
也可以通过 `FLOW_PUBLISHER_SIGNER_URL` 指定其他 signer。接口约定：

```json
{
  "platform": "douyin | xiaohongshu | kuaishou",
  "cookie": "平台登录 Cookie",
  "data": "待签名 URL 或 JSON 字符串",
  "body": "请求 body 字符串",
  "url": "抖音等平台需要的完整待签名 URL",
  "signType": "browser"
}
```

返回：

```json
{ "signature": "签名字符串或 JSON 字符串" }
```

蚁小二兼容 signer 可配置为完整 endpoint：

```bash
# 通用：会自动补 /Sign/GetSign
FLOW_PUBLISHER_LEGACY_SIGNER_URL=http://127.0.0.1:5061

# 或按平台拆分
FLOW_PUBLISHER_KUAISHOU_LEGACY_SIGNER_URL=http://127.0.0.1:5008
FLOW_PUBLISHER_XHS_LEGACY_SIGNER_URL=http://127.0.0.1:5061
```

也可以配置 base + ports：

```bash
FLOW_PUBLISHER_LEGACY_SIGNER_BASE_URL=http://127.0.0.1
FLOW_PUBLISHER_KUAISHOU_LEGACY_SIGNER_PORTS=5004,5005,5006,5007,5008
FLOW_PUBLISHER_XHS_LEGACY_SIGNER_PORTS=5061,5062,5063
```

小红书发布接口必须拿到完整网页签名，至少包含 `X-s`、`X-t`、`X-S-Common`。实测只有
`X-s` / `X-t` / `x-rap-param` 时，`/web_api/sns/v2/note` 可能返回 HTTP 461 +
空 `success:true`，但不会生成审核中或草稿记录。因此 `x-rap-param` 只能留在生成它的
认证浏览器会话中执行 HTTP API 请求，不能复制到 Node/Axios 跨上下文重放。蚁小二的 API 发布路径会对
`/web_api/sns/v2/note` 的 body 调用 `newxiaohongshu` signer（默认端口
`5061,5062,5063`），返回签名后再走 HTTP POST。这个兼容 signer 会接收待签名的
path/body，涉及内容数据外发风险，因此本项目不默认启用，必须通过上述环境变量显式配置。

风险守卫相关配置：

```bash
# 同账号同平台两次提交之间的最小间隔，默认 60000
FLOW_PUBLISHER_MIN_SUBMIT_INTERVAL_MS=60000

# 遇到风控/验证/403 类错误后的冷却时间，默认 600000
FLOW_PUBLISHER_RISK_COOLDOWN_MS=600000

# 是否自动启动内置托管 signer，默认关闭。小红书会在官方创作页运行时
# 捕获最终发送前的完整 x-* 请求头，并取消探测请求，再由 HTTP 发布链路提交。
FLOW_PUBLISHER_MANAGED_SIGNER=false

# 是否跳过内置本机签名确认弹窗，默认开启；设置 false/off/disabled 可恢复确认弹窗
FLOW_PUBLISHER_AUTO_CONFIRM_BUILTIN_SIGNER=true

# 小红书网页签名加载的创作页，默认使用新版创作页
FLOW_PUBLISHER_XHS_SIGN_CONTEXT_URL=https://creator.xiaohongshu.com/new/publish

# 快手“检查登录状态”真实接口超时时间，默认 10000
FLOW_PUBLISHER_KUAISHOU_SESSION_CHECK_TIMEOUT_MS=10000

# 是否启用快手蚁小二兼容 __NS_sig3 兜底，默认启用；设置 disabled/off/false 可关闭
FLOW_PUBLISHER_KUAISHOU_YIXIAOER_SIGNER=on
```

说明：网页 API 和本机 signer 仍属于平台网页链路自动化，不能承诺规避平台风控；生产环境应优先申请并使用官方 OpenAPI。

---

## 🛠️ 技术栈

| 类型 | 技术 |
|:----:|:----:|
| 桌面框架 | Electron 33 |
| 前端框架 | React 18 + TypeScript |
| UI 组件 | Ant Design 5 + @ant-design/charts |
| 状态管理 | Zustand 5 |
| 路由 | React Router 6 |
| 视频处理 | FFmpeg (fluent-ffmpeg) |
| 数据库 | SQLite (sql.js) |
| HTTP 客户端 | Axios |
| 定时任务 | node-cron |
| 浏览器自动化 | Playwright (签名服务回退) |
| 构建工具 | electron-vite + electron-builder |
| 自动更新 | electron-updater |
| 图片裁剪 | react-easy-crop |
| 加密存储 | Electron safeStorage |

---

## 📁 项目结构

```
flow-publisher/
├── electron/                          # 主进程
│   ├── main.ts                        # 应用入口，窗口管理，IPC 注册
│   ├── preload.ts                     # 预加载脚本（安全 IPC 桥接）
│   ├── ipc/                           # IPC 处理器
│   │   ├── account.ipc.ts             # 账号登录、会话管理
│   │   ├── publish.ipc.ts             # 视频探针、上传、发布
│   │   ├── scheduler.ipc.ts           # 定时任务管理
│   │   ├── analytics.ipc.ts           # 数据采集与分析
│   │   └── file-dialog.ipc.ts         # 文件选择与读写
│   ├── services/
│   │   ├── platform-adapters/         # 平台适配器
│   │   │   ├── IPlatformAdapter.ts    # 统一接口定义
│   │   │   ├── BasePlatformAdapter.ts # 抽象基类
│   │   │   ├── PlatformAdapterRegistry.ts
│   │   │   ├── douyin/                # 抖音适配器
│   │   │   ├── xiaohongshu/           # 小红书适配器
│   │   │   ├── kuaishou/              # 快手适配器
│   │   │   └── wechat-channels/       # 视频号适配器
│   │   ├── database/                  # SQLite 数据库
│   │   │   ├── index.ts              # 初始化、迁移、备份
│   │   │   ├── schema.ts             # 基础表结构
│   │   │   ├── migrations/           # 7 次数据库迁移
│   │   │   └── repositories/         # 4 个数据仓库
│   │   ├── browser/                   # 登录窗口与旧浏览器配置
│   │   │   ├── ElectronLoginWindow.ts # 原生扫码登录窗口
│   │   │   ├── CookieStore.ts         # 加密 Cookie 存储
│   │   │   └── StealthConfig.ts       # 旧浏览器启动配置
│   │   ├── http/                      # HTTP 客户端
│   │   │   └── HttpClient.ts          # Axios + Cookie 自动刷新
│   │   ├── sign/                      # 签名服务
│   │   │   └── SignService.ts         # 外部 + 本地双通道签名
│   │   ├── scheduler/                 # 定时调度
│   │   │   ├── PublishScheduler.ts    # Cron 引擎
│   │   │   └── TaskQueue.ts           # 顺序执行 + 重试
│   │   ├── ffmpeg/                    # 视频处理
│   │   │   ├── FFmpegService.ts       # 探针 + 帧提取
│   │   │   └── VideoValidator.ts      # 平台视频约束校验
│   │   ├── analytics/                 # 数据分析
│   │   │   └── AnalyticsCollectorService.ts
│   │   └── location/                  # 位置服务
│   │       └── IPLocationService.ts   # IP 地理位置
│   └── utils/                         # 工具函数
│       ├── logger.ts                  # 日志封装
│       ├── crypto-store.ts            # 加密存储
│       ├── errors.ts                  # 错误定义
│       ├── delays.ts                  # 重试/延迟
│       └── file-hash.ts               # 文件校验
├── src/                               # 渲染进程 (React UI)
│   ├── main.tsx                       # 入口，主题配置
│   ├── App.tsx                        # 路由定义
│   ├── pages/                         # 页面组件
│   │   ├── AccountPage.tsx            # 账号管理
│   │   ├── PublishPage.tsx            # 创作发布
│   │   ├── DataPage.tsx               # 数据中心
│   │   └── SettingsPage.tsx           # 应用设置
│   ├── components/                    # 通用组件
│   │   ├── common/                    # 布局、错误边界
│   │   ├── account/                   # 平台卡片、扫码登录
│   │   ├── publish/                   # 视频拖拽、封面裁剪、编辑器
│   │   └── records/                   # 发布记录、任务状态
│   ├── stores/                        # Zustand 状态管理
│   ├── hooks/                         # 自定义 Hooks
│   ├── constants/                     # 常量定义
│   │   ├── platforms.ts               # 平台基础信息
│   │   ├── platform-limits.ts         # 字数/标签限制
│   │   └── ipc-channels.ts            # IPC 通道名称
│   ├── types/                         # 类型定义
│   └── utils/                         # 工具函数
└── shared/                            # 共享类型
    ├── contracts/                     # IPC 契约定义
    │   ├── ipc.contract.ts
    │   ├── platform.contract.ts
    │   └── analytics.contract.ts
    └── types/                         # 共享类型
```

---

## 🗄️ 数据库设计

### 核心表

| 表名 | 用途 | 关键字段 |
|:----:|:----:|:-----:|
| `accounts` | 平台账号 | id, platform, cookies, session_status |
| `publish_records` | 发布记录 | id, account_id, group_id, status, progress_stage, upload_meta |
| `scheduled_tasks` | 定时任务 | id, platforms, scheduled_at, status, retry_count |
| `analytics_snapshots` | 数据快照 | id, record_id, views, likes, comments, shares, snapshot_at |
| `video_groups` | 视频分组 | id, title, video_path, created_at |

### 数据库特性

- **自动备份** — 数据库写入前自动备份，最多保留 5 个备份版本
- **渐进式迁移** — 7 次数据库迁移，支持从任意旧版本平滑升级
- **外键约束** — `analytics_snapshots.record_id` 级联删除，保证数据一致性

---

## 📊 数据中心

### 功能说明

数据中心整合发布记录与视频数据统计，提供统一的视频数据管理界面。

#### 核心特性

- **自动分组** — 同一视频在 10 分钟内发布到多个平台的内容自动合并为一条记录
- **跨平台对比** — 柱状图 + 表格展示各平台播放量、点赞、评论、分享、收藏数据
- **智能采集** — 支持抖音、快手、小红书、视频号四个平台的数据采集
- **按需采集** — 列表页采集全部数据，详情页采集当前视频数据
- **趋势分析** — 按日/周/月维度查看数据变化趋势

#### 支持采集的数据指标

| 平台 | 播放量 | 点赞 | 评论 | 分享 | 收藏 |
|:----:|:-----:|:---:|:---:|:---:|:---:|
| 抖音 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 快手 | ✅ | ✅ | ✅ | - | ✅ |
| 小红书 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 视频号 | ✅ | ✅ | ✅ | ✅ | ✅* |

> *视频号没有明确的收藏功能，使用红心数作为收藏数据

---

## 📋 开发进度

- [x] 多平台账号管理（扫码登录 + 会话持久化）
- [x] 账号登录状态自动检测（启动时 API 验证 + 手动检查）
- [x] 视频拖拽上传 + 封面裁剪（react-easy-crop）
- [x] 内容编辑（标题、描述、话题标签、@提及、POI、内容声明）
- [x] 平台字段独立覆盖（各平台可定制不同内容）
- [x] 按平台区分的字数/标签限制校验
- [x] 抖音 API 直调发布（ByteDance VOD + ImageX）
- [x] 小红书 API 直调发布（Tencent COS 分片上传）
- [x] 微信视频号 API 直调发布
- [x] 快手 API 直调发布（官方 OpenAPI 优先，CP REST API 回退）
- [x] 端到端签名服务（本机 signer + 内置本机签名，旧外部签名默认禁用）
- [x] 签名兜底策略（默认自动启用内置本机签名，可按需恢复确认弹窗）
- [x] 定时发布 + 任务队列（Cron + 顺序执行 + 重试）
- [x] 发布记录追踪（含上传元数据持久化、进度恢复）
- [x] 数据中心（视频数据采集 + 自动分组 + 跨平台对比 + 趋势分析）
- [x] Cookie 加密存储（Electron safeStorage）
- [x] 自动更新支持（electron-updater）
- [ ] 多语言支持
- [ ] 批量导入发布
- [ ] AI 辅助内容生成

---

## 🔒 安全性

- **Context Isolation** — 渲染进程与主进程严格隔离
- **进程沙箱** — 渲染进程启用 `sandbox: true`
- **IPC 白名单** — preload 脚本仅暴露授权通道
- **Cookie 加密** — 基于操作系统级 `safeStorage` API 加密存储
- **本地文件协议** — 自定义 `local-file:` 协议，路径白名单校验，防止符号链接/交叉点遍历攻击
- **域名校验** — HTTP 客户端在更新 Cookie 时验证域名合法性，防止 Cookie 注入

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**Flow** — Create once. Flow everywhere.

</div>
