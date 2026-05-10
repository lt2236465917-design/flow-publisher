import { useEffect } from 'react'
import { Tabs, Table, Button, Space, Popconfirm, message } from 'antd'
import { DeleteOutlined, StopOutlined, FileTextOutlined, ClockCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useRecordStore } from '@/stores/recordStore'
import { usePolling } from '@/hooks/usePolling'
import { useScheduleProgress } from '@/hooks/useScheduleProgress'
import PublishRecordTable from '@/components/records/PublishRecordTable'
import TaskStatusTag from '@/components/records/TaskStatusTag'
import EmptyState from '@/components/common/EmptyState'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'

export default function PublishRecordsPage() {
  const { records, scheduledTasks, loading, fetchRecords, fetchScheduledTasks, cancelScheduledTask, deleteScheduledTask } = useRecordStore()

  useEffect(() => {
    fetchRecords()
    fetchScheduledTasks()
  }, [fetchRecords, fetchScheduledTasks])

  useScheduleProgress()
  usePolling(fetchScheduledTasks, 30000, true)

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
              <span key={p} title={info.displayName} style={{ fontSize: 16 }}>{info.icon}</span>
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

  const tabItems = [
    {
      key: 'published',
      label: `已发布`,
      children: records.length === 0 && !loading ? (
        <EmptyState
          icon={<FileTextOutlined />}
          title="暂无发布记录"
          description="发布视频后，记录将显示在这里"
        />
      ) : (
        <PublishRecordTable records={records} loading={loading} onRefresh={fetchRecords} />
      )
    },
    {
      key: 'scheduled',
      label: `定时任务`,
      children: scheduledTasks.length === 0 && !loading ? (
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
          loading={loading}
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
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
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
          发布记录
        </h1>
        <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>
          查看已发布和待发布的内容记录
        </p>
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          padding: '20px 24px',
        }}
      >
        <Tabs items={tabItems} defaultActiveKey="published" />
      </div>
    </div>
  )
}
