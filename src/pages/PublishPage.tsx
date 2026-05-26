import { useEffect, useCallback, useState, useMemo } from 'react'
import { Button, Space, Progress, List, Tag, message, Alert } from 'antd'
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
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1
            style={{
              fontFamily: "'Sora', sans-serif",
              fontSize: 28,
              fontWeight: 700,
              color: '#1d1d1f',
              letterSpacing: '-0.03em',
              marginBottom: 6,
            }}
          >
            内容发布
          </h1>
          <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>
            创建一次，发布到所有平台
          </p>
        </div>
        <span style={{ fontSize: 11, color: '#aeaeb2', letterSpacing: '0.02em' }}>
          Ctrl+O 选择 · Ctrl+Enter 发布 · Ctrl+R 重置
        </span>
      </div>

      {/* Video Selection */}
      <SectionCard>
        <SectionTitle>选择视频</SectionTitle>
        <VideoDropZone video={flow.video} onSelect={flow.selectVideo} onDropFile={flow.handleDropFile} />
        {flow.video && (
          <VideoPreview
            video={flow.video}
            onRemove={() => flow.setVideo(null)}
          />
        )}
      </SectionCard>

      {/* No video — guidance */}
      {!flow.video && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid rgba(0, 0, 0, 0.06)',
            marginTop: 14,
          }}
        >
          <EmptyState
            icon={<VideoCameraOutlined />}
            title="选择要发布的视频"
            description="将视频文件拖放到上方区域，或点击选择文件"
            actionText="选择视频文件"
            onAction={flow.selectVideo}
          />
        </div>
      )}

      {/* Edit Content */}
      {flow.video && (
        <SectionCard>
          <SectionTitle>封面设置</SectionTitle>
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

          <Divider />

          <SectionTitle>基本信息</SectionTitle>
          <UnifiedEditor form={flow.form} onChange={flow.updateForm} platforms={flow.form.platforms} />

          <Divider />

          <SectionTitle>发布平台</SectionTitle>
          <PublishTargetPicker
            value={flow.form.platforms}
            onChange={(platforms: PlatformId[]) => flow.updateForm({ platforms })}
          />

          {flow.form.platforms.length > 0 && (
            <>
              <Divider />
              <SectionTitle>平台定制</SectionTitle>
              <PlatformCustomizer
                platforms={flow.form.platforms}
                overrides={flow.form.platformOverrides}
                onChange={(platformOverrides) => flow.updateForm({ platformOverrides })}
              />
            </>
          )}
        </SectionCard>
      )}

      {/* Publish Actions */}
      {flow.video && (
        <SectionCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <Space size={10}>
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

          {/* Task Progress */}
          {flow.tasks.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <List
                size="small"
                dataSource={flow.tasks}
                renderItem={(task) => {
                  const info = PLATFORMS[task.platform]
                  return (
                    <List.Item style={{ padding: '8px 0', border: 'none' }}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Space size={6}>
                            <span style={{ fontSize: 15 }}>{info?.icon}</span>
                            <span style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>{info?.displayName}</span>
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
                          <span style={{ fontSize: 12, color: '#86868b' }}>{task.progress}%</span>
                        </div>
                        <Progress
                          percent={task.progress}
                          status={task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : 'active'}
                          showInfo={false}
                          size="small"
                          strokeColor={task.status === 'done' ? '#34c759' : task.status === 'error' ? '#ff3b30' : '#0071e3'}
                        />
                        {task.error && (
                          <Alert type="error" message={task.error} style={{ marginTop: 6, borderRadius: 8 }} banner />
                        )}
                      </div>
                    </List.Item>
                  )
                }}
              />
              {allDone && (
                <Alert
                  type="success"
                  message="所有平台发布完成！"
                  showIcon
                  style={{ marginTop: 10, borderRadius: 8 }}
                />
              )}
            </div>
          )}
        </SectionCard>
      )}

      <SchedulePicker
        open={scheduleModalOpen}
        onConfirm={handleScheduleConfirm}
        onCancel={() => setScheduleModalOpen(false)}
      />
    </div>
  )
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid rgba(0, 0, 0, 0.06)',
        padding: '20px 24px',
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontFamily: "'Sora', sans-serif",
        fontSize: 13,
        fontWeight: 600,
        color: '#86868b',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 14,
      }}
    >
      {children}
    </h3>
  )
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: 'rgba(0, 0, 0, 0.04)',
        margin: '18px 0',
      }}
    />
  )
}
