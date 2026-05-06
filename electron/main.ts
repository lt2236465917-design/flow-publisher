import { app, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { initDatabase, closeDatabase } from './services/database'
import { registerAccountIpcHandlers } from './ipc/account.ipc'
import { registerPublishIpcHandlers } from './ipc/publish.ipc'
import { registerFileDialogIpcHandlers } from './ipc/file-dialog.ipc'
import { registerSchedulerIpcHandlers } from './ipc/scheduler.ipc'
import { getScheduledTaskRepository } from './services/database'
import { TaskQueue } from './services/scheduler/TaskQueue'
import { PublishScheduler } from './services/scheduler/PublishScheduler'
import { logger } from './utils/logger'

const isDev = !app.isPackaged
let scheduler: PublishScheduler | null = null

// Register custom protocol for serving local files (avoids CSP/same-origin issues)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, stream: true, supportFetchAPI: true } }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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

app.whenReady().then(async () => {
  app.setAppUserModelId('com.videosync.publisher')

  // Handle local-file:// protocol to serve local files
  protocol.handle('local-file', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    // On Windows, pathname starts with /C:/..., remove leading /
    const normalizedPath = process.platform === 'win32' && filePath.startsWith('/') ? filePath.slice(1) : filePath
    const fileUrl = pathToFileURL(normalizedPath).toString()
    return net.fetch(fileUrl)
  })

  await initDatabase()
  registerAccountIpcHandlers()
  registerPublishIpcHandlers()
  registerFileDialogIpcHandlers()
  registerSchedulerIpcHandlers()

  // Start scheduled publishing
  const scheduledTaskRepo = getScheduledTaskRepository()
  const taskQueue = new TaskQueue(scheduledTaskRepo)
  scheduler = new PublishScheduler(scheduledTaskRepo, taskQueue)
  scheduler.start()
  scheduler.runMissedTasks().catch((err) => logger.error('runMissedTasks error:', err))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  scheduler?.stop()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
