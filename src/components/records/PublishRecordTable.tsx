import { Table, Typography } from 'antd'
import dayjs from 'dayjs'
import TaskStatusTag from './TaskStatusTag'
import { PLATFORMS } from '@/constants/platforms'
import type { PublishRecord } from '@/types/publish.types'
import type { PlatformId } from '@/constants/platforms'

const { Link } = Typography

interface Props {
  records: PublishRecord[]
  loading: boolean
}

export default function PublishRecordTable({ records, loading }: Props) {
  const columns = [
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 120,
      render: (platform: string) => {
        const info = PLATFORMS[platform as PlatformId]
        return info ? `${info.icon} ${info.displayName}` : platform
      }
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => <TaskStatusTag status={status} />
    },
    {
      title: '发布链接',
      dataIndex: 'publishUrl',
      key: 'publishUrl',
      width: 200,
      render: (url: string | null) =>
        url ? <Link href={url} target="_blank" ellipsis>{url}</Link> : '-'
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (t: string) => dayjs(t).format('YYYY年MM月DD日 HH:mm:ss')
    }
  ]

  return (
    <Table
      dataSource={records}
      columns={columns}
      rowKey="id"
      loading={loading}
      pagination={{ pageSize: 10 }}
      locale={{ emptyText: '暂无发布记录' }}
      size="middle"
    />
  )
}
