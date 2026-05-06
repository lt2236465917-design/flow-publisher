import { useState, useMemo } from 'react'
import { Table, Typography, Input, Space, Button } from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import TaskStatusTag from './TaskStatusTag'
import { PLATFORMS } from '@/constants/platforms'
import type { PublishRecord } from '@/types/publish.types'
import type { PlatformId } from '@/constants/platforms'

const { Link } = Typography

interface Props {
  records: PublishRecord[]
  loading: boolean
  onRefresh?: () => void
}

export default function PublishRecordTable({ records, loading, onRefresh }: Props) {
  const [searchText, setSearchText] = useState('')

  const filteredRecords = useMemo(() => {
    if (!searchText.trim()) return records
    const q = searchText.toLowerCase()
    return records.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.platform.toLowerCase().includes(q) ||
        (r.publishUrl && r.publishUrl.toLowerCase().includes(q))
    )
  }, [records, searchText])

  const columns = [
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 120,
      filters: Object.entries(PLATFORMS).map(([id, info]) => ({
        text: `${info.icon} ${info.displayName}`,
        value: id
      })),
      onFilter: (value: unknown, record: PublishRecord) => record.platform === value,
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
      filters: [
        { text: '成功', value: 'done' },
        { text: '失败', value: 'error' },
        { text: '上传中', value: 'uploading' },
        { text: '提交中', value: 'submitting' }
      ],
      onFilter: (value: unknown, record: PublishRecord) => record.status === value,
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
      sorter: (a: PublishRecord, b: PublishRecord) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix(),
      defaultSortOrder: 'descend' as const,
      render: (t: string) => dayjs(t).format('YYYY年MM月DD日 HH:mm:ss')
    }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索标题、平台、链接..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          style={{ width: 280 }}
        />
        {onRefresh && (
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>刷新</Button>
        )}
      </Space>
      <Table
        dataSource={filteredRecords}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 条记录`
        }}
        locale={{ emptyText: '暂无发布记录' }}
        size="middle"
        scroll={{ x: 800 }}
      />
    </div>
  )
}
