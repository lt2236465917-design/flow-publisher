import { useCallback, useEffect } from 'react'
import { message, Modal } from 'antd'
import { usePublishStore, probeAndUpdate, extractFramesAndUpdate, validateForPlatform } from '@/stores/publishStore'
import { useUIStore } from '@/stores/uiStore'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { ipcInvoke } from '@/utils/ipc'
import { toChineseMessage } from '@/utils/errorMessages'
import type { PlatformId } from '@/constants/platforms'
import type { PublishFormData } from '@/types/publish.types'

interface PublishProgressData {
  recordId: string
  percent: number
  stage: string
}

interface AccountInfo {
  id: string
  platform: string
  displayName: string
  sessionStatus: string
}

/**
 * Merge shared form fields with platform-specific overrides.
 * Per 方案C: shared fields are the base, platform overrides take precedence.
 * Only fields explicitly set in overrides are replaced; others inherit from shared.
 */
function mergeSharedWithOverrides(
  form: PublishFormData,
  platformId: PlatformId
): Record<string, unknown> {
  const shared: Record<string, unknown> = {
    title: form.title,
    description: form.description,
    hashtags: form.hashtags,
    mentions: form.mentions,
    location: form.location,
    collection: form.collection,
    visibility: form.visibility,
    publishTime: form.publishTime,
    originalDeclaration: form.originalDeclaration,
    cover: form.cover,
    declarations: form.declarations
  }

  const overrides = form.platformOverrides[platformId] || {}
  return { ...shared, ...overrides }
}

