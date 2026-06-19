import { Checkbox, Space } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import PlatformIcon from '@/components/common/PlatformIcon'
import { useAccountStore } from '@/stores/accountStore'

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
      <div
        style={{
          padding: 20,
          textAlign: 'center',
          background: '#fafafa',
          borderRadius: 10,
          fontSize: 13,
          color: '#86868b',
        }}
      >
        暂无已登录的平台账号，请先到账号管理页面登录
      </div>
    )
  }

  return (
    <div>
      <Checkbox.Group value={value} onChange={handleChange as (v: string[]) => void}>
        <Space size={16} wrap>
          {availablePlatforms.map((platformId) => {
            const info = PLATFORMS[platformId]
            const account = loggedInPlatforms.find((a) => a.platform === platformId)
            return (
              <div
                key={platformId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: value.includes(platformId) ? '1px solid rgba(0, 113, 227, 0.2)' : '1px solid rgba(0, 0, 0, 0.06)',
                  background: value.includes(platformId) ? 'rgba(0, 113, 227, 0.04)' : '#fafafa',
                  transition: 'all 0.2s ease',
                }}
              >
                <Checkbox value={platformId}>
                  <Space size={6}>
                    <PlatformIcon platformId={platformId} size={22} radius={6} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>{info.displayName}</span>
                    {account && (
                      <span style={{ fontSize: 11, color: '#86868b' }}>
                        {account.displayName}
                      </span>
                    )}
                  </Space>
                </Checkbox>
              </div>
            )
          })}
        </Space>
      </Checkbox.Group>
    </div>
  )
}
