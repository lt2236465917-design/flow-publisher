import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
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

  // Select image file and return as data URL (for cover)
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

      const filePath = result.filePaths[0]
      if (!existsSync(filePath)) return { success: false, error: '文件不存在' }

      const ext = extname(filePath).replace('.', '').toLowerCase()
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif'
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const buf = readFileSync(filePath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`

      return { success: true, data: { dataUrl, filePath } }
    } catch (err) {
      logger.error('FILE_SELECT_IMAGE error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Read file as data URL (for image preview/crop)
  ipcMain.handle(IPC_CHANNELS.FILE_READ_DATA_URL, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      if (!existsSync(filePath)) return { success: false, error: '文件不存在' }
      const ext = extname(filePath).replace('.', '').toLowerCase()
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif'
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const buf = readFileSync(filePath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { success: true, data: { dataUrl } }
    } catch (err) {
      logger.error('FILE_READ_DATA_URL error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('File dialog IPC handlers registered')
}
