import { create } from 'zustand'
import type { VideoMetadata, VideoFrame } from '@/types/video.types'
import type { PublishFormData, PublishTask, PublishState } from '@/types/publish.types'
import type { PlatformId } from '@/constants/platforms'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { ipcInvoke } from '@/utils/ipc'

const DEFAULT_FORM: PublishFormData = {
  // Shared fields (方案A 通用区)
  title: '',
  description: '',
  hashtags: [],
  mentions: [],
  location: null,
  collection: null,
  visibility: 'public',
  publishTime: { mode: 'now', scheduled_at: null },
  originalDeclaration: false,
  cover: {
    horizontal_4_3: null,
    vertical_3_4: null,
    recommended: []
  },
  declarations: [],
  // Platform selection
  platforms: [],
  platformOverrides: {} as Record<PlatformId, Record<string, unknown>>,
  // Legacy fields (UI compatibility)
  coverPath: null,
  coverFrameIndex: null,
  coverRatio: '4:3',
  horizontalCover: null,
  verticalCover: null
}

export const usePublishStore = create<PublishState>((set) => ({
  video: null,
  frames: [],
  form: { ...DEFAULT_FORM },
  tasks: [],
  loading: false,
  extractingFrames: false,

  setVideo: (video) => set({ video }),
  setFrames: (frames) => set({ frames }),
  updateForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
  resetForm: () => set({ video: null, frames: [], form: { ...DEFAULT_FORM }, tasks: [] }),
  setTasks: (tasks) => set({ tasks }),
  updateTask: (taskId, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
    })),
  setLoading: (loading) => set({ loading }),
  setExtractingFrames: (extractingFrames) => set({ extractingFrames })
}))

export async function probeAndUpdate(filePath: string): Promise<VideoMetadata | null> {
  const store = usePublishStore.getState()
  store.setLoading(true)
  try {
    const res = await ipcInvoke<VideoMetadata>(IPC_CHANNELS.PUBLISH_PROBE_VIDEO, filePath)
    if (res.success && res.data) {
      store.setVideo(res.data)
      return res.data
    }
    return null
  } catch (err) {
    console.error('[publishStore] probeAndUpdate error:', err)
    return null
  } finally {
    store.setLoading(false)
  }
}

export async function extractFramesAndUpdate(filePath: string): Promise<VideoFrame[]> {
  const store = usePublishStore.getState()
  store.setExtractingFrames(true)
  try {
    const res = await ipcInvoke<VideoFrame[]>(IPC_CHANNELS.PUBLISH_EXTRACT_FRAMES, filePath, 3)
    if (res.success && res.data) {
      store.setFrames(res.data)
      return res.data
    }
    return []
  } catch (err) {
    console.error('[publishStore] extractFramesAndUpdate error:', err)
    return []
  } finally {
    store.setExtractingFrames(false)
  }
}

export async function validateForPlatform(filePath: string, platformId: PlatformId): Promise<{ valid: boolean; errors: string[] }> {
  const res = await ipcInvoke<{ valid: boolean; errors: string[] }>(
    IPC_CHANNELS.PUBLISH_VALIDATE_VIDEO, filePath, platformId
  )
  if (res.success && res.data) return res.data
  return { valid: false, errors: [res.error || '验证失败'] }
}
