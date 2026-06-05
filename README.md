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

| 平台 | 登录方式 | 发布模式 | 状态 |
|:----:|:-------:|:-------:|:----:|
| 🎵 抖音 | 扫码登录 | API 直调 | ✅ |
| 📕 小红书 | 扫码登录 | API 直调 | ✅ |
| 💬 微信视频号 | 扫码登录 | API 直调 | ✅ |
| ⚡ 快手 | 扫码登录 | API 直调 | ✅ |

### 核心能力

- 🚀 **API 直调发布** — 直接调用平台接口，速度快，稳定性高
- 🖼️ **智能封面** — 自动提取推荐封面，支持横版/竖版裁剪
- ✏️ **内容定制** — 话题标签、@提及、POI 地点、内容声明
- ⏰ **定时发布** — 设置发布时间，到点自动发布
- 📊 **数据中心** — 视频数据采集与跨平台对比分析
- 🔐 **安全登录** — Electron 内置窗口扫码，不被平台检测
- 🔄 **登录状态检测** — 启动时自动验证账号有效性，过期账号实时提醒

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
# Windows
npm run build:win

# macOS
npm run build:mac
```

---

## 🛠️ 技术栈

| 类型 | 技术 |
|:----:|:----:|
| 桌面框架 | Electron 33 |
| 前端框架 | React 18 + TypeScript |
| UI 组件 | Ant Design 5 |
| 状态管理 | Zustand 5 |
| 视频处理 | FFmpeg |
| 数据库 | SQLite (sql.js) |
| 定时任务 | node-cron |

---

## 📁 项目结构

```
flow-publisher/
├── electron/                    # 主进程
│   ├── ipc/                     # IPC 处理器
│   ├── services/
│   │   ├── browser/             # 登录窗口 + Cookie 存储
│   │   ├── database/            # SQLite 数据库
│   │   ├── http/                # HTTP 客户端
│   │   ├── platform-adapters/   # 平台适配器
│   │   ├── sign/                # 签名服务
│   │   ├── ffmpeg/              # 视频处理
│   │   └── scheduler/           # 定时调度
│   └── utils/
├── src/                         # 渲染进程 (React UI)
│   ├── pages/                   # 页面组件
│   ├── components/              # 通用组件
│   ├── stores/                  # 状态管理
│   └── hooks/                   # 自定义 Hooks
└── shared/                      # 共享类型定义
```

---

## 📋 开发进度

- [x] 多平台账号管理（扫码登录 + 会话持久化）
- [x] 账号登录状态自动检测（启动时 API 验证 + 手动检查）
- [x] 视频拖拽上传 + 封面裁剪
- [x] 内容编辑（标题、描述、话题、声明）
- [x] 抖音 API 直调发布
- [x] 小红书 API 直调发布
- [x] 微信视频号 API 直调发布
- [x] 快手 API 直调发布
- [x] 定时发布 + 任务队列
- [x] 发布记录追踪
- [x] 数据中心（视频数据采集与跨平台对比）

---

## 📊 数据中心

### 功能说明

数据中心整合了发布记录与视频数据统计，提供统一的视频数据管理界面。

#### 核心特性

- **自动分组** — 同一视频在 10 分钟内发布到多个平台的内容自动合并为一条记录
- **跨平台对比** — 柱状图 + 表格展示各平台播放量、点赞、评论、分享、收藏数据
- **智能采集** — 支持抖音、快手、小红书、视频号四个平台的数据采集
- **按需采集** — 列表页采集全部数据，详情页采集当前视频数据

#### 支持采集的数据指标

| 平台 | 播放量 | 点赞 | 评论 | 分享 | 收藏 |
|:----:|:-----:|:---:|:---:|:---:|:---:|
| 抖音 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 快手 | ✅ | ✅ | ✅ | - | ✅ |
| 小红书 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 视频号 | ✅ | ✅ | ✅ | ✅ | ✅* |

> *视频号没有明确的收藏功能，使用红心数作为收藏数据

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**Flow** — Create once. Flow everywhere.

</div>
