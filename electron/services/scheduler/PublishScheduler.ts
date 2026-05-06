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

  async checkDueTasks(): Promise<void> {
    if (this.taskQueue.isRunning) return

    const dueTasks = this.scheduledTaskRepo.getDueTasks()
    if (dueTasks.length === 0) return

    // Execute the first due task (ordered by scheduled_at ASC)
    const task = dueTasks[0]
    logger.info('Dispatching scheduled task:', task.id, 'scheduled for', task.scheduled_at)
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
