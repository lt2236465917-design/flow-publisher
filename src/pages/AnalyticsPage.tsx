import { useEffect } from 'react'
import { Card, Row, Col, Statistic, Segmented, Table, Empty, Spin } from 'antd'
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
import type { TimeRange } from '../../shared/contracts/analytics.contract'

const TIME_RANGE_OPTIONS = [
  { label: '7天', value: '7d' },
  { label: '30天', value: '30d' },
  { label: '90天', value: '90d' },
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
  done: '#34c759',
  error: '#ff3b30',
  pending: '#ff9500',
  uploading: '#0071e3',
  uploaded: '#5ac8fa',
  submitting: '#af52de'
}

function getPlatformName(platform: string): string {
  const info = PLATFORMS[platform as PlatformId]
  return info ? `${info.icon} ${info.displayName}` : platform
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

  const trendData: { date: string; type: string; count: number }[] = []
  if (overview?.dailyTrends) {
    for (const d of overview.dailyTrends) {
      trendData.push({ date: d.date, type: '发布总数', count: d.total })
      trendData.push({ date: d.date, type: '成功', count: d.success })
      trendData.push({ date: d.date, type: '失败', count: d.failed })
    }
  }

  const platformBarData: { platform: string; type: string; count: number }[] = []
  if (overview?.platformStats) {
    for (const p of overview.platformStats) {
      platformBarData.push({ platform: getPlatformName(p.platform), type: '成功', count: p.success })
      platformBarData.push({ platform: getPlatformName(p.platform), type: '失败', count: p.failed })
      platformBarData.push({ platform: getPlatformName(p.platform), type: '待处理', count: p.pending })
    }
  }

  const pieData: { status: string; count: number }[] = []
  if (overview?.statusDistribution) {
    for (const s of overview.statusDistribution) {
      pieData.push({ status: STATUS_LABELS[s.status] || s.status, count: s.count })
    }
  }

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
      render: (v: number) => <span style={{ color: '#34c759', fontWeight: 600 }}>{v}</span>
    },
    {
      title: '失败',
      dataIndex: 'failed',
      key: 'failed',
      render: (v: number) => <span style={{ color: '#ff3b30', fontWeight: 600 }}>{v}</span>
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: v >= 80 ? '#34c759' : '#ff9500' }}>
          {v}%
        </span>
      ),
      sorter: (a: { successRate: number }, b: { successRate: number }) => a.successRate - b.successRate
    }
  ]

  const hasData = overview && overview.totalPublishes > 0

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
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
            各平台发布数据与跨平台对比分析
          </p>
        </div>
        <Segmented
          options={TIME_RANGE_OPTIONS}
          value={timeRange}
          onChange={handleTimeRangeChange}
        />
      </div>

      <Spin spinning={loading}>
        {/* Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <SummaryCard
            title="总发布"
            value={overview?.totalPublishes || 0}
            icon={<SendOutlined />}
            color="#0071e3"
          />
          <SummaryCard
            title="成功"
            value={overview?.successCount || 0}
            icon={<CheckCircleOutlined />}
            color="#34c759"
          />
          <SummaryCard
            title="失败"
            value={overview?.failedCount || 0}
            icon={<CloseCircleOutlined />}
            color="#ff3b30"
          />
          <SummaryCard
            title="成功率"
            value={overview?.successRate || 0}
            suffix="%"
            icon={<BarChartOutlined />}
            color={overview && overview.successRate >= 80 ? '#34c759' : '#ff9500'}
          />
        </div>

        {!hasData ? (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 14,
              border: '1px solid rgba(0, 0, 0, 0.06)',
              padding: '48px 0',
            }}
          >
            <Empty description="发布视频后即可查看统计数据" />
          </div>
        ) : (
          <>
            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
              <ChartCard title="发布趋势">
                <Line
                  data={trendData}
                  xField="date"
                  yField="count"
                  colorField="type"
                  height={260}
                  point={{ size: 3 }}
                  axis={{
                    x: { label: { autoRotate: false } },
                    y: { title: '数量' }
                  }}
                  scale={{
                    color: {
                      domain: ['发布总数', '成功', '失败'],
                      range: ['#0071e3', '#34c759', '#ff3b30']
                    }
                  }}
                  legend={{ position: 'top' }}
                />
              </ChartCard>
              <ChartCard title="状态分布">
                <Pie
                  data={pieData}
                  angleField="count"
                  colorField="status"
                  height={260}
                  innerRadius={0.55}
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
              </ChartCard>
            </div>

            {/* Platform Bar Chart */}
            <div style={{ marginBottom: 14 }}>
              <ChartCard title="平台发布统计">
                <Column
                  data={platformBarData}
                  xField="platform"
                  yField="count"
                  colorField="type"
                  group={{ title: true }}
                  height={240}
                  scale={{
                    color: {
                      domain: ['成功', '失败', '待处理'],
                      range: ['#34c759', '#ff3b30', '#ff9500']
                    }
                  }}
                  axis={{ y: { title: '数量' } }}
                  legend={{ position: 'top' }}
                />
              </ChartCard>
            </div>

            {/* Comparison Table */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: 14,
                border: '1px solid rgba(0, 0, 0, 0.06)',
                padding: 20,
              }}
            >
              <h3
                style={{
                  fontFamily: "'Sora', sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#1d1d1f',
                  marginBottom: 16,
                  letterSpacing: '-0.01em',
                }}
              >
                跨平台对比
              </h3>
              <Table
                dataSource={compareResult}
                columns={compareColumns}
                rowKey="platform"
                pagination={false}
                size="middle"
              />
            </div>
          </>
        )}
      </Spin>
    </div>
  )
}

function SummaryCard({ title, value, suffix, icon, color }: {
  title: string
  value: number
  suffix?: string
  icon: React.ReactNode
  color: string
}) {
  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderRadius: 16,
        border: '0.5px solid rgba(255, 255, 255, 0.85)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)',
        padding: '20px 22px',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#86868b',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 16, color, opacity: 0.7 }}>{icon}</span>
      </div>
      <div
        style={{
          fontFamily: "'Sora', sans-serif",
          fontSize: 30,
          fontWeight: 700,
          color: '#1d1d1f',
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        {value}
        {suffix && (
          <span style={{ fontSize: 16, fontWeight: 500, color: '#86868b', marginLeft: 2 }}>{suffix}</span>
        )}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid rgba(0, 0, 0, 0.06)',
        padding: 20,
      }}
    >
      <h3
        style={{
          fontFamily: "'Sora', sans-serif",
          fontSize: 14,
          fontWeight: 600,
          color: '#1d1d1f',
          marginBottom: 16,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}
