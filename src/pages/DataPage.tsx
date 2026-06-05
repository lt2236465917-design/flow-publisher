import { useEffect, useState } from 'react'
import {
  Table,
  Empty,
  Spin,
  Button,
  Tag,
  Space,
  Tooltip,
  message,
  Card,
  Row,
  Col,
  Typography,
  Divider,
  Popconfirm,
  Tabs
} from 'antd'
import {
  SyncOutlined,
  EyeOutlined,
  LikeOutlined,
  MessageOutlined,
  ShareAltOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  StopOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  StarOutlined
} from '@ant-design/icons'
import { Line, Column } from '@ant-design/charts'
import { useAnalyticsStore } from '@/stores/analyticsStore'
import { useRecordStore } from '@/stores/recordStore'
import { usePolling } from '@/hooks/usePolling'
import { useScheduleProgress } from '@/hooks/useScheduleProgress'
import TaskStatusTag from '@/components/records/TaskStatusTag'
import EmptyState from '@/components/common/EmptyState'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'
import type {
  VideoGroupSummary,
  VideoGroupDetail,
  VideoGroupRecordDetail
} from '../../shared/contracts/analytics.contract'
import dayjs from 'dayjs'

const { Text, Paragraph } = Typography

function getPlatformName(platform: string): string {
  const info = PLATFORMS[platform as PlatformId]
  return info ? `${info.icon} ${info.displayName}` : platform
}

function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    douyin: '#000000',
    kuaishou: '#ff4906',
    xiaohongshu: '#ff2442',
    'wechat-channels': '#07c160'
  }
  return colors[platform] || '#666'
}

function formatNumber(num: number): string {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + '万'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}

