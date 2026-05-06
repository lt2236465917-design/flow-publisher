import { useEffect } from 'react'
import { Typography, Card, Row, Col, Statistic, Segmented, Table, Empty, Spin } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  BarChartOutlined,
  SendOutlined
} from '@ant-design/icons'
import { Line, Column, Pie } from '@ant-design/charts'
import { useAnalyticsStore } from '@/stores/analyticsStore'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'
import type { TimeRange, DailyTrend, PlatformStats, StatusDistribution } from '../../shared/contracts/analytics.contract'

const { Title, Paragraph } = Typography

const TIME_RANGE_OPTIONS = [
  { label: '近7天', value: '7d' },
  { label: '近30天', value: '30d' },
  { label: '近90天', value: '90d' },
  { label: '全部', value: 'all' }
]

const STATUS_LABELS: Record<string, string> = {
  done: '成功',
  error: '失败',
  pending: '待处理',
  uploading: '上传中',
  uploaded: '已上传',
  submitting: '提交中'
}

const STATUS_COLORS: Record<string, string> = {
  done: '#52c41a',
  error: '#ff4d4f',
  pending: '#faad14',
  uploading: '#1677ff',
  uploaded: '#13c2c2',
  submitting: '#722ed1'
}

function getPlatformName(platform: string): string {
  const info = PLATFORMS[platform as PlatformId]
  return info ? `${info.icon} ${info.displayName}` : platform
}

function getPlatformColor(platform: string): string {
  const info = PLATFORMS[platform as PlatformId]
  return info?.color || '#999'
}

export default function AnalyticsPage() {
  const { overview, compareResult, timeRange, loading, setTimeRange, fetchOverview, fetchCompare } = useAnalyticsStore()

  useEffect(() => {
    fetchOverview()
    fetchCompare()
  }, [fetchOverview, fetchCompare])

  const handleTimeRangeChange = (val: string | number) => {
    setTimeRange(val as TimeRange)
  }

  // Prepare daily trend data for line chart (flatten to multi-series)
  const trendData: { date: string; type: string; count: number }[] = []
  if (overview?.dailyTrends) {
    for (const d of overview.dailyTrends) {
      trendData.push({ date: d.date, type: '发布总数', count: d.total })
      trendData.push({ date: d.date, type: '成功', count: d.success })
      trendData.push({ date: d.date, type: '失败', count: d.failed })
    }
  }

  // Prepare platform data for column chart
  const platformBarData: { platform: string; type: string; count: number }[] = []
  if (overview?.platformStats) {
    for (const p of overview.platformStats) {
      platformBarData.push({ platform: getPlatformName(p.platform), type: '成功', count: p.success })
      platformBarData.push({ platform: getPlatformName(p.platform), type: '失败', count: p.failed })
      platformBarData.push({ platform: getPlatformName(p.platform), type: '待处理', count: p.pending })
    }
  }

  // Prepare status distribution for pie chart
  const pieData: { status: string; count: number }[] = []
  if (overview?.statusDistribution) {
    for (const s of overview.statusDistribution) {
      pieData.push({ status: STATUS_LABELS[s.status] || s.status, count: s.count })
    }
  }

  // Platform comparison table columns
  const compareColumns = [
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      render: (platform: string) => getPlatformName(platform)
    },
    {
      title: '总发布',
      dataIndex: 'total',
      key: 'total',
      sorter: (a: { total: number }, b: { total: number }) => a.total - b.total
    },
    {
      title: '成功',
      dataIndex: 'success',
      key: 'success',
      render: (v: number) => <span style={{ color: '#52c41a' }}>{v}</span>
    },
    {
      title: '失败',
      dataIndex: 'failed',
      key: 'failed',
      render: (v: number) => <span style={{ color: '#ff4d4f' }}>{v}</span>
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (v: number) => `${v}%`,
      sorter: (a: { successRate: number }, b: { successRate: number }) => a.successRate - b.successRate
    }
  ]

  const hasData = overview && overview.totalPublishes > 0

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>数据统计</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            查看各平台发布数据统计与跨平台对比分析
          </Paragraph>
        </div>
        <Segmented
          options={TIME_RANGE_OPTIONS}
          value={timeRange}
          onChange={handleTimeRangeChange}
        />
      </div>

      <Spin spinning={loading}>
        {/* Summary cards */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card hoverable>
              <Statistic
                title="总发布数"
                value={overview?.totalPublishes || 0}
                prefix={<SendOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card hoverable>
              <Statistic
                title="发布成功"
                value={overview?.successCount || 0}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card hoverable>
              <Statistic
                title="发布失败"
                value={overview?.failedCount || 0}
                prefix={<CloseCircleOutlined />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card hoverable>
              <Statistic
                title="成功率"
                value={overview?.successRate || 0}
                suffix="%"
                prefix={<BarChartOutlined />}
                valueStyle={{ color: overview && overview.successRate >= 80 ? '#52c41a' : '#faad14' }}
              />
            </Card>
          </Col>
        </Row>

        {!hasData ? (
          <Card>
            <Empty description="暂无发布数据，发布视频后即可查看统计" />
          </Card>
        ) : (
          <>
            {/* Charts row */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={16}>
                <Card title="发布趋势" styles={{ body: { padding: '12px 16px' } }}>
                  <Line
                    data={trendData}
                    xField="date"
                    yField="count"
                    colorField="type"
                    height={280}
                    point={{ size: 3 }}
                    axis={{
                      x: { label: { autoRotate: false } },
                      y: { title: '数量' }
                    }}
                    scale={{
                      color: {
                        domain: ['发布总数', '成功', '失败'],
                        range: ['#1677ff', '#52c41a', '#ff4d4f']
                      }
                    }}
                    legend={{ position: 'top' }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card title="状态分布" styles={{ body: { padding: '12px 16px' } }}>
                  <Pie
                    data={pieData}
                    angleField="count"
                    colorField="status"
                    height={280}
                    innerRadius={0.5}
                    legend={{ position: 'bottom' }}
                    scale={{
                      color: {
                        domain: pieData.map((d) => d.status),
                        range: pieData.map((d) => {
                          const key = Object.entries(STATUS_LABELS).find(([, v]) => v === d.status)?.[0]
                          return STATUS_COLORS[key || ''] || '#999'
                        })
                      }
                    }}
                    labels={[{ text: 'count', position: 'outside', style: { fontSize: 12 } }]}
                    style={{ stroke: '#fff', lineWidth: 2 }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Platform bar chart */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={24}>
                <Card title="平台发布统计" styles={{ body: { padding: '12px 16px' } }}>
                  <Column
                    data={platformBarData}
                    xField="platform"
                    yField="count"
                    colorField="type"
                    group={{ title: true }}
                    height={260}
                    scale={{
                      color: {
                        domain: ['成功', '失败', '待处理'],
                        range: ['#52c41a', '#ff4d4f', '#faad14']
                      }
                    }}
                    axis={{
                      y: { title: '数量' }
                    }}
                    legend={{ position: 'top' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Platform comparison table */}
            <Card title="跨平台对比" style={{ marginBottom: 24 }}>
              <Table
                dataSource={compareResult}
                columns={compareColumns}
                rowKey="platform"
                pagination={false}
                size="middle"
              />
            </Card>
          </>
        )}
      </Spin>
    </div>
  )
}