export function usePublishFlow() {
  const store = usePublishStore()
  const { confirm } = useUIStore()

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(IPC_CHANNELS.PUBLISH_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as PublishProgressData
      const { recordId, percent } = data
      const tasks = usePublishStore.getState().tasks
      const task = tasks.find((t) => t.id === recordId)
      if (task) {
        usePublishStore.getState().updateTask(recordId, {
          progress: percent,
          status: percent >= 100 ? 'done' : 'uploading'
        })
      }
    })
    return () => { unsubscribe() }
  }, [])

  const selectVideo = useCallback(async () => {
    const res = await ipcInvoke<{ filePath: string }>(IPC_CHANNELS.FILE_SELECT_VIDEO)
    if (!res.success || !res.data?.filePath) return null

    const filePath = res.data.filePath
    const meta = await probeAndUpdate(filePath)
    if (!meta) {
      message.error('无法解析视频文件，请检查文件格式')
      return null
    }
    extractFramesAndUpdate(filePath)
    return meta
  }, [])

  const handleDropFile = useCallback(async (filePath: string) => {
    const meta = await probeAndUpdate(filePath)
    if (!meta) {
      message.error('无法解析视频文件，请检查文件格式')
      return
    }
    extractFramesAndUpdate(filePath)
  }, [])

  const selectCover = useCallback(async () => {
    const res = await ipcInvoke<{ filePath: string }>(IPC_CHANNELS.FILE_SELECT_IMAGE)
    if (!res.success || !res.data?.filePath) return null
    return res.data.filePath
  }, [])

  const selectFrameAsCover = useCallback((index: number | null) => {
    if (index === null) {
      store.updateForm({
        coverFrameIndex: null,
        horizontalCover: null,
        verticalCover: null,
        cover: { horizontal_4_3: null, vertical_3_4: null, recommended: [] }
      })
      return
    }
    const frames = usePublishStore.getState().frames
    if (index >= 0 && index < frames.length) {
      store.updateForm({
        coverFrameIndex: index,
        coverPath: null,
        horizontalCover: null,
        verticalCover: null,
        cover: { horizontal_4_3: null, vertical_3_4: null, recommended: [] }
      })
    }
  }, [store])

  const publish = useCallback(async () => {
    const { video, form } = usePublishStore.getState()
    if (!video) {
      message.error('请先选择视频')
      return
    }
    if (form.platforms.length === 0) {
      message.error('请至少选择一个发布平台')
      return
    }
    if (!form.title.trim()) {
      message.error('请输入标题')
      return
    }

    // 视频号标题至少6个字
    if (form.platforms.includes('wechat-channels') && form.title.trim().length < 6) {
      message.error('视频号标题至少需要6个字')
      return
    }

    for (const platformId of form.platforms) {
      const validation = await validateForPlatform(video.filePath, platformId)
      if (!validation.valid) {
        message.error(`[${platformId}] ${validation.errors[0]}`)
        return
      }
    }

    // Confirmation dialog
    const confirmed = await confirm({
      title: '确认发布',
      content: `即将发布到 ${form.platforms.length} 个平台，标题：「${form.title}」`,
      okText: '确认发布'
    })
    if (!confirmed) return

    // Convert cover data URL to temp file (new cover format + legacy fallback)
    const coverSource = form.cover.horizontal_4_3 || form.horizontalCover
    let coverFilePath: string | undefined
    if (coverSource) {
      const coverRes = await ipcInvoke<{ filePath: string }>(
        IPC_CHANNELS.FILE_DATA_URL_TO_TEMP,
        coverSource
      )
      if (coverRes.success && coverRes.data?.filePath) {
        coverFilePath = coverRes.data.filePath
      }
    }

    const tasks = form.platforms.map((p) => ({
      id: `task-${p}-${Date.now()}`,
      platform: p as PlatformId,
      status: 'uploading' as const,
      progress: 0
    }))
    store.setTasks(tasks)

    for (let i = 0; i < form.platforms.length; i++) {
      const platformId = form.platforms[i]
      const task = tasks[i]

      try {
        const accountsRes = await ipcInvoke<AccountInfo[]>(IPC_CHANNELS.ACCOUNT_LIST)
        const account = (accountsRes.data || []).find(
          (a) => a.platform === platformId && a.sessionStatus === 'logged_in'
        )
        if (!account) {
          store.updateTask(task.id, { status: 'error', error: '该平台未登录' })
          continue
        }

        store.updateTask(task.id, { status: 'uploading', progress: 0 })
        const uploadRes = await ipcInvoke<{ recordId: string; videoId?: string }>(IPC_CHANNELS.PUBLISH_UPLOAD, {
          accountId: account.id,
          platformId,
          filePath: video.filePath
        })

        if (!uploadRes.success) {
          const errorMsg = toChineseMessage(uploadRes.error)
          store.updateTask(task.id, { status: 'error', error: errorMsg })
          continue
        }

        const recordId = uploadRes.data!.recordId
        const videoId = uploadRes.data!.videoId

        // Merge shared fields with platform overrides (方案A+方案C pattern)
        const mergedContent = mergeSharedWithOverrides(form, platformId)

        store.updateTask(task.id, { status: 'submitting', progress: 90 })
        const submitRes = await ipcInvoke<{ recordId: string }>(IPC_CHANNELS.PUBLISH_SUBMIT, {
          recordId,
          platformId,
          videoId,
          content: {
            ...mergedContent,
            coverPath: coverFilePath,
            platformFields: form.platformOverrides[platformId as PlatformId] || {}
          }
        })

        if (submitRes.success) {
          store.updateTask(task.id, { status: 'done', progress: 100 })
        } else {
          const errorMsg = toChineseMessage(submitRes.error)
          store.updateTask(task.id, { status: 'error', error: errorMsg })
        }
      } catch (e) {
        store.updateTask(task.id, { status: 'error', error: toChineseMessage(e) })
      }
    }

    const errorCount = tasks.filter((t) => {
      const current = usePublishStore.getState().tasks.find((ct) => ct.id === t.id)
      return current?.status === 'error'
    }).length

    if (errorCount === 0) {
      message.success('发布流程完成')
    } else {
      message.warning(`发布完成，${errorCount} 个平台失败`)
    }
  }, [store, confirm])

  return {
    ...store,
    selectVideo,
    handleDropFile,
    selectCover,
    selectFrameAsCover,
    publish
  }
}
