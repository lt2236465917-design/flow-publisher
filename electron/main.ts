import { app, BrowserWindow, protocol, net, nativeImage, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { initDatabase, closeDatabase, backupDatabase } from './services/database'
import { registerAccountIpcHandlers } from './ipc/account.ipc'
import { registerPublishIpcHandlers } from './ipc/publish.ipc'
import { registerFileDialogIpcHandlers } from './ipc/file-dialog.ipc'
import { registerSchedulerIpcHandlers } from './ipc/scheduler.ipc'
import { registerAnalyticsIpcHandlers } from './ipc/analytics.ipc'
import {
  getPublishRecordRepository,
  getScheduledTaskRepository
} from './services/database'
import { TaskQueue } from './services/scheduler/TaskQueue'
import { PublishScheduler } from './services/scheduler/PublishScheduler'
import { getSignService } from './services/sign/SignService'
import { getManagedSelfHostedSignerServer } from './services/sign/ManagedSelfHostedSignerServer'
import { logger } from './utils/logger'
import {
  registerTrustedIpcHandler,
  setMainRendererSecurityContext
} from './security/trusted-ipc'
import {
  isSecureRemoteUrl,
  isTrustedMainRendererUrl
} from './security/navigation-policy'
import {
  configureFileAccessPolicy,
  requireAllowedFile
} from './security/file-access-policy'

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
  const devRendererUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const rendererRoot = join(__dirname, '../renderer')
  setMainRendererSecurityContext(mainWindow, devRendererUrl)

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedMainRendererUrl(url, devRendererUrl, rendererRoot)) {
      event.preventDefault()
      logger.warn(`[security] Blocked main-window navigation to ${url}`)
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSecureRemoteUrl(url)) {
      void shell.openExternal(url)
    } else {
      logger.warn(`[security] Blocked main-window open request to ${url}`)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const source = sourceId ? `${sourceId}:${line}` : `line ${line}`
      const prefix = `[renderer:${level}] ${source}`
      if (level === 3) {
        logger.error(prefix, message)
      } else if (level === 2) {
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

  const fileAccessPolicy = configureFileAccessPolicy(
    [app.getPath('userData')],
    [join(app.getPath('temp'), 'videosync-frames')]
  )

  // Handle local-file:// protocol to serve local files
  protocol.handle('local-file', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.host ? `/${url.host}${url.pathname}` : url.pathname)
      // On Windows, pathname starts with /C:/..., remove leading /
      const normalizedPath = process.platform === 'win32' && filePath.startsWith('/') ? filePath.slice(1) : filePath
      const canonicalPath = requireAllowedFile(normalizedPath)
      const fileUrl = pathToFileURL(canonicalPath).toString()
      return net.fetch(fileUrl)
    } catch (err) {
      logger.warn('[local-file] Blocked or invalid request:', err)
      return new Response('Forbidden', { status: 403 })
    }
  })

  await initDatabase()
  for (const record of getPublishRecordRepository().getAll()) {
    fileAccessPolicy.authorize(record.video_path)
    if (record.cover_path) fileAccessPolicy.authorize(record.cover_path)
  }
  for (const task of getScheduledTaskRepository().getAll()) {
    fileAccessPolicy.authorize(task.video_path)
    if (task.cover_path) fileAccessPolicy.authorize(task.cover_path)
  }

  // Backup database on startup (non-blocking)
  backupDatabase()

  registerAccountIpcHandlers()
  registerPublishIpcHandlers()
  registerFileDialogIpcHandlers()
  registerSchedulerIpcHandlers()
  registerAnalyticsIpcHandlers()

  await getManagedSelfHostedSignerServer().start()

  // App-level IPC handlers
  registerTrustedIpcHandler('app:get-version', () => {
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
