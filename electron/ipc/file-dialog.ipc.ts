import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import { logger } from '../utils/logger'

export function registerFileDialogIpcHandlers(): void {
  // Select video file
  ipcMain.handle(IPC_CHANNELS.FILE_SELECT_VIDEO, async (): Promise<IpcResponse> => {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (!mainWindow) return { success: false, error: '窗口未就绪' }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择视频文件',
        filters: [
          { name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'flv', 'mkv', 'wmv', 'webm'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消选择' }
      }

      return { success: true, data: { filePath: result.filePaths[0] } }
    } catch (err) {
      logger.error('FILE_SELECT_VIDEO error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Select image file (for cover)
  ipcMain.handle(IPC_CHANNELS.FILE_SELECT_IMAGE, async (): Promise<IpcResponse> => {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (!mainWindow) return { success: false, error: '窗口未就绪' }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择封面图片',
        filters: [
          { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消选择' }
      }

      return { success: true, data: { filePath: result.filePaths[0] } }
    } catch (err) {
      logger.error('FILE_SELECT_IMAGE error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('File dialog IPC handlers registered')
}
