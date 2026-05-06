import { useEffect, useCallback, useState } from 'react'
import { Typography, Button, Space, Card, Divider, Alert, Progress, List, Tag, message } from 'antd'
import { SendOutlined, ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons'
import VideoDropZone from '@/components/publish/VideoDropZone'
import VideoPreview from '@/components/publish/VideoPreview'
import CoverSelector from '@/components/publish/CoverSelector'
import UnifiedEditor from '@/components/publish/UnifiedEditor'
import PublishTargetPicker from '@/components/publish/PublishTargetPicker'
import PlatformCustomizer from '@/components/publish/PlatformCustomizer'
import { usePublishFlow } from '@/hooks/usePublishFlow'
import { useAccountStore } from '@/stores/accountStore'
import SchedulePicker from '@/components/publish/SchedulePicker'
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

    // Convert cover data URL to temp file
    let coverFilePath: string | undefined
    if (form.horizontalCover) {
      const coverRes = await window.electron.ipcRenderer.invoke<{ filePath: string }>(
        IPC_CHANNELS.FILE_DATA_URL_TO_TEMP,
        form.horizontalCover
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
      <Title level={3}>内容发布</Title>
      <Paragraph type="secondary">上传视频，编辑内容，一键发布到多个平台</Paragraph>

      {/* Step 1: Video Selection */}
      <Card title="1. 选择视频" style={{ marginBottom: 16 }}>
        <VideoDropZone video={flow.video} onSelect={flow.selectVideo} onDropFile={flow.handleDropFile} />
        {flow.video && (
          <VideoPreview
            video={flow.video}
            onRemove={() => flow.setVideo(null)}
          />
        )}
      </Card>

      {/* Step 2: Cover Selection */}
      {flow.video && (
        <Card title="2. 选择封面" style={{ marginBottom: 16 }}>
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
                flow.updateForm({ horizontalCover: croppedDataUrl })
              } else {
                flow.updateForm({ verticalCover: croppedDataUrl })
              }
            }}
          />
        </Card>
      )}

      {/* Step 3: Edit Content */}
      {flow.video && (
        <Card title="3. 编辑内容" style={{ marginBottom: 16 }}>
          <UnifiedEditor
            form={flow.form}
            onChange={flow.updateForm}
          />
        </Card>
      )}

      {/* Step 4: Select Platforms */}
      {flow.video && (
        <Card title="4. 选择平台" style={{ marginBottom: 16 }}>
          <PublishTargetPicker
            value={flow.form.platforms}
            onChange={(platforms: PlatformId[]) => flow.updateForm({ platforms })}
          />
        </Card>
      )}

      {/* Step 5: Platform Customization */}
      {flow.video && flow.form.platforms.length > 0 && (
        <Card title="5. 平台定制" style={{ marginBottom: 16 }}>
          <PlatformCustomizer
            platforms={flow.form.platforms}
            overrides={flow.form.platformOverrides}
            onChange={(platformOverrides) => flow.updateForm({ platformOverrides })}
          />
        </Card>
      )}

      {/* Step 6: Publish */}
      {flow.video && (
        <Card title="6. 发布" style={{ marginBottom: 16 }}>
          <Space>
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              loading={hasActiveTasks}
              disabled={!flow.video || flow.form.platforms.length === 0 || hasActiveTasks}
              onClick={flow.publish}
            >
              立即发布
            </Button>
            <Button
              size="large"
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
        </Card>
      )}

      {/* Task Progress */}
      {flow.tasks.length > 0 && (
        <Card title="发布进度" style={{ marginBottom: 16 }}>
          <List
            dataSource={flow.tasks}
            renderItem={(task) => {
              const info = PLATFORMS[task.platform]
              return (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Space>
                        <Text strong>{info?.icon} {info?.displayName}</Text>
                        <Tag color={
                          task.status === 'done' ? 'success' :
                          task.status === 'error' ? 'error' : 'processing'
                        }>
                          {task.status === 'uploading' ? '上传中' :
                           task.status === 'submitting' ? '提交中' :
                           task.status === 'done' ? '已完成' :
                           task.status === 'error' ? '失败' : task.status}
                        </Tag>
                      </Space>
                      <Text type="secondary">{task.progress}%</Text>
                    </div>
                    <Progress
                      percent={task.progress}
                      status={task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : 'active'}
                      showInfo={false}
                    />
                    {task.error && (
                      <Alert type="error" message={task.error} style={{ marginTop: 8 }} banner />
                    )}
                  </div>
                </List.Item>
              )
            }}
          />
          {allDone && (
            <Alert type="success" message="所有平台发布完成！" showIcon style={{ marginTop: 16 }} />
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
