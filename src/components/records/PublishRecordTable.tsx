import { useState, useMemo } from 'react'
import { Table, Input, Button } from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import TaskStatusTag from './TaskStatusTag'
import { PLATFORMS } from '@/constants/platforms'
import type { PublishRecord } from '@/types/publish.types'
import type { PlatformId } from '@/constants/platforms'
import PlatformIcon from '@/components/common/PlatformIcon'

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
      width: 110,
      filters: Object.entries(PLATFORMS).map(([id, info]) => ({
        text: info.displayName,
        value: id
      })),
      onFilter: (value: unknown, record: PublishRecord) => record.platform === value,
      render: (platform: string) => {
        const info = PLATFORMS[platform as PlatformId]
        return info ? (
          <span style={{ fontSize: 13 }}>
            <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
              <PlatformIcon platformId={platform as PlatformId} size={13} radius={3} />
            </span>
            {info.displayName}
          </span>
        ) : platform
      }
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string) => (
        <span style={{ fontWeight: 500, color: '#1d1d1f' }}>{title}</span>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      filters: [
        { text: '成功', value: 'done' },
        { text: '待确认', value: 'unconfirmed' },
        { text: '失败', value: 'error' },
        { text: '上传中', value: 'uploading' },
        { text: '提交中', value: 'submitting' }
      ],
      onFilter: (value: unknown, record: PublishRecord) => record.status === value,
      render: (status: string) => <TaskStatusTag status={status} />
    },
    {
      title: '链接',
      dataIndex: 'publishUrl',
      key: 'publishUrl',
      width: 180,
      render: (url: string | null) =>
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#0071e3',
              fontSize: 12,
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            查看
          </a>
        ) : (
          <span style={{ color: '#d2d2d7' }}>—</span>
        )
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: (a: PublishRecord, b: PublishRecord) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix(),
      defaultSortOrder: 'descend' as const,
      render: (t: string) => (
        <span style={{ color: '#86868b', fontSize: 12 }}>
          {dayjs(t).format('MM月DD日 HH:mm')}
        </span>
      )
    }
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <Input
          placeholder="搜索标题、平台、链接..."
          prefix={<SearchOutlined style={{ color: '#aeaeb2' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          style={{ width: 280, borderRadius: 8 }}
        />
        {onRefresh && (
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新
          </Button>
        )}
      </div>
      <Table
        dataSource={filteredRecords}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 条`
        }}
        locale={{ emptyText: '暂无发布记录' }}
        size="middle"
        scroll={{ x: 700 }}
      />
    </div>
  )
}
