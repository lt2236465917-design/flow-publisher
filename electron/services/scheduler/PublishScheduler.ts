import cron from 'node-cron'
import { TaskQueue } from './TaskQueue'
import { logger } from '../../utils/logger'
import type { ScheduledTaskRepository } from '../database/repositories/scheduled-task.repo'

export class PublishScheduler {
  private cronTask: cron.ScheduledTask | null = null
  private taskQueue: TaskQueue
  private scheduledTaskRepo: ScheduledTaskRepository

  constructor(scheduledTaskRepo: ScheduledTaskRepository, taskQueue: TaskQueue) {
    this.scheduledTaskRepo = scheduledTaskRepo
    this.taskQueue = taskQueue
  }

  start(): void {
    if (this.cronTask) return

    // Check every 30 seconds for due tasks
    this.cronTask = cron.schedule('*/30 * * * * *', () => {
      this.checkDueTasks().catch((err) => {
        logger.error('PublishScheduler checkDueTasks error:', err)
      })
    })

    logger.info('PublishScheduler started (polling every 30s)')
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop()
      this.cronTask = null
      logger.info('PublishScheduler stopped')
    }
  }

  get isRunning(): boolean {
    return this.cronTask !== null
  }

  async checkDueTasks(): Promise<void> {
    if (this.taskQueue.isRunning) {
      logger.debug('[PublishScheduler] Task queue is running, skipping check')
      return
    }

    const pendingTasks = this.scheduledTaskRepo.getPendingTasks()
    logger.debug(`[PublishScheduler] Total pending tasks: ${pendingTasks.length}`)

    if (pendingTasks.length > 0) {
      const now = new Date()
      logger.debug(`[PublishScheduler] Current time (UTC): ${now.toISOString()}`)
      for (const task of pendingTasks) {
        logger.debug(`[PublishScheduler] Pending task ${task.id}: scheduled_at=${task.scheduled_at}, status=${task.status}`)
      }
    }

    const dueTasks = this.scheduledTaskRepo.getDueTasks()
    if (dueTasks.length === 0) {
      logger.debug('[PublishScheduler] No due tasks found')
      return
    }

    // Execute the first due task (ordered by scheduled_at ASC)
    const task = dueTasks[0]
    logger.info('[PublishScheduler] Dispatching scheduled task:', task.id, 'scheduled for', task.scheduled_at, 'current status:', task.status)
    await this.taskQueue.execute(task)
  }

  async runMissedTasks(): Promise<void> {
    const dueTasks = this.scheduledTaskRepo.getDueTasks()
    if (dueTasks.length === 0) return

    logger.info(`Found ${dueTasks.length} missed scheduled task(s), executing...`)
    for (const task of dueTasks) {
      if (this.taskQueue.isRunning) break
      logger.info('Executing missed task:', task.id, 'scheduled for', task.scheduled_at)
      await this.taskQueue.execute(task)
    }
  }
}
