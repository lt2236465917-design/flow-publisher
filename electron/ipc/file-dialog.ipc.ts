import { dialog, app } from 'electron'
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { extname, join, resolve, sep } from 'path'
import { randomBytes } from 'crypto'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import { logger } from '../utils/logger'
import {
  getMainWindow,
  registerTrustedIpcHandler
} from '../security/trusted-ipc'

export function registerFileDialogIpcHandlers(): void {
  // Select video file
  registerTrustedIpcHandler(IPC_CHANNELS.FILE_SELECT_VIDEO, async (): Promise<IpcResponse> => {
    try {
      const mainWindow = getMainWindow() || undefined
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
  registerTrustedIpcHandler(IPC_CHANNELS.FILE_SELECT_IMAGE, async (): Promise<IpcResponse> => {
    try {
      logger.info('[FILE_SELECT_IMAGE] >>> handler invoked')
      const mainWindow = getMainWindow() || undefined
      if (!mainWindow) {
        logger.warn('[FILE_SELECT_IMAGE] no main window')
        return { success: false, error: '窗口未就绪' }
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择封面图片',
        filters: [
          { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      logger.info(`[FILE_SELECT_IMAGE] dialog result: canceled=${result.canceled}, files=${result.filePaths.length}`)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消选择' }
      }

      const filePath = result.filePaths[0]
      logger.info(`[FILE_SELECT_IMAGE] selected file: ${filePath}`)
      if (!existsSync(filePath)) {
        logger.warn(`[FILE_SELECT_IMAGE] file not found: ${filePath}`)
        return { success: false, error: '文件不存在' }
      }

      // Guard against accidentally loading huge files (e.g. video mislabeled as .jpg)
      const MAX_IMAGE_SIZE = 50 * 1024 * 1024 // 50 MB
      const fileSize = statSync(filePath).size
      if (fileSize > MAX_IMAGE_SIZE) {
        logger.warn(`[FILE_SELECT_IMAGE] file too large: ${fileSize} bytes`)
        return { success: false, error: '图片文件过大（最大50MB）' }
      }

      const ext = extname(filePath).replace('.', '').toLowerCase()
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif'
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const buf = readFileSync(filePath)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      logger.info(`[FILE_SELECT_IMAGE] returning dataUrl, length=${dataUrl.length}, mime=${mime}`)

      return { success: true, data: { dataUrl, filePath } }
    } catch (err) {
      logger.error('[FILE_SELECT_IMAGE] error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Read file as data URL (for image preview/crop)
  registerTrustedIpcHandler(IPC_CHANNELS.FILE_READ_DATA_URL, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      if (!filePath || typeof filePath !== 'string') return { success: false, error: '无效的文件路径' }
      if (!existsSync(filePath)) return { success: false, error: '文件不存在' }

      // Validate path is within allowed directories (same as local-file protocol)
      const allowedRoots = [app.getPath('userData'), app.getPath('temp'), app.getPath('home')]
      const resolvedPath = resolve(filePath)
      const isAllowed = allowedRoots.some(root => {
        const normalizedPath = resolvedPath.endsWith(sep) ? resolvedPath : resolvedPath + sep
        return normalizedPath.startsWith(resolve(root) + sep)
      })
      if (!isAllowed) {
        logger.warn(`[FILE_READ_DATA_URL] Blocked access to path outside allowed directories: ${resolvedPath}`)
        return { success: false, error: '禁止访问的文件路径' }
      }

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

  // Convert data URL to a persistent app-owned file for API/HTTP cover upload
  // and later display in the analytics list.
  registerTrustedIpcHandler(IPC_CHANNELS.FILE_DATA_URL_TO_TEMP, async (_event, dataUrl: string): Promise<IpcResponse> => {
    try {
      logger.info(`[FILE_DATA_URL_TO_TEMP] called, dataUrl length: ${dataUrl?.length}, starts with: ${dataUrl?.substring(0, 50)}`)
      const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!match) {
        logger.warn(`[FILE_DATA_URL_TO_TEMP] Invalid data URL format, first 100 chars: ${dataUrl?.substring(0, 100)}`)
        return { success: false, error: '无效的 data URL 格式' }
      }

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      const buf = Buffer.from(match[2], 'base64')
      const fileName = `cover-${randomBytes(8).toString('hex')}.${ext}`
      const coversDir = join(app.getPath('userData'), 'covers')
      if (!existsSync(coversDir)) mkdirSync(coversDir, { recursive: true })
      const filePath = join(coversDir, fileName)
      writeFileSync(filePath, buf)
      logger.info(`[FILE_DATA_URL_TO_TEMP] Saved persistent cover to: ${filePath}, size: ${buf.length} bytes`)

      return { success: true, data: { filePath } }
    } catch (err) {
      logger.error('FILE_DATA_URL_TO_TEMP error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('File dialog IPC handlers registered')
}
