import { LoginOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import type { AccountInfo } from '@/types/platform.types'
import PlatformIcon from '@/components/common/PlatformIcon'
import SessionStatusBadge from './SessionStatusBadge'

interface Props {
  platformId: PlatformId
  account?: AccountInfo
  onLogin: (platformId: PlatformId) => void
}

export default function PlatformCard({ platformId, account, onLogin }: Props) {
  const platform = PLATFORMS[platformId]
  const isLoggedIn = account?.sessionStatus === 'logged_in'
  const isExpired = account?.sessionStatus === 'expired'

  // 根据状态显示不同的描述文字
  const getStatusDescription = () => {
    if (isLoggedIn) return account?.displayName || '已登录'
    if (isExpired) return '登录已过期，请重新登录'
    return '点击登录'
  }

  // 根据状态显示不同的按钮
  const getButtonConfig = () => {
    if (isLoggedIn) {
      return {
        icon: <ReloadOutlined />,
        label: '重新登录',
        primary: false,
        secondary: true,
      }
    }
    if (isExpired) {
      return {
        icon: <WarningOutlined />,
        label: '重新登录',
        primary: true,
        secondary: false,
      }
    }
    return {
      icon: <LoginOutlined />,
      label: '登录',
      primary: true,
      secondary: false,
    }
  }

  const buttonConfig = getButtonConfig()

  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderRadius: 16,
        border: isExpired ? '1px solid rgba(255, 59, 48, 0.2)' : '0.5px solid rgba(255, 255, 255, 0.85)',
        padding: '24px 22px',
        boxShadow: isExpired
          ? '0 2px 8px rgba(255, 59, 48, 0.05), 0 12px 40px rgba(255, 59, 48, 0.05)'
          : '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)',
        transition: 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = isExpired
          ? '0 4px 16px rgba(255, 59, 48, 0.08), 0 20px 56px rgba(255, 59, 48, 0.08)'
          : '0 4px 16px rgba(0, 0, 0, 0.03), 0 20px 56px rgba(0, 0, 0, 0.03)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = isExpired ? 'rgba(255, 59, 48, 0.3)' : 'rgba(255, 255, 255, 0.92)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = isExpired
          ? '0 2px 8px rgba(255, 59, 48, 0.05), 0 12px 40px rgba(255, 59, 48, 0.05)'
          : '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = isExpired ? 'rgba(255, 59, 48, 0.2)' : 'rgba(255, 255, 255, 0.85)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <PlatformIcon platformId={platformId} size={44} radius={12} />
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
          <span style={{ fontSize: 12, color: isExpired ? '#ff3b30' : '#86868b' }}>
            {getStatusDescription()}
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
        <ActionButton
          icon={buttonConfig.icon}
          label={buttonConfig.label}
          onClick={() => onLogin(platformId)}
          primary={buttonConfig.primary}
          secondary={buttonConfig.secondary}
        />
      </div>
    </div>
  )
}

function ActionButton({ icon, label, onClick, primary, secondary, danger }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  primary?: boolean
  secondary?: boolean
  danger?: boolean
}) {
  const getBg = () => {
    if (primary) return '#34c759'  // 绿色
    if (secondary) return '#0071e3'  // 蓝色
    return 'transparent'
  }

  const getHoverBg = () => {
    if (primary) return '#30d158'
    if (secondary) return '#0077ed'
    return 'rgba(0, 0, 0, 0.03)'
  }

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
        border: (primary || secondary) ? 'none' : '1px solid rgba(0, 0, 0, 0.08)',
        background: getBg(),
        color: (primary || secondary) ? '#fff' : danger ? '#ff3b30' : '#86868b',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        fontFamily: "'DM Sans', sans-serif",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = getHoverBg()
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = getBg()
      }}
    >
      {icon}
      {label}
    </button>
  )
}
