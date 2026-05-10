import { useEffect, useCallback, useState, useMemo } from 'react'
import { Typography, Button, Space, Card, Progress, List, Tag, message, Alert, Divider } from 'antd'
import { SendOutlined, ReloadOutlined, ClockCircleOutlined, VideoCameraOutlined } from '@ant-design/icons'
import VideoDropZone from '@/components/publish/VideoDropZone'
import VideoPreview from '@/components/publish/VideoPreview'
import CoverSelector from '@/components/publish/CoverSelector'
import UnifiedEditor from '@/components/publish/UnifiedEditor'
import PublishTargetPicker from '@/components/publish/PublishTargetPicker'
import PlatformCustomizer from '@/components/publish/PlatformCustomizer'
import { usePublishFlow } from '@/hooks/usePublishFlow'
import { useAccountStore } from '@/stores/accountStore'
import { useKeyboardShortcuts } from '@/hooks/useKeyboard'
import SchedulePicker from '@/components/publish/SchedulePicker'
import EmptyState from '@/components/common/EmptyState'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'

const { Title, Paragraph, Text } = Typography

interface AccountInfo {
  id: string
  platform: string
  displayName: string
  sessionStatus: string
}

export default function PublishPage() {
  const { fetchAccounts } = useAccountStore()
  const flow = usePublishFlow()
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const hasActiveTasks = flow.tasks.some((t) => t.status === 'uploading' || t.status === 'submitting')
  const allDone = flow.tasks.length > 0 && flow.tasks.every((t) => t.status === 'done')

  // Keyboard shortcuts
  const shortcuts = useMemo(() => ({
    'ctrl+o': () => { if (!hasActiveTasks) flow.selectVideo() },
    'ctrl+enter': () => { if (!hasActiveTasks && flow.video && flow.form.platforms.length > 0) flow.publish() },
    'ctrl+r': () => { if (!hasActiveTasks) flow.resetForm() }
  }), [hasActiveTasks, flow])
  useKeyboardShortcuts(shortcuts)

  const handleScheduleConfirm = useCallback(async (scheduledAt: string) => {
    const { video, form } = flow
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

    // Convert cover data URL to temp file (new cover format + legacy fallback)
    const coverSource = form.cover.horizontal_4_3 || form.horizontalCover
    let coverFilePath: string | undefined
    if (coverSource) {
      const coverRes = await window.electron.ipcRenderer.invoke<{ filePath: string }>(
        IPC_CHANNELS.FILE_DATA_URL_TO_TEMP,
        coverSource
      )
      if (coverRes.success && coverRes.data?.filePath) {
        coverFilePath = coverRes.data.filePath
      }
    }

    // Look up account IDs for each platform
    const accountsRes = await window.electron.ipcRenderer.invoke<AccountInfo[]>(IPC_CHANNELS.ACCOUNT_LIST)
    const accounts = accountsRes.data || []
    const accountIds: Record<string, string> = {}
    for (const platformId of form.platforms) {
      const account = accounts.find(
        (a) => a.platform === platformId && a.sessionStatus === 'logged_in'
      )
      if (!account) {
        message.error(`[${platformId}] 该平台未登录`)
        return
      }
      accountIds[platformId] = account.id
    }

    // Build merged content per platform (shared + platform overrides)
    const sharedContent = {
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

    const params = {
      platforms: form.platforms,
      accountIds,
      videoPath: video.filePath,
      coverPath: coverFilePath,
      title: form.title,
      description: form.description,
      hashtags: form.hashtags,
      declarations: form.declarations,
      platformOverrides: form.platformOverrides,
      sharedContent,
      scheduledAt
    }

    const res = await window.electron.ipcRenderer.invoke(IPC_CHANNELS.SCHEDULE_CREATE, params)
    if (res.success) {
      message.success('定时任务已创建')
      setScheduleModalOpen(false)
    } else {
      message.error(res.error || '创建定时任务失败')
    }
  }, [flow])

  const handlePickImage = useCallback(async (): Promise<string | null> => {
    try {
      const res = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.FILE_SELECT_IMAGE
      ) as { success?: boolean; data?: { dataUrl?: string }; error?: string }
      if (res?.success && res.data?.dataUrl) {
        return res.data.dataUrl
      }
      if (res?.error && res.error !== '用户取消选择') {
        message.error(`选择图片失败: ${res.error}`)
      }
      return null
    } catch (e) {
      console.error('[PublishPage] onPickImage error:', e)
      message.error('选择图片时发生错误')
      return null
    }
  }, [])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>内容发布</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Ctrl+O 选择 | Ctrl+Enter 发布 | Ctrl+R 重置
        </Text>
      </div>

      {/* Section 1: Video Selection */}
      <Card size="small" title="选择视频" style={{ marginBottom: 8 }}>
        <VideoDropZone video={flow.video} onSelect={flow.selectVideo} onDropFile={flow.handleDropFile} />
        {flow.video && (
          <VideoPreview
            video={flow.video}
            onRemove={() => flow.setVideo(null)}
          />
        )}
      </Card>

      {/* Section 2: Edit (Cover + Content + Platforms + Customization) */}
      {flow.video && (
        <Card size="small" title="编辑内容" style={{ marginBottom: 8 }}>
          {/* Cover */}
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>封面设置</Text>
          <CoverSelector
            frames={flow.frames}
            loading={flow.extractingFrames}
            selectedIndex={flow.form.coverFrameIndex}
            horizontalCover={flow.form.horizontalCover}
            verticalCover={flow.form.verticalCover}
            onSelectFrame={flow.selectFrameAsCover}
            onPickImage={handlePickImage}
            onCropConfirm={(type, croppedDataUrl) => {
              if (type === 'horizontal') {
                flow.updateForm({
                  horizontalCover: croppedDataUrl,
                  cover: { ...flow.form.cover, horizontal_4_3: croppedDataUrl }
                })
              } else {
                flow.updateForm({
                  verticalCover: croppedDataUrl,
                  cover: { ...flow.form.cover, vertical_3_4: croppedDataUrl }
                })
              }
            }}
          />

          <Divider style={{ margin: '12px 0' }} />

          {/* Content */}
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>基本信息</Text>
          <UnifiedEditor
            form={flow.form}
            onChange={flow.updateForm}
          />

          <Divider style={{ margin: '12px 0' }} />

          {/* Platform selection */}
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>发布平台</Text>
          <PublishTargetPicker
            value={flow.form.platforms}
            onChange={(platforms: PlatformId[]) => flow.updateForm({ platforms })}
          />

          {/* Platform customization */}
          {flow.form.platforms.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>平台定制</Text>
              <PlatformCustomizer
                platforms={flow.form.platforms}
                overrides={flow.form.platformOverrides}
                onChange={(platformOverrides) => flow.updateForm({ platformOverrides })}
              />
            </>
          )}
        </Card>
      )}

      {/* No video selected — show guidance */}
      {!flow.video && (
        <Card size="small">
          <EmptyState
            icon={<VideoCameraOutlined style={{ fontSize: 48, color: '#bfbfbf' }} />}
            title="选择要发布的视频"
            description="将视频文件拖放到上方区域，或点击选择文件按钮"
            actionText="选择视频文件"
            onAction={flow.selectVideo}
          />
        </Card>
      )}

      {/* Section 3: Publish + Progress */}
      {flow.video && (
        <Card size="small" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <Space>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={hasActiveTasks}
                disabled={!flow.video || flow.form.platforms.length === 0 || hasActiveTasks}
                onClick={flow.publish}
              >
                立即发布
              </Button>
              <Button
                icon={<ClockCircleOutlined />}
                disabled={!flow.video || flow.form.platforms.length === 0 || hasActiveTasks}
                onClick={() => setScheduleModalOpen(true)}
              >
                定时发布
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={flow.resetForm}
                disabled={hasActiveTasks}
              >
                重置
              </Button>
            </Space>
          </div>

          {/* Task Progress (inline, only when active) */}
          {flow.tasks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <List
                size="small"
                dataSource={flow.tasks}
                renderItem={(task) => {
                  const info = PLATFORMS[task.platform]
                  return (
                    <List.Item style={{ padding: '4px 0' }}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <Space size={4}>
                            <Text strong style={{ fontSize: 13 }}>{info?.icon} {info?.displayName}</Text>
                            <Tag color={
                              task.status === 'done' ? 'success' :
                              task.status === 'error' ? 'error' : 'processing'
                            } style={{ fontSize: 11 }}>
                              {task.status === 'uploading' ? '上传中' :
                               task.status === 'submitting' ? '提交中' :
                               task.status === 'done' ? '已完成' :
                               task.status === 'error' ? '失败' : task.status}
                            </Tag>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 12 }}>{task.progress}%</Text>
                        </div>
                        <Progress
                          percent={task.progress}
                          status={task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : 'active'}
                          showInfo={false}
                          size="small"
                        />
                        {task.error && (
                          <Alert type="error" message={task.error} style={{ marginTop: 4 }} banner />
                        )}
                      </div>
                    </List.Item>
                  )
                }}
              />
              {allDone && (
                <Alert type="success" message="所有平台发布完成！" showIcon style={{ marginTop: 8 }} />
              )}
            </div>
          )}
        </Card>
      )}

      {/* Schedule Modal */}
      <SchedulePicker
        open={scheduleModalOpen}
        onConfirm={handleScheduleConfirm}
        onCancel={() => setScheduleModalOpen(false)}
      />
    </div>
  )
}
