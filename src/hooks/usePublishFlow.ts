import { useCallback, useEffect } from 'react'
import { message, Modal } from 'antd'
import { usePublishStore, probeAndUpdate, extractFramesAndUpdate, validateForPlatform } from '@/stores/publishStore'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import type { PlatformId } from '@/constants/platforms'

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

export function usePublishFlow() {
  const store = usePublishStore()

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
    const res = await window.electron.ipcRenderer.invoke<{ filePath: string }>(IPC_CHANNELS.FILE_SELECT_VIDEO)
    if (!res.success || !res.data?.filePath) return null

    const filePath = res.data.filePath
    const meta = await probeAndUpdate(filePath)
    if (!meta) {
      message.error('无法解析视频文件')
      return null
    }
    extractFramesAndUpdate(filePath)
    return meta
  }, [])

  const handleDropFile = useCallback(async (filePath: string) => {
    const meta = await probeAndUpdate(filePath)
    if (!meta) {
      message.error('无法解析视频文件')
      return
    }
    extractFramesAndUpdate(filePath)
  }, [])

  const selectCover = useCallback(async () => {
    const res = await window.electron.ipcRenderer.invoke<{ filePath: string }>(IPC_CHANNELS.FILE_SELECT_IMAGE)
    if (!res.success || !res.data?.filePath) return null
    return res.data.filePath
  }, [])

  const selectFrameAsCover = useCallback((index: number | null) => {
    if (index === null) {
      store.updateForm({ coverFrameIndex: null, horizontalCover: null, verticalCover: null })
      return
    }
    const frames = usePublishStore.getState().frames
    if (index >= 0 && index < frames.length) {
      store.updateForm({ coverFrameIndex: index, coverPath: null, horizontalCover: null, verticalCover: null })
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

    for (const platformId of form.platforms) {
      const validation = await validateForPlatform(video.filePath, platformId)
      if (!validation.valid) {
        message.error(`[${platformId}] ${validation.errors[0]}`)
        return
      }
    }

    // Confirmation dialog
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '确认发布',
        content: `即将发布到 ${form.platforms.length} 个平台，标题：「${form.title}」`,
        okText: '确认发布',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!confirmed) return

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
        const accountsRes = await window.electron.ipcRenderer.invoke<AccountInfo[]>(IPC_CHANNELS.ACCOUNT_LIST)
        const account = (accountsRes.data || []).find(
          (a) => a.platform === platformId && a.sessionStatus === 'logged_in'
        )
        if (!account) {
          store.updateTask(task.id, { status: 'error', error: '该平台未登录' })
          continue
        }

        store.updateTask(task.id, { status: 'uploading', progress: 0 })
        const uploadRes = await window.electron.ipcRenderer.invoke<{ recordId: string }>(IPC_CHANNELS.PUBLISH_UPLOAD, {
          accountId: account.id,
          platformId,
          filePath: video.filePath
        })

        if (!uploadRes.success) {
          store.updateTask(task.id, { status: 'error', error: uploadRes.error })
          continue
        }

        const recordId = uploadRes.data!.recordId

        store.updateTask(task.id, { status: 'submitting', progress: 90 })
        const submitRes = await window.electron.ipcRenderer.invoke<{ recordId: string }>(IPC_CHANNELS.PUBLISH_SUBMIT, {
          recordId,
          platformId,
          content: {
            title: form.title,
            description: form.description,
            hashtags: form.hashtags,
            coverPath: form.coverPath || undefined,
            declarations: form.declarations,
            platformFields: form.platformOverrides[platformId as PlatformId] || {}
          }
        })

        if (submitRes.success) {
          store.updateTask(task.id, { status: 'done', progress: 100 })
        } else {
          store.updateTask(task.id, { status: 'error', error: submitRes.error })
        }
      } catch (e) {
        store.updateTask(task.id, { status: 'error', error: String(e) })
      }
    }

    message.success('发布流程完成')
  }, [store])

  return {
    ...store,
    selectVideo,
    handleDropFile,
    selectCover,
    selectFrameAsCover,
    publish
  }
}
