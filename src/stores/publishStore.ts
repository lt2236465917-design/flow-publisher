import { create } from 'zustand'
import type { VideoMetadata, VideoFrame } from '@/types/video.types'
import type { PublishFormData, PublishTask, PublishState } from '@/types/publish.types'
import type { PlatformId } from '@/constants/platforms'
import { IPC_CHANNELS } from '@/constants/ipc-channels'

const DEFAULT_FORM: PublishFormData = {
  title: '',
  description: '',
  hashtags: [],
  coverPath: null,
  coverFrameIndex: null,
  declarations: [],
  platforms: []
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
    const res = await window.electron.ipcRenderer.invoke<VideoMetadata>(IPC_CHANNELS.PUBLISH_PROBE_VIDEO, filePath)
    if (res.success && res.data) {
      store.setVideo(res.data)
      return res.data
    }
    return null
  } finally {
    store.setLoading(false)
  }
}

export async function extractFramesAndUpdate(filePath: string): Promise<VideoFrame[]> {
  const store = usePublishStore.getState()
  store.setExtractingFrames(true)
  try {
    const res = await window.electron.ipcRenderer.invoke<VideoFrame[]>(IPC_CHANNELS.PUBLISH_EXTRACT_FRAMES, filePath)
    if (res.success && res.data) {
      store.setFrames(res.data)
      return res.data
    }
    return []
  } finally {
    store.setExtractingFrames(false)
  }
}

export async function validateForPlatform(filePath: string, platformId: PlatformId): Promise<{ valid: boolean; errors: string[] }> {
  const res = await window.electron.ipcRenderer.invoke<{ valid: boolean; errors: string[] }>(
    IPC_CHANNELS.PUBLISH_VALIDATE_VIDEO, filePath, platformId
  )
  if (res.success && res.data) return res.data
  return { valid: false, errors: [res.error || '验证失败'] }
}