export default function DataPage() {
  // 视频数据相关
  const {
    videoGroups,
    videoGroupsTotal,
    videoGroupsPage,
    videoGroupsLoading,
    videoDetail,
    videoDetailLoading,
    collecting,
    collectResult,
    fetchVideoGroups,
    fetchVideoDetail,
    collectAll,
    collectVideoGroup,
    clearVideoDetail
  } = useAnalyticsStore()

  // 发布记录相关
  const {
    records,
    scheduledTasks,
    loading: recordsLoading,
    fetchRecords,
    fetchScheduledTasks,
    cancelScheduledTask,
    deleteScheduledTask
  } = useRecordStore()

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('videos')

  useEffect(() => {
    if (activeTab === 'videos') {
      fetchVideoGroups()
    } else {
      fetchRecords()
      fetchScheduledTasks()
    }
  }, [activeTab, fetchVideoGroups, fetchRecords, fetchScheduledTasks])

  useScheduleProgress()
  usePolling(fetchScheduledTasks, 30000, true)

  const handleCollect = async () => {
    try {
      if (selectedGroup) {
        // 在详情页，采集当前视频的数据
        await collectVideoGroup(selectedGroup)
      } else {
        // 在列表页，采集所有数据
        await collectAll()
      }
      if (collectResult?.errors.length) {
        message.warning(`采集完成，但有 ${collectResult.errors.length} 个错误`)
      } else {
        message.success('数据采集完成')
      }
    } catch {
      message.error('数据采集失败')
    }
  }

  const handleViewDetail = (groupId: string) => {
    setSelectedGroup(groupId)
    fetchVideoDetail(groupId)
  }

  const handleBack = () => {
    setSelectedGroup(null)
    clearVideoDetail()
  }

  const handleCancel = async (taskId: string) => {
    const ok = await cancelScheduledTask(taskId)
    if (ok) {
      message.success('任务已取消')
    } else {
      message.error('取消失败')
    }
  }

  const handleDelete = async (taskId: string) => {
    const ok = await deleteScheduledTask(taskId)
    if (ok) {
      message.success('任务已删除')
    } else {
      message.error('删除失败')
    }
  }

  // 定时任务列定义
  const scheduledColumns = [
    {
      title: '平台',
      dataIndex: 'platforms',
      key: 'platforms',
      width: 160,
      render: (platforms: string[]) => (
        <Space size={6}>
          {platforms.map((p) => {
            const info = PLATFORMS[p as PlatformId]
            return info ? (
              <span key={p} title={info.displayName} style={{ fontSize: 16 }}>
                {info.icon}
              </span>
            ) : (
              <span key={p}>{p}</span>
            )
          })}
        </Space>
      )
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true
    },
    {
      title: '定时时间',
      dataIndex: 'scheduledAt',
      key: 'scheduledAt',
      width: 180,
      sorter: (a: { scheduledAt: string }, b: { scheduledAt: string }) =>
        dayjs(a.scheduledAt).unix() - dayjs(b.scheduledAt).unix(),
      render: (t: string) => (
        <span style={{ color: '#86868b', fontSize: 13 }}>
          {dayjs(t).format('MM月DD日 HH:mm')}
        </span>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => <TaskStatusTag status={status} />
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: { id: string; status: string }) => (
        <Space>
          {record.status === 'pending' && (
            <Popconfirm
              title="确认取消此定时任务？"
              onConfirm={() => handleCancel(record.id)}
              okText="确认"
              cancelText="取消"
            >
              <Button size="small" icon={<StopOutlined />} danger>
                取消
              </Button>
            </Popconfirm>
          )}
          {['done', 'error', 'cancelled'].includes(record.status) && (
            <Popconfirm
              title="确认删除此任务记录？"
              onConfirm={() => handleDelete(record.id)}
              okText="确认"
              cancelText="取消"
            >
              <Button size="small" icon={<DeleteOutlined />} danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ]

  // 视频列表列定义
  const videoColumns = [
    {
      title: '视频',
      dataIndex: 'title',
      key: 'video',
      width: 350,
      render: (title: string, record: VideoGroupSummary) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* 视频封面 */}
          <div
            style={{
              width: 80,
              height: 45,
              borderRadius: 6,
              background: record.coverPath ? '#000' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {record.coverPath ? (
              <img
                src={`local-file:///${record.coverPath.replace(/\\/g, '/')}`}
                alt="cover"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            ) : (
              <PlayCircleOutlined style={{ fontSize: 20, color: 'rgba(255,255,255,0.9)' }} />
            )}
          </div>
          {/* 标题和时间 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title || '无标题'}
            </div>
            <div style={{ fontSize: 11, color: '#86868b' }}>
              {new Date(record.createdAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>
      )
    },
    {
      title: '发布平台',
      dataIndex: 'platforms',
      key: 'platforms',
      width: 200,
      render: (_: unknown, record: VideoGroupSummary) => (
        <Space size={4} wrap>
          {record.platforms.map((p) => (
            <Tooltip
              key={p.platform}
              title={`${getPlatformName(p.platform)}: ${formatNumber(p.views)}播放`}
            >
              <Tag
                color={getPlatformColor(p.platform)}
                style={{ margin: 0, fontSize: 11, borderRadius: 4 }}
              >
                {getPlatformName(p.platform).split(' ')[0]}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      )
    },
    {
      title: '总播放',
      dataIndex: 'totalViews',
      key: 'totalViews',
      width: 100,
      sorter: (a: VideoGroupSummary, b: VideoGroupSummary) => a.totalViews - b.totalViews,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: '#0071e3' }}>{formatNumber(v)}</span>
      )
    },
    {
      title: '总点赞',
      dataIndex: 'totalLikes',
      key: 'totalLikes',
      width: 80,
      render: (v: number) => <span>{formatNumber(v)}</span>
    },
    {
      title: '总评论',
      dataIndex: 'totalComments',
      key: 'totalComments',
      width: 80,
      render: (v: number) => <span>{formatNumber(v)}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: VideoGroupSummary) => (
        <Button
          type="link"
          size="small"
          onClick={() => handleViewDetail(record.groupId)}
        >
          详情
        </Button>
      )
    }
  ]

  const tabItems = [
    {
      key: 'videos',
      label: '视频数据',
      children: (
        <Spin spinning={videoGroupsLoading}>
          {selectedGroup && videoDetail ? (
            <VideoDetailView
              detail={videoDetail}
              loading={videoDetailLoading}
              onBack={handleBack}
            />
          ) : (
            <>
              {videoGroups.length === 0 ? (
                <EmptyState
                  icon={<FileTextOutlined />}
                  title="暂无视频数据"
                  description="发布视频后，点击「采集数据」获取各平台数据"
                />
              ) : (
                <Table
                  dataSource={videoGroups}
                  columns={videoColumns}
                  rowKey="groupId"
                  pagination={{
                    current: videoGroupsPage,
                    total: videoGroupsTotal,
                    pageSize: 20,
                    onChange: (page) => fetchVideoGroups({ page })
                  }}
                  size="middle"
                />
              )}
            </>
          )}
        </Spin>
      )
    },
    {
      key: 'scheduled',
      label: `定时任务`,
      children: scheduledTasks.length === 0 && !recordsLoading ? (
        <EmptyState
          icon={<ClockCircleOutlined />}
          title="暂无定时任务"
          description="在发布页面设置定时发布后，任务将显示在这里"
        />
      ) : (
        <Table
          dataSource={scheduledTasks}
          columns={scheduledColumns}
          rowKey="id"
          loading={recordsLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`
          }}
          size="middle"
          scroll={{ x: 700 }}
        />
      )
    }
  ]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
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
            数据中心
          </h1>
          <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>
            视频发布记录与各平台数据统计
          </p>
        </div>
        {activeTab === 'videos' && (
          <div style={{ textAlign: 'right' }}>
            <Button
              type="primary"
              icon={<SyncOutlined spin={collecting} />}
              loading={collecting}
              onClick={handleCollect}
            >
              {selectedGroup ? '采集当前视频' : '采集数据'}
            </Button>
            {!selectedGroup && (
              <div style={{ fontSize: 11, color: '#86868b', marginTop: 4 }}>
                只采集近 30 条内容的数据
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          background: 'rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderRadius: 16,
          border: '0.5px solid rgba(255, 255, 255, 0.85)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)',
          padding: '20px 24px',
        }}
      >
        <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
      </div>
    </div>
  )
}

// ---- 视频详情组件 ----

function VideoDetailView({
  detail,
  loading,
  onBack
}: {
  detail: VideoGroupDetail
  loading: boolean
  onBack: () => void
}) {
  return (
    <Spin spinning={loading}>
      {/* 返回按钮 */}
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={onBack}
        style={{ marginBottom: 16 }}
      >
        返回列表
      </Button>

      {/* 视频基本信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          {/* 封面 */}
          <Col span={4}>
            <div
              style={{
                width: '100%',
                aspectRatio: '16/9',
                borderRadius: 8,
                background: '#f0f0f0',
                overflow: 'hidden'
              }}
            >
              {detail.coverPath ? (
                <img
                  src={`local-file:///${detail.coverPath.replace(/\\/g, '/')}`}
                  alt="cover"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#86868b'
                  }}
                >
                  <FileTextOutlined style={{ fontSize: 24 }} />
                </div>
              )}
            </div>
          </Col>
          {/* 信息 */}
          <Col span={20}>
            <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
              {detail.title || '无标题'}
            </h2>
            <p style={{ margin: '0 0 12px', color: '#86868b', fontSize: 13 }}>
              发布时间: {new Date(detail.createdAt).toLocaleString('zh-CN')}
            </p>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>发布平台: </Text>
              <Space size={4}>
                {detail.records.map((r) => (
                  <Tag key={r.platform} color={getPlatformColor(r.platform)} style={{ margin: 0 }}>
                    {getPlatformName(r.platform)}
                  </Tag>
                ))}
              </Space>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 各平台数据卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {detail.records.map((record) => (
          <Col key={record.recordId} span={Math.min(24 / detail.records.length, 8)}>
            <PlatformCard record={record} />
          </Col>
        ))}
      </Row>

      {/* 跨平台数据对比 */}
      {detail.records.length > 1 && (
        <Card title="跨平台数据对比" style={{ marginBottom: 16 }}>
          {/* 柱状图 */}
          <Column
            data={detail.records.flatMap((r) => [
              { platform: getPlatformName(r.platform), metric: '播放量', value: r.latestSnapshot?.views || 0 },
              { platform: getPlatformName(r.platform), metric: '点赞数', value: r.latestSnapshot?.likes || 0 },
              { platform: getPlatformName(r.platform), metric: '评论数', value: r.latestSnapshot?.comments || 0 },
              { platform: getPlatformName(r.platform), metric: '分享数', value: r.latestSnapshot?.shares || 0 },
              { platform: getPlatformName(r.platform), metric: '收藏数', value: r.latestSnapshot?.followers || 0 }
            ])}
            xField="platform"
            yField="value"
            colorField="metric"
            group={{ title: true }}
            height={300}
            axis={{ y: { title: '数量' } }}
            legend={{ position: 'top' }}
          />

          {/* 对比表格 */}
          <Table
            dataSource={detail.records.map((r) => ({
              platform: r.platform,
              views: r.latestSnapshot?.views || 0,
              likes: r.latestSnapshot?.likes || 0,
              comments: r.latestSnapshot?.comments || 0,
              shares: r.latestSnapshot?.shares || 0,
              favorites: r.latestSnapshot?.followers || 0
            }))}
            columns={[
              { title: '平台', dataIndex: 'platform', key: 'platform', render: (p: string) => getPlatformName(p) },
              { title: '播放量', dataIndex: 'views', key: 'views', sorter: (a: any, b: any) => a.views - b.views },
              { title: '点赞数', dataIndex: 'likes', key: 'likes', sorter: (a: any, b: any) => a.likes - b.likes },
              { title: '评论数', dataIndex: 'comments', key: 'comments', sorter: (a: any, b: any) => a.comments - b.comments },
              { title: '分享数', dataIndex: 'shares', key: 'shares', sorter: (a: any, b: any) => a.shares - b.shares },
              { title: '收藏数', dataIndex: 'favorites', key: 'favorites', sorter: (a: any, b: any) => a.favorites - b.favorites }
            ]}
            rowKey="platform"
            pagination={false}
            size="small"
            style={{ marginTop: 16 }}
          />
        </Card>
      )}

    </Spin>
  )
}

// ---- 平台数据卡片 ----

function PlatformCard({ record }: { record: VideoGroupRecordDetail }) {
  const snapshot = record.latestSnapshot
  const platformColor = getPlatformColor(record.platform)

  return (
    <Card
      style={{ borderTop: `3px solid ${platformColor}` }}
      bodyStyle={{ padding: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 16 }}>{getPlatformName(record.platform).split(' ')[0]}</span>
        <Tag color={platformColor} style={{ margin: 0, fontSize: 11 }}>
          {getPlatformName(record.platform).split(' ')[1] || record.platform}
        </Tag>
      </div>

      {snapshot ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MetricItem icon={<EyeOutlined />} label="播放量" value={snapshot.views} color="#0071e3" />
          <MetricItem icon={<LikeOutlined />} label="点赞数" value={snapshot.likes} color="#ff3b30" />
          <MetricItem icon={<MessageOutlined />} label="评论数" value={snapshot.comments} color="#ff9500" />
          <MetricItem icon={<ShareAltOutlined />} label="分享数" value={snapshot.shares} color="#34c759" />
          <MetricItem icon={<StarOutlined />} label="收藏数" value={snapshot.followers} color="#af52de" />
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#86868b', padding: '20px 0' }}>
          暂无数据
        </div>
      )}

      {snapshot?.snapshotAt && (
        <div style={{ fontSize: 11, color: '#86868b', marginTop: 12, textAlign: 'right' }}>
          更新于: {new Date(snapshot.snapshotAt).toLocaleString('zh-CN')}
        </div>
      )}
    </Card>
  )
}

function MetricItem({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{ color, fontSize: 12 }}>{icon}</span>
        <span style={{ fontSize: 11, color: '#86868b' }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f' }}>
        {formatNumber(value)}
      </div>
    </div>
  )
}
