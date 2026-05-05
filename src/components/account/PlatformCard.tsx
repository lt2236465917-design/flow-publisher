import { Card, Avatar, Space } from 'antd'
import { LoginOutlined, LogoutOutlined, ReloadOutlined } from '@ant-design/icons'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import type { AccountInfo } from '@/types/platform.types'
import SessionStatusBadge from './SessionStatusBadge'

interface Props {
  platformId: PlatformId
  account?: AccountInfo
  onLogin: (platformId: PlatformId) => void
  onLogout: (accountId: string) => void
  onCheckSession: (accountId: string) => void
}

export default function PlatformCard({ platformId, account, onLogin, onLogout, onCheckSession }: Props) {
  const platform = PLATFORMS[platformId]
  const isLoggedIn = account?.sessionStatus === 'logged_in'

  return (
    <Card
      hoverable
      style={{ width: 280 }}
      actions={
        isLoggedIn
          ? [
              <ReloadOutlined key="refresh" onClick={() => onCheckSession(account!.id)} />,
              <LogoutOutlined key="logout" onClick={() => onLogout(account!.id)} />
            ]
          : [
              <LoginOutlined key="login" onClick={() => onLogin(platformId)} />
            ]
      }
    >
      <Card.Meta
        avatar={
          account?.avatarUrl ? (
            <Avatar src={account.avatarUrl} size={48} />
          ) : (
            <Avatar size={48} style={{ backgroundColor: platform.color, fontSize: 24 }}>
              {platform.icon}
            </Avatar>
          )
        }
        title={
          <Space>
            <span>{platform.displayName}</span>
            <SessionStatusBadge status={account?.sessionStatus ?? 'not_logged_in'} />
          </Space>
        }
        description={isLoggedIn ? account?.displayName || '已登录' : '点击登录'}
      />
    </Card>
  )
}
