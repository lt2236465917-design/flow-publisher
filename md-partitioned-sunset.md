# 封面模块修复 — 交接语

## 当前状态

**最新 commit**: `55c9912` — Fix: 封面模块修复 — 发布时封面丢失 + 裁剪组件CSS缺失

**未解决的核心问题**: 用户在封面区域点击"点击上传" → 选择图片后，封面仍然空白，裁剪弹窗不显示。

## 已完成的工作

### 1. 发布时封面丢失（已修复）
- `usePublishFlow.publish()` 中 `coverPath` 始终为 `null`，因为上传流程只设置 `horizontalCover`/`verticalCover`（data URL），从未设置 `coverPath`
- 修复：新增 `FILE_DATA_URL_TO_TEMP` IPC handler，将 data URL 转为临时文件路径；发布前调用此 IPC 将 `horizontalCover` 转为 `coverPath`

### 2. 适配器不上传封面（已修复）
- `DouyinAdapter.submitContent()` 和 `XhsAdapter.submitContent()` 从未读取 `payload.coverPath`
- 修复：在两个适配器的 `submitContent()` 中，填写文字后、点击发布前，通过 `coverUpload` 选择器 (`input[type="file"][accept*="image"]`) 调用 `setInputFiles(coverPath)` 上传封面

### 3. react-easy-crop CSS 缺失（已修复）
- `CropModal.tsx` 导入了 `Cropper` 组件但未导入 `react-easy-crop/react-easy-crop.css`
- 导致裁剪弹窗的容器无 `position: absolute` 等关键样式，图片和裁剪区域不可见

### 4. crossOrigin 属性（已修复）
- `CropModal.tsx` 的 `createImage()` 设置了 `crossOrigin='anonymous'`，在 Electron 中可能导致 canvas 被污染，`toBlob` 返回 `null`

## 未解决：选图后无反应

**症状**: 点击"点击上传" → 文件选择对话框弹出 → 选择图片 → 封面区域仍空白，裁剪弹窗不出现。

**已排查的可能原因**:
1. IPC channel 注册冲突 — 不存在，`FILE_SELECT_IMAGE` 只注册了一次
2. IPC handler 未被调用 — 已在 handler 中加了 `logger.info('[FILE_SELECT_IMAGE] >>> handler invoked')`，需要检查主进程日志
3. preload 桥接问题 — `window.electron.ipcRenderer.invoke` 正确暴露，理论上应工作

**下一步排查方向**:
1. 运行 `npm run dev`，操作一次封面上传
2. 检查主进程日志中是否出现 `[FILE_SELECT_IMAGE] >>> handler invoked`
   - 如果出现：IPC 正常，问题在渲染进程侧（dataUrl 处理或 CropModal 渲染）
   - 如果未出现：IPC 调用未到达主进程，问题在 preload 桥接或 invoke 调用
3. 打开 Electron DevTools（Ctrl+Shift+I），查看 Console 中的 `[CoverSelector] handleClickCover` 和 `[CoverSelector] handleUpload` 日志
4. 如果 CropModal 的 `visible` 为 `true` 但图片不显示，检查 `imageSrc` 的值（已加 console.log）

**已加的调试日志**（commit 中包含，确认后应清理）:
- `electron/ipc/file-dialog.ipc.ts`: handler 入口、dialog 结果、返回数据
- `src/pages/PublishPage.tsx`: onPickImage 调用和返回
- `src/components/publish/CoverSelector.tsx`: handleClickCover、handleUpload
- `src/components/publish/CropModal.tsx`: visible 和 imageSrc 值

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/pages/PublishPage.tsx` | 定义 `onPickImage` 和 `onCropConfirm` 回调 |
| `src/components/publish/CoverSelector.tsx` | 封面选择器，包含 CoverBox、handleUpload、handleCropConfirm |
| `src/components/publish/CropModal.tsx` | 裁剪弹窗，使用 react-easy-crop |
| `electron/ipc/file-dialog.ipc.ts` | FILE_SELECT_IMAGE handler，读取文件返回 data URL |
| `src/hooks/usePublishFlow.ts` | publish() 发布流程，含封面转文件路径逻辑 |
| `electron/services/platform-adapters/douyin/DouyinAdapter.ts` | submitContent() 中新增封面上传 |
| `electron/services/platform-adapters/xiaohongshu/XhsAdapter.ts` | submitContent() 中新增封面上传 |
| `src/constants/ipc-channels.ts` | IPC 通道常量（含新增的 FILE_DATA_URL_TO_TEMP） |

## 数据流

```
用户点击 CoverBox "点击上传"
  → handleClickCover('horizontal', null, null)  // 两个 src 都是 null
  → handleUpload('horizontal')
  → onPickImage()
  → window.electron.ipcRenderer.invoke('file:select-image')
  → 主进程 FILE_SELECT_IMAGE handler
  → dialog.showOpenDialog() → 用户选图
  → readFileSync → 转 base64 data URL
  → 返回 { success: true, data: { dataUrl, filePath } }
  → onPickImage 返回 dataUrl
  → openCrop('horizontal', dataUrl)  // 设置 cropTarget + cropImageSrc
  → CropModal visible=true, imageSrc=dataUrl
  → Cropper 组件显示图片
  → 用户裁剪确认 → handleCropConfirm
  → flow.updateForm({ horizontalCover: croppedDataUrl })
  → CoverBox 显示封面
```

## 相关 commit

- `55c9912` — Fix: 封面模块修复 — 发布时封面丢失 + 裁剪组件CSS缺失
- `b846838` — Phase 4: 平台适配器扩展 + 封面模块重构
- `a90c8c0` — Phase 3: 内容发布核心功能实现
