import { useCallback, useEffect, useRef } from 'react'
import { message, Modal } from 'antd'
import { usePublishStore, probeAndUpdate, extractFramesAndUpdate, validateForPlatform } from '@/stores/publishStore'
import { useUIStore } from '@/stores/uiStore'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { PLATFORMS } from '@/constants/platforms'
import { ipcInvoke } from '@/utils/ipc'
import { toChineseMessage } from '@/utils/errorMessages'
import {
  validateTitle,
  validateDescription,
  validateHashtags,
} from '@/constants/platform-limits'
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
  const publishingRef = useRef(false)

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
    return () => { if (typeof unsubscribe === 'function') unsubscribe() }
  }, [])

  // Listen for sign fallback warning from main process.
  // When external signing service is unavailable and the main process is about to
  // fall back to local Playwright-based signing, it sends this event. The user must
  // explicitly confirm before local signing is used.
  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(
      IPC_CHANNELS.PUBLISH_SIGN_FALLBACK_WARNING,
      (...args: unknown[]) => {
        const { platform } = args[0] as { platform: string }
        const platformName = PLATFORMS[platform as PlatformId]?.displayName || platform

        Modal.confirm({
          title: '⚠️ 签名服务降级警告',
          icon: null,
          content: `外部签名服务当前不可用。即将使用本地浏览器生成${platformName}的签名参数。\n\n此操作可能被平台检测为非正常行为，存在账号被限制发布功能的风险。\n\n是否继续？`,
          okText: '继续发布（有风险）',
          cancelText: '取消发布',
          okButtonProps: { danger: true },
          onOk: () => {
            window.electron.ipcRenderer.invoke(
              IPC_CHANNELS.PUBLISH_CONFIRM_SIGN_FALLBACK,
              true
            )
          },
          onCancel: () => {
            window.electron.ipcRenderer.invoke(
              IPC_CHANNELS.PUBLISH_CONFIRM_SIGN_FALLBACK,
              false
            )
          }
        })
      }
    )
    return () => { if (typeof unsubscribe === 'function') unsubscribe() }
  }, [])

  const currentFilePathRef = useRef<string | null>(null)

  const selectVideo = useCallback(async () => {
    const res = await ipcInvoke<{ filePath: string }>(IPC_CHANNELS.FILE_SELECT_VIDEO)
    if (!res.success || !res.data?.filePath) return null

    const filePath = res.data.filePath
    const meta = await probeAndUpdate(filePath)
    if (!meta) {
      message.error('无法解析视频文件，请检查文件格式')
      return null
    }
    // Track current file path — discard frame results if user switches videos mid-extraction
    currentFilePathRef.current = filePath
    extractFramesAndUpdate(filePath).then((frames) => {
      if (currentFilePathRef.current === filePath && frames.length > 0) {
        usePublishStore.getState().setFrames(frames)
      }
    })
    return meta
  }, [])

  const handleDropFile = useCallback(async (filePath: string) => {
    const meta = await probeAndUpdate(filePath)
    if (!meta) {
      message.error('无法解析视频文件，请检查文件格式')
      return
    }
    currentFilePathRef.current = filePath
    extractFramesAndUpdate(filePath).then((frames) => {
      if (currentFilePathRef.current === filePath && frames.length > 0) {
        usePublishStore.getState().setFrames(frames)
      }
    })
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
      const frameDataUrl = frames[index].dataUrl
      store.updateForm({
        coverFrameIndex: index,
        coverPath: null,
        horizontalCover: frameDataUrl,
        verticalCover: frameDataUrl,
        cover: { horizontal_4_3: frameDataUrl, vertical_3_4: frameDataUrl, recommended: [] }
      })
    }
  }, [store])

  /**
   * Re-read latest form state after async gap (e.g. confirmation dialog).
   * Prevents stale closures from publishing outdated content (M7 fix).
   */
  const readLatestForm = useCallback(() => usePublishStore.getState().form, [])

  /**
   * Convert cover data URL to a temp file path. Returns undefined if no cover is set.
   */
  const resolveCoverFilePath = useCallback(async (form: PublishFormData): Promise<string | undefined> => {
    const coverSource = form.cover.horizontal_4_3 || form.horizontalCover || form.coverPath
    if (coverSource && coverSource.startsWith('data:')) {
      const coverRes = await ipcInvoke<{ filePath: string }>(
        IPC_CHANNELS.FILE_DATA_URL_TO_TEMP,
        coverSource
      )
      if (coverRes.success && coverRes.data?.filePath) {
        return coverRes.data.filePath
      }
    } else if (coverSource && !coverSource.startsWith('data:')) {
      return coverSource
    }
    return undefined
  }, [])

  const publish = useCallback(async () => {
    // Prevent re-entry — user could double-click or press Ctrl+Enter twice
    if (publishingRef.current) {
      message.warning('发布正在进行中，请稍候')
      return
    }
    publishingRef.current = true

    try {
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

    // 验证标题是否符合平台限制
    const titleResult = validateTitle(form.title, form.platforms)
    if (!titleResult.valid) {
      message.error(titleResult.message)
      return
    }

    // 验证描述是否符合平台限制
    const descResult = validateDescription(form.description, form.platforms)
    if (!descResult.valid) {
      message.error(descResult.message)
      return
    }

    // 验证话题标签是否符合平台限制
    const hashtagResult = validateHashtags(form.hashtags, form.platforms)
    if (!hashtagResult.valid) {
      message.error(hashtagResult.message)
      return
    }

    for (const platformId of form.platforms) {
      const validation = await validateForPlatform(video.filePath, platformId)
      if (!validation.valid) {
        message.error(`[${platformId}] ${validation.errors[0]}`)
        return
      }
    }

    // Confirmation dialog — re-read form after dialog in case of async state changes (M7 fix)
    const confirmed = await confirm({
      title: '确认发布',
      content: `即将发布到 ${form.platforms.length} 个平台，标题：「${form.title}」`,
      okText: '确认发布'
    })
    if (!confirmed) return
    const latestForm = readLatestForm()

    const coverFilePath = await resolveCoverFilePath(latestForm)

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

        // Merge shared fields with platform overrides — use latest form after dialog (M7 fix)
        const mergedContent = mergeSharedWithOverrides(latestForm, platformId)

        store.updateTask(task.id, { status: 'submitting', progress: 90 })
        const contentPayload: Record<string, unknown> = {
          ...mergedContent,
          platformFields: latestForm.platformOverrides[platformId as PlatformId] || {}
        }
        // Only include coverPath if it's a valid file path (avoid IPC converting undefined to "undefined")
        if (coverFilePath) {
          contentPayload.coverPath = coverFilePath
        }
        const submitRes = await ipcInvoke<{ recordId: string }>(IPC_CHANNELS.PUBLISH_SUBMIT, {
          recordId,
          platformId,
          videoId,
          content: contentPayload
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
    } finally {
      publishingRef.current = false
    }
  }, [store, confirm])

  return {
    ...store,
    selectVideo,
    handleDropFile,
    selectCover,
    selectFrameAsCover,
    publish,
    resolveCoverFilePath
  }
}
