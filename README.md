<div align="center">

# Flow

### Create once. Flow everywhere.

多平台视频同步发布工具 — 一次创作，一键发布到抖音、小红书、视频号、快手。

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/Limit-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## 功能特性

### 跨平台发布

选择视频，编辑内容，一键发布到多个平台：

| 平台 | 登录方式 | 发布模式 | 状态 |
|------|---------|---------|------|
| 抖音 | 扫码登录 | API 直调 | ✅ 已通（VOD 上传 + STS 认证 + a_bogus 签名） |
| 小红书 | 扫码登录 | API 直调 | ✅ 已通（分片上传 + X-S-Common 签名 + yixiaoer 签名服务） |
| 微信视频号 | 扫码登录 | API 直调 | ✅ 已通（CDN 分块上传 + post_create） |
| 快手 | 扫码登录 | API 直调 | ✅ 已通（分片上传 + __NS_sig3 签名） |

### 核心能力

- **API 直调发布** — 直接调用平台接口，速度快，稳定性高，与真实用户行为一致
- **智能封面** — 拖拽上传视频，自动提取推荐封面，支持横版 4:3 与竖版 3:4 裁剪
- **内容定制** — 话题标签、@提及、POI 地点、内容声明，每个平台独立配置
- **定时发布** — 设置发布时间，到点自动发布，支持定时队列管理
- **发布记录** — 完整的发布历史追踪，失败自动重试
- **数据统计** — 发布趋势、成功率、跨平台对比分析

### 账号管理

- Electron 内置窗口扫码登录（与 yixiaoer 相同方式，不被平台检测为自动化）
- 多账号并行，独立管理
- 会话状态自动检测

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    渲染进程 (React)                    │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │ 账号管理  │ 内容发布  │ 发布记录  │ 数据统计  │      │
│  └──────────┴──────────┴──────────┴──────────┘      │
│                    Zustand 状态管理                    │
├─────────────────────────────────────────────────────┤
│                    主进程 (Electron)                   │
│  ┌──────────────────────────────────────────────┐   │
│  │           平台适配器 (Platform Adapters)        │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │   │
│  │  │ 抖音  │ │ 小红书 │ │ 视频号 │ │ 快手  │        │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘        │   │
│  ├──────────────────────────────────────────────┤   │
│  │  HttpClient (Cookie 注入 + UA 伪装)           │   │
│  │  SignService (yixiaoer 外部签名 + 本地签名)    │   │
│  │  ElectronLoginWindow (内置浏览器扫码登录)      │   │
│  ├──────────────────────────────────────────────┤   │
│  │  FFmpeg (视频处理) │ SQLite (本地存储)          │   │
│  │  node-cron (定时调度) │ 文件对话框              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript + Ant Design 5 |
| 状态管理 | Zustand 5 |
| 登录方式 | Electron 内置 BrowserWindow（非 Playwright，不被检测） |
| 视频处理 | FFmpeg（fluent-ffmpeg） |
| 数据库 | sql.js（SQLite WASM） |
| 定时任务 | node-cron |
| 图表 | @ant-design/charts（AntV G2） |

## 快速开始

### 环境要求

- Node.js >= 18
- FFmpeg（需在 PATH 中或手动配置路径）
- Windows / macOS / Linux

### 安装

```bash
# 克隆仓库
git clone https://github.com/lt2236465917-design/flow-publisher.git
cd flow-publisher

# 安装依赖
npm install
```

### 开发

```bash
npm run dev
```

### 构建

```bash
# Windows
npm run build:win

# macOS
npm run build:mac
```

## 项目结构

```
├── electron/                    # 主进程
│   ├── main.ts                  # 入口，窗口创建，调度器初始化
│   ├── ipc/                     # IPC 处理器
│   │   ├── account.ipc.ts       # 账号管理（ElectronLoginWindow 登录）
│   │   ├── publish.ipc.ts       # 发布流程（API 模式）
│   │   └── scheduler.ipc.ts     # 定时任务
│   ├── services/
│   │   ├── browser/             # ElectronLoginWindow + Cookie 存储
│   │   ├── database/            # SQLite 数据库 + 迁移
│   │   ├── http/                # 统一 HTTP 客户端（2026 最新 UA）
│   │   ├── platform-adapters/   # 平台适配器（API 模式）
│   │   │   ├── douyin/          # 抖音 API 适配
│   │   │   ├── xiaohongshu/     # 小红书 API 适配
│   │   │   ├── wechat-channels/ # 微信视频号 API 适配
│   │   │   └── kuaishou/        # 快手 API 适配
│   │   ├── sign/                # 签名服务（yixiaoer 外部 + 本地）
│   │   ├── ffmpeg/              # 视频处理
│   │   └── scheduler/           # 定时发布调度
│   └── utils/
├── src/                         # 渲染进程 (React UI)
│   ├── pages/                   # 页面
│   │   ├── AccountPage.tsx      # 账号管理
│   │   ├── PublishPage.tsx      # 内容发布
│   │   ├── PublishRecordsPage.tsx # 发布记录
│   │   ├── AnalyticsPage.tsx    # 数据统计
│   │   └── SettingsPage.tsx     # 设置
│   ├── components/              # 组件
│   ├── stores/                  # Zustand 状态管理
│   ├── hooks/                   # 自定义 Hooks
│   └── styles/                  # 全局样式 + 设计系统
└── shared/                      # 主进程/渲染进程共享类型
```

## 设计理念

> *"Simplicity is the ultimate sophistication."*

Flow 采用 Apple 设计语言：

- **Sora** 标题字体 + **DM Sans** 正文字体
- `#0071e3` 主题蓝，`#1d1d1f` 深色侧边栏
- `#f5f5f7` Apple 标志性灰色背景
- 14px 圆角卡片，丝滑过渡动画
- CSS 变量驱动的完整设计系统

## 当前状态

### 已完成

- [x] 多平台账号管理（Electron 内置窗口扫码登录 + 会话持久化）
- [x] 视频拖拽上传 + 封面裁剪
- [x] 内容编辑（标题、描述、话题、声明）
- [x] **抖音 API 直调发布** — STS 认证 + VOD 上传 + a_bogus 签名
- [x] **小红书 API 直调发布** — 5MB 分片上传（3 并发） + X-s/X-t/X-S-Common 签名
- [x] **微信视频号 API 直调发布** — 16MB 分块上传（6 并发） + post_create 提交
- [x] **快手 API 直调发布** — 分片上传 + __NS_sig3 签名
- [x] 定时发布 + 任务队列（部分成功状态支持）
- [x] 发布记录追踪
- [x] 数据统计与可视化
- [x] 浏览器版本号保持最新（Chrome 136 / Edge 136）

### 开发中

- [ ] 更多平台支持

### 已知问题

- 部分平台 API 端点可能随平台更新变化
- 视频号上传速度受 CDN 服务器响应影响

## License

[MIT](LICENSE)

---

<div align="center">

**Flow** — Create once. Flow everywhere.

</div>
