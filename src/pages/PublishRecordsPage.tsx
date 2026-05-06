import { useEffect } from 'react'
import { Typography, Tabs, Table, Button, Space, Popconfirm, message } from 'antd'
import { DeleteOutlined, StopOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useRecordStore } from '@/stores/recordStore'
import { usePolling } from '@/hooks/usePolling'
import { useScheduleProgress } from '@/hooks/useScheduleProgress'
import PublishRecordTable from '@/components/records/PublishRecordTable'
import TaskStatusTag from '@/components/records/TaskStatusTag'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'

const { Title, Paragraph } = Typography

export default function PublishRecordsPage() {
  const { records, scheduledTasks, loading, fetchRecords, fetchScheduledTasks, cancelScheduledTask, deleteScheduledTask } = useRecordStore()

  useEffect(() => {
    fetchRecords()
    fetchScheduledTasks()
  }, [fetchRecords, fetchScheduledTasks])

  // Listen for schedule progress events
  useScheduleProgress()

  // Auto-refresh scheduled tasks every 30s
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
      width: 200,
      render: (platforms: string[]) => (
        <Space size={4}>
          {platforms.map((p) => {
            const info = PLATFORMS[p as PlatformId]
            return info ? (
              <span key={p} title={info.displayName}>{info.icon}</span>
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
      render: (t: string) => dayjs(t).format('YYYY年MM月DD日 HH:mm')
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => <TaskStatusTag status={status} />
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
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
      label: '已发布',
      children: <PublishRecordTable records={records} loading={loading} />
    },
    {
      key: 'scheduled',
      label: '定时任务',
      children: (
        <Table
          dataSource={scheduledTasks}
          columns={scheduledColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无定时任务' }}
          size="middle"
        />
      )
    }
  ]

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <Title level={3}>发布记录</Title>
      <Paragraph type="secondary">查看已发布和待发布的内容记录</Paragraph>
      <Tabs items={tabItems} defaultActiveKey="published" />
    </div>
  )
}
