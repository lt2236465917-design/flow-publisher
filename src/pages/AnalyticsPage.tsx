import { useEffect, useState } from 'react'
import {
  Table,
  Empty,
  Spin,
  Button,
  Tag,
  Space,
  Tooltip,
  message
} from 'antd'
import {
  SyncOutlined,
  EyeOutlined,
  LikeOutlined,
  MessageOutlined,
  ShareAltOutlined,
  ArrowLeftOutlined
} from '@ant-design/icons'
import { Line, Column } from '@ant-design/charts'
import { useAnalyticsStore } from '@/stores/analyticsStore'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'
import type {
  VideoGroupSummary,
  VideoGroupDetail,
  VideoGroupRecordDetail
} from '../../shared/contracts/analytics.contract'

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

export default function AnalyticsPage() {
  const {
    videoGroups,
    videoGroupsTotal,
    videoGroupsPage,
    videoGroupsLoading,
    videoDetail,
    videoDetailLoading,
    collecting,
    fetchVideoGroups,
    fetchVideoDetail,
    collectAll,
    clearVideoDetail
  } = useAnalyticsStore()

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  useEffect(() => {
    fetchVideoGroups()
  }, [fetchVideoGroups])

  const handleCollect = async () => {
    try {
      const result = await collectAll()
      if (result.errors.length) {
        message.warning(`采集完成：更新 ${result.updatedRecords} 条，${result.errors[0]}`)
      } else if (result.updatedRecords === 0) {
        message.info('没有采集到可更新的数据')
      } else {
        message.success(`数据采集完成，更新 ${result.updatedRecords} 条`)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '数据采集失败')
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

  // 视频列表列定义
  const videoColumns = [
    {
      title: '视频标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      width: 200,
      render: (title: string, record: VideoGroupSummary) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{title || '无标题'}</div>
          <div style={{ fontSize: 11, color: '#86868b', marginTop: 2 }}>
            {new Date(record.createdAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
      )
    },
    {
      title: '平台',
      dataIndex: 'platforms',
      key: 'platforms',
      width: 180,
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
            数据统计
          </h1>
          <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>
            视频表现数据与跨平台对比分析
          </p>
        </div>
        <Button
          type="primary"
          icon={<SyncOutlined spin={collecting} />}
          loading={collecting}
          onClick={handleCollect}
        >
          采集数据
        </Button>
      </div>

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
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 14,
                  border: '1px solid rgba(0, 0, 0, 0.06)',
                  padding: '48px 0',
                }}
              >
                <Empty description="暂无视频数据，点击「采集数据」获取" />
              </div>
            ) : (
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 14,
                  border: '1px solid rgba(0, 0, 0, 0.06)',
                  padding: 20,
                }}
              >
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
              </div>
            )}
          </>
        )}
      </Spin>
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

      {/* 视频标题 */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          padding: 20,
          marginBottom: 14
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{detail.title || '无标题'}</h2>
        <p style={{ margin: '8px 0 0', color: '#86868b', fontSize: 13 }}>
          发布时间: {new Date(detail.createdAt).toLocaleString('zh-CN')}
        </p>
      </div>

      {/* 各平台数据卡片 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${detail.records.length}, 1fr)`,
          gap: 14,
          marginBottom: 14
        }}
      >
        {detail.records.map((record) => (
          <PlatformCard key={record.recordId} record={record} />
        ))}
      </div>

      {/* 跨平台对比图表 */}
      {detail.records.length > 1 && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid rgba(0, 0, 0, 0.06)',
            padding: 20,
            marginBottom: 14
          }}
        >
          <h3
            style={{
              fontFamily: "'Sora', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: '#1d1d1f',
              marginBottom: 16,
            }}
          >
            跨平台数据对比
          </h3>
          <Column
            data={detail.records.flatMap((r) => [
              { platform: getPlatformName(r.platform), metric: '播放量', value: r.latestSnapshot?.views || 0 },
              { platform: getPlatformName(r.platform), metric: '点赞数', value: r.latestSnapshot?.likes || 0 },
              { platform: getPlatformName(r.platform), metric: '评论数', value: r.latestSnapshot?.comments || 0 },
              { platform: getPlatformName(r.platform), metric: '分享数', value: r.latestSnapshot?.shares || 0 }
            ])}
            xField="platform"
            yField="value"
            colorField="metric"
            group={{ title: true }}
            height={300}
            axis={{ y: { title: '数量' } }}
            legend={{ position: 'top' }}
          />
        </div>
      )}

      {/* 趋势图表 */}
      {detail.records.some((r) => r.trend.length > 0) && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid rgba(0, 0, 0, 0.06)',
            padding: 20
          }}
        >
          <h3
            style={{
              fontFamily: "'Sora', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: '#1d1d1f',
              marginBottom: 16,
            }}
          >
            数据趋势
          </h3>
          {detail.records.map((record) => (
            record.trend.length > 0 && (
              <div key={record.recordId} style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                  {getPlatformName(record.platform)} - 播放量趋势
                </h4>
                <Line
                  data={record.trend.map((t) => ({
                    date: new Date(t.snapshotAt).toLocaleDateString('zh-CN'),
                    播放量: t.views,
                    点赞数: t.likes
                  }))}
                  xField="date"
                  yField="播放量"
                  height={200}
                  point={{ size: 3 }}
                  axis={{ x: { label: { autoRotate: false } } }}
                />
              </div>
            )
          ))}
        </div>
      )}
    </Spin>
  )
}

// ---- 平台数据卡片 ----

function PlatformCard({ record }: { record: VideoGroupRecordDetail }) {
  const snapshot = record.latestSnapshot
  const platformColor = getPlatformColor(record.platform)

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 14,
        border: `1px solid ${platformColor}20`,
        padding: 20,
        borderTop: `3px solid ${platformColor}`
      }}
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
    </div>
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
