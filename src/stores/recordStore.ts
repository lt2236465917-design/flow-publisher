import { create } from 'zustand'
import type { PublishRecord } from '@/types/publish.types'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { ipcInvoke } from '@/utils/ipc'

export interface ScheduledTask {
  id: string
  platforms: string[]
  accountIds: Record<string, string>
  videoPath: string
  coverPath: string | null
  title: string
  description: string
  hashtags: string[]
  declarations: string[]
  platformOverrides: Record<string, Record<string, unknown>>
  scheduledAt: string
  status: string
  retryCount: number
  maxRetries: number
  error: string | null
  createdAt: string
  updatedAt: string
}

interface RecordState {
  records: PublishRecord[]
  scheduledTasks: ScheduledTask[]
  loading: boolean

  fetchRecords: () => Promise<void>
  fetchScheduledTasks: () => Promise<void>
  createScheduledTask: (params: Record<string, unknown>) => Promise<boolean>
  cancelScheduledTask: (taskId: string) => Promise<boolean>
  deleteScheduledTask: (taskId: string) => Promise<boolean>
}

function parseScheduledTask(raw: Record<string, unknown>): ScheduledTask {
  return {
    id: raw.id as string,
    platforms: JSON.parse((raw.platforms as string) || '[]'),
    accountIds: JSON.parse((raw.account_ids as string) || '{}'),
    videoPath: raw.video_path as string,
    coverPath: (raw.cover_path as string) || null,
    title: (raw.title as string) || '',
    description: (raw.description as string) || '',
    hashtags: JSON.parse((raw.hashtags as string) || '[]'),
    declarations: JSON.parse((raw.declarations as string) || '[]'),
    platformOverrides: JSON.parse((raw.platform_overrides as string) || '{}'),
    scheduledAt: raw.scheduled_at as string,
    status: raw.status as string,
    retryCount: raw.retry_count as number,
    maxRetries: raw.max_retries as number,
    error: (raw.error as string) || null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string
  }
}

function parsePublishRecord(raw: Record<string, unknown>): PublishRecord {
  return {
    id: raw.id as string,
    platform: raw.platform as string,
    title: (raw.title as string) || '',
    description: (raw.description as string) || '',
    videoPath: raw.video_path as string,
    coverPath: (raw.cover_path as string) || null,
    status: raw.status as string,
    publishUrl: (raw.publish_url as string) || null,
    error: (raw.error as string) || null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string
  }
}

export const useRecordStore = create<RecordState>((set) => ({
  records: [],
  scheduledTasks: [],
  loading: false,

  fetchRecords: async () => {
    set({ loading: true })
    try {
      const res = await ipcInvoke<Record<string, unknown>[]>(IPC_CHANNELS.PUBLISH_LIST_RECORDS)
      if (res.success && res.data) {
        set({ records: res.data.map(parsePublishRecord) })
      }
    } catch (err) {
      console.error('[recordStore] fetchRecords error:', err)
    } finally {
      set({ loading: false })
    }
  },

  fetchScheduledTasks: async () => {
    try {
      const res = await ipcInvoke<Record<string, unknown>[]>(IPC_CHANNELS.SCHEDULE_LIST)
      if (res.success && res.data) {
        set({ scheduledTasks: res.data.map(parseScheduledTask) })
      }
    } catch (err) {
      console.error('[recordStore] fetchScheduledTasks error:', err)
    }
  },

  createScheduledTask: async (params) => {
    const res = await ipcInvoke(IPC_CHANNELS.SCHEDULE_CREATE, params)
    if (res.success) {
      const store = useRecordStore.getState()
      await store.fetchScheduledTasks()
      return true
    }
    return false
  },

  cancelScheduledTask: async (taskId) => {
    const res = await ipcInvoke(IPC_CHANNELS.SCHEDULE_CANCEL, taskId)
    if (res.success) {
      const store = useRecordStore.getState()
      await store.fetchScheduledTasks()
      return true
    }
    return false
  },

  deleteScheduledTask: async (taskId) => {
    const res = await ipcInvoke(IPC_CHANNELS.SCHEDULE_DELETE, taskId)
    if (res.success) {
      const store = useRecordStore.getState()
      await store.fetchScheduledTasks()
      return true
    }
    return false
  }
}))
