import { Checkbox, Avatar, Typography, Tag, Space } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import { useAccountStore } from '@/stores/accountStore'

const { Text } = Typography

interface Props {
  value: PlatformId[]
  onChange: (platforms: PlatformId[]) => void
}

export default function PublishTargetPicker({ value, onChange }: Props) {
  const { accounts } = useAccountStore()

  const loggedInPlatforms = accounts.filter((a) => a.sessionStatus === 'logged_in')
  const availablePlatforms = loggedInPlatforms.map((a) => a.platform as PlatformId)

  const handleChange = (checkedValues: PlatformId[]) => {
    onChange(checkedValues)
  }

  if (availablePlatforms.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Text type="secondary">暂无已登录的平台账号，请先到账号管理页面登录</Text>
      </div>
    )
  }

  return (
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>发布平台</Text>
      <Checkbox.Group value={value} onChange={handleChange as (v: string[]) => void}>
        <Space direction="vertical" size={8}>
          {availablePlatforms.map((platformId) => {
            const info = PLATFORMS[platformId]
            const account = loggedInPlatforms.find((a) => a.platform === platformId)
            return (
              <Checkbox key={platformId} value={platformId}>
                <Space size={8}>
                  <Avatar size={20} style={{ background: info.color, fontSize: 12 }}>
                    {info.icon}
                  </Avatar>
                  <Text>{info.displayName}</Text>
                  {account && (
                    <Tag color="green" style={{ marginLeft: 4 }}>
                      {account.displayName}
                    </Tag>
                  )}
                </Space>
              </Checkbox>
            )
          })}
        </Space>
      </Checkbox.Group>
    </div>
  )
}
