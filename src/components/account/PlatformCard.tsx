import { Avatar } from 'antd'
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
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderRadius: 16,
        border: '0.5px solid rgba(255, 255, 255, 0.85)',
        padding: '24px 22px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)',
        transition: 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        cursor: isLoggedIn ? 'default' : 'pointer',
      }}
      onClick={!isLoggedIn ? () => onLogin(platformId) : undefined}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.03), 0 20px 56px rgba(0, 0, 0, 0.03)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.92)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.85)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <Avatar
          size={44}
          style={{
            background: platform.color,
            fontSize: 20,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
          src={platform.iconUrl}
        >
          {platform.icon}
        </Avatar>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span
              style={{
                fontFamily: "'Sora', sans-serif",
                fontSize: 15,
                fontWeight: 600,
                color: '#1d1d1f',
                letterSpacing: '-0.01em',
              }}
            >
              {platform.displayName}
            </span>
            <SessionStatusBadge status={account?.sessionStatus ?? 'not_logged_in'} />
          </div>
          <span style={{ fontSize: 12, color: '#86868b' }}>
            {isLoggedIn ? account?.displayName || '已登录' : '点击登录'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          paddingTop: 14,
          borderTop: '1px solid rgba(0, 0, 0, 0.04)',
        }}
      >
        {isLoggedIn ? (
          <>
            <ActionButton icon={<ReloadOutlined />} label="检查" onClick={() => onCheckSession(account!.id)} />
            <ActionButton icon={<LogoutOutlined />} label="退出" onClick={() => onLogout(account!.id)} danger />
          </>
        ) : (
          <ActionButton icon={<LoginOutlined />} label="登录" onClick={() => onLogin(platformId)} primary />
        )}
      </div>
    </div>
  )
}

function ActionButton({ icon, label, onClick, primary, danger }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  primary?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '8px 0',
        borderRadius: 8,
        border: primary ? 'none' : '1px solid rgba(0, 0, 0, 0.08)',
        background: primary ? '#0071e3' : 'transparent',
        color: primary ? '#fff' : danger ? '#ff3b30' : '#86868b',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        fontFamily: "'DM Sans', sans-serif",
      }}
      onMouseEnter={(e) => {
        if (primary) {
          e.currentTarget.style.background = '#0077ed'
        } else {
          e.currentTarget.style.background = 'rgba(0, 0, 0, 0.03)'
        }
      }}
      onMouseLeave={(e) => {
        if (primary) {
          e.currentTarget.style.background = '#0071e3'
        } else {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      {icon}
      {label}
    </button>
  )
}
