import { app, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { realpathSync, existsSync } from 'fs'
import { initDatabase, closeDatabase, backupDatabase } from './services/database'
import { registerAccountIpcHandlers } from './ipc/account.ipc'
import { registerPublishIpcHandlers } from './ipc/publish.ipc'
import { registerFileDialogIpcHandlers } from './ipc/file-dialog.ipc'
import { registerSchedulerIpcHandlers } from './ipc/scheduler.ipc'
import { registerAnalyticsIpcHandlers } from './ipc/analytics.ipc'
import { getScheduledTaskRepository } from './services/database'
import { TaskQueue } from './services/scheduler/TaskQueue'
import { PublishScheduler } from './services/scheduler/PublishScheduler'
import { getSignService } from './services/sign/SignService'
import { logger } from './utils/logger'

const isDev = !app.isPackaged
let scheduler: PublishScheduler | null = null

// Register custom protocol for serving local files (avoids CSP/same-origin issues)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, stream: true, supportFetchAPI: true } }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Flow',
    backgroundColor: '#1d1d1f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Global error handlers for main process
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason)
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.flow.publisher')

  // Handle local-file:// protocol to serve local files
  // Security: only allow paths within the app's userData directory or temp directory.
  // Uses realpathSync to resolve symlinks/junction points before whitelist comparison,
  // and appends path separator to prevent prefix-confusion bypasses.
  const allowedRoots = [
    resolve(app.getPath('userData')),
    resolve(app.getPath('temp'))
  ]
  protocol.handle('local-file', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname)
      // On Windows, pathname starts with /C:/..., remove leading /
      const normalizedPath = process.platform === 'win32' && filePath.startsWith('/') ? filePath.slice(1) : filePath
      const resolvedPath = resolve(normalizedPath)

      // If file exists, resolve symlinks/junction points for security validation
      const canonicalPath = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath

      // Validate path is within allowed directories — append sep to prevent prefix confusion
      const isAllowed = allowedRoots.some(root => (canonicalPath + sep).startsWith(root + sep))
      if (!isAllowed) {
        logger.warn(`[local-file] Blocked access to path outside allowed directories: ${canonicalPath}`)
        return new Response('Forbidden', { status: 403 })
      }

      const fileUrl = pathToFileURL(canonicalPath).toString()
      return net.fetch(fileUrl)
    } catch (err) {
      // URIError (malformed %-encoding), TypeError, or net.fetch error
      logger.warn(`[local-file] Request error:`, err)
      return new Response('Bad Request', { status: 400 })
    }
  })

  await initDatabase()

  // Backup database on startup (non-blocking)
  backupDatabase()

  registerAccountIpcHandlers()
  registerPublishIpcHandlers()
  registerFileDialogIpcHandlers()
  registerSchedulerIpcHandlers()
  registerAnalyticsIpcHandlers()

  // App-level IPC handlers
  ipcMain.handle('app:get-version', () => {
    return { success: true, data: { version: app.getVersion() } }
  })

  // Start scheduled publishing
  const scheduledTaskRepo = getScheduledTaskRepository()
  const taskQueue = new TaskQueue(scheduledTaskRepo)
  scheduler = new PublishScheduler(scheduledTaskRepo, taskQueue)
  scheduler.start()
  scheduler.runMissedTasks().catch((err) => logger.error('runMissedTasks error:', err))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      // Safety: restart scheduler if it was stopped (shouldn't happen on macOS after the fix above)
      if (scheduler && !scheduler.isRunning) {
        scheduler.start()
      }
    }
  })
})

// Ensure cleanup on actual app quit (all platforms)
app.on('before-quit', () => {
  scheduler?.stop()
  getSignService().dispose().catch((err) => logger.error('SignService dispose error:', err))
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Windows & Linux: clean shutdown — stop scheduler, dispose services, close DB, quit
    scheduler?.stop()
    getSignService().dispose().catch((err) => logger.error('SignService dispose error:', err))
    closeDatabase()
    app.quit()
  }
  // macOS: keep services alive — app stays running, activate event will reopen window
})
