import { app, BrowserWindow, ipcMain, protocol, net, nativeImage } from 'electron'
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
import { getManagedSelfHostedSignerServer } from './services/sign/ManagedSelfHostedSignerServer'
import { logger } from './utils/logger'

const isDev = !app.isPackaged
const APP_NAME = 'Flow'
let scheduler: PublishScheduler | null = null

// In development macOS launches Electron.app, whose bundle name is "Electron".
// Set both Electron's internal name and the process title before app readiness
// so the Dock and app switcher identify the running project as Flow.
app.setName(APP_NAME)
process.title = APP_NAME

// Register custom protocol for serving local files (avoids CSP/same-origin issues)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, stream: true, supportFetchAPI: true } }
])

function getAppIconPath(): string | undefined {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')

  return existsSync(iconPath) ? iconPath : undefined
}

function applyAppBranding(): string | undefined {
  const appIconPath = getAppIconPath()

  if (process.platform === 'darwin' && app.dock && appIconPath) {
    const appIcon = nativeImage.createFromPath(appIconPath)
    if (appIcon.isEmpty()) {
      logger.warn(`[branding] Failed to load app icon: ${appIconPath}`)
    } else {
      app.dock.setIcon(appIcon)
      logger.info(
        `[branding] Applied ${APP_NAME} Dock icon: ` +
        `${appIcon.getSize().width}x${appIcon.getSize().height}`
      )
    }
  }

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    iconPath: appIconPath
  })

  return appIconPath
}

function createWindow(): void {
  const appIconPath = getAppIconPath()

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Flow',
    icon: appIconPath,
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

  if (isDev) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const source = sourceId ? `${sourceId}:${line}` : `line ${line}`
      const prefix = `[renderer:${level}] ${source}`
      if (level === 'error') {
        logger.error(prefix, message)
      } else if (level === 'warning') {
        logger.warn(prefix, message)
      } else {
        logger.info(prefix, message)
      }
    })

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      logger.error('[renderer] render process gone:', details)
    })
  }

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
  applyAppBranding()

  // Handle local-file:// protocol to serve local files
  // Security: only allow paths within app-owned directories or the current user's home.
  // Uses realpathSync to resolve symlinks/junction points before whitelist comparison,
  // and appends path separator to prevent prefix-confusion bypasses.
  const allowedRoots = [
    app.getPath('userData'),
    app.getPath('temp'),
    app.getPath('home')
  ].map(root => {
    const resolvedRoot = resolve(root)
    return existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot
  })
  protocol.handle('local-file', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.host ? `/${url.host}${url.pathname}` : url.pathname)
      // On Windows, pathname starts with /C:/..., remove leading /
      const normalizedPath = process.platform === 'win32' && filePath.startsWith('/') ? filePath.slice(1) : filePath
      let resolvedPath = resolve(normalizedPath)
      if (!existsSync(resolvedPath)) {
        const homeRoot = resolve(app.getPath('home'))
        const homeParts = homeRoot.split(sep).filter(Boolean)
        const pathParts = resolvedPath.split(sep).filter(Boolean)
        const matchesHome = homeParts.every((part, index) =>
          pathParts[index]?.toLowerCase() === part.toLowerCase()
        )
        if (matchesHome) {
          resolvedPath = sep + [...homeParts, ...pathParts.slice(homeParts.length)].join(sep)
        }
      }

      // If file exists, resolve symlinks/junction points for security validation
      const canonicalPath = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath

      // Validate path is within allowed directories — append sep to prevent prefix confusion
      const canonicalPathWithSep = canonicalPath + sep
      const isAllowed = allowedRoots.some(root => {
        const rootWithSep = root.endsWith(sep) ? root : root + sep
        if (process.platform === 'darwin') {
          return canonicalPathWithSep.toLowerCase().startsWith(rootWithSep.toLowerCase())
        }
        return canonicalPathWithSep.startsWith(rootWithSep)
      })
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

  await getManagedSelfHostedSignerServer().start()

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
  getManagedSelfHostedSignerServer().stop().catch((err) => logger.error('Managed signer stop error:', err))
  getSignService().dispose().catch((err) => logger.error('SignService dispose error:', err))
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Windows & Linux: clean shutdown — stop scheduler, dispose services, close DB, quit
    scheduler?.stop()
    getManagedSelfHostedSignerServer().stop().catch((err) => logger.error('Managed signer stop error:', err))
    getSignService().dispose().catch((err) => logger.error('SignService dispose error:', err))
    closeDatabase()
    app.quit()
  }
  // macOS: keep services alive — app stays running, activate event will reopen window
})
