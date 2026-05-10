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

## 功能特性

**跨平台发布** — 选择视频，编辑内容，一键发布到多个平台：
- 抖音
- 小红书
- 微信视频号
- 快手

**智能工作流**
- 拖拽上传视频，自动提取推荐封面
- 横版 4:3 与竖版 3:4 双封面裁剪
- 话题标签、内容声明一键设置
- 每个平台支持独立定制字段

**定时发布** — 设置发布时间，到点自动发布。

**数据统计** — 发布趋势、成功率、跨平台对比分析。

**账号管理** — 扫码登录，会话持久化，多账号并行。

## 截图

<div align="center">
<table>
  <tr>
    <td align="center"><b>账号管理</b></td>
    <td align="center"><b>内容发布</b></td>
    <td align="center"><b>数据统计</b></td>
  </tr>
  <tr>
    <td>连接平台账号，扫码登录</td>
    <td>拖拽视频，编辑内容，一键发布</td>
    <td>趋势图表，跨平台对比</td>
  </tr>
</table>
</div>

## 技术架构

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript + Ant Design 5 |
| 状态管理 | Zustand 5 |
| 浏览器自动化 | Playwright-core（反检测模式） |
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
├── electron/              # 主进程
│   ├── main.ts            # 入口，窗口创建，调度器初始化
│   ├── ipc/               # IPC 处理器
│   ├── services/
│   │   ├── browser/       # Playwright 浏览器管理
│   │   ├── database/      # SQLite 数据库
│   │   ├── platform-adapters/  # 平台适配器（抖音/小红书/视频号/快手）
│   │   ├── ffmpeg/        # 视频处理
│   │   └── scheduler/     # 定时发布调度
│   └── utils/
├── src/                   # 渲染进程（React UI）
│   ├── pages/             # 页面（5个）
│   ├── components/        # 组件
│   ├── stores/            # Zustand 状态管理
│   ├── hooks/             # 自定义 Hooks
│   ├── constants/         # 常量定义
│   └── styles/            # 全局样式 + 设计系统
└── shared/                # 主进程/渲染进程共享类型
```

## 设计理念

> *"Simplicity is the ultimate sophistication."*

Flow 采用 Apple 设计语言：

- **Sora** 标题字体 + **DM Sans** 正文字体
- `#0071e3` 主题蓝，`#1d1d1f` 深色侧边栏
- `#f5f5f7` Apple 标志性灰色背景
- 14px 圆角卡片，丝滑过渡动画
- CSS 变量驱动的完整设计系统

## 许可证

[MIT](LICENSE)

---

<div align="center">

**Flow** — Create once. Flow everywhere.

</div>
