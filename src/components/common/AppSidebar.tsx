import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Tooltip } from 'antd'
import {
  UserOutlined,
  SendOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useUIStore } from '@/stores/uiStore'

const menuItems = [
  { key: '/account', icon: <UserOutlined />, label: '账号' },
  { key: '/publish', icon: <SendOutlined />, label: '发布' },
  { key: '/records', icon: <UnorderedListOutlined />, label: '记录' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '统计' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' }
]

export default function AppSidebar() {
  const [appVersion, setAppVersion] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const networkOnline = useUIStore((s) => s.networkOnline)

  useEffect(() => {
    window.electron.ipcRenderer.invoke<{ version: string }>('app:get-version').then((res) => {
      if (res.success && res.data) setAppVersion(res.data.version)
    }).catch(() => {})
  }, [])

  return (
    <div
      style={{
        width: 72,
        height: '100vh',
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderRight: '0.5px solid rgba(255, 255, 255, 0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* App Icon / Logo */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'linear-gradient(135deg, #2997ff 0%, #0071e3 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 28,
          boxShadow: '0 4px 12px rgba(41, 151, 255, 0.3)',
          cursor: 'default',
        }}
      >
        <span
          style={{
            fontFamily: "'Sora', sans-serif",
            fontWeight: 700,
            fontSize: 18,
            color: '#ffffff',
            letterSpacing: '-0.03em',
          }}
        >
          F
        </span>
      </div>

      {/* Navigation Items */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, width: '100%', padding: '0 10px' }}>
        {menuItems.map((item) => {
          const isActive = location.pathname === item.key
          return (
            <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.3}>
              <div
                onClick={() => navigate(item.key)}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  background: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  position: 'relative',
                  margin: '0 auto',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                {/* Active indicator */}
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      left: -10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: 20,
                      borderRadius: '0 3px 3px 0',
                      background: '#2997ff',
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 20,
                    color: isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.55)',
                    transition: 'color 0.2s ease',
                    lineHeight: 1,
                  }}
                >
                  {item.icon}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.45)',
                    letterSpacing: '0.02em',
                    transition: 'color 0.2s ease',
                    lineHeight: 1,
                  }}
                >
                  {item.label}
                </span>
              </div>
            </Tooltip>
          )
        })}
      </div>

      {/* Bottom Status */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '12px 0',
        }}
      >
        {/* Network indicator */}
        <Tooltip title={networkOnline ? '网络正常' : '网络断开'} placement="right">
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: networkOnline ? '#34c759' : '#ff3b30',
              boxShadow: networkOnline
                ? '0 0 6px rgba(52, 199, 89, 0.4)'
                : '0 0 6px rgba(255, 59, 48, 0.4)',
              transition: 'all 0.3s ease',
            }}
          />
        </Tooltip>

        {/* Version */}
        {appVersion && (
          <span
            style={{
              fontSize: 9,
              color: 'rgba(255, 255, 255, 0.2)',
              letterSpacing: '0.05em',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {appVersion}
          </span>
        )}
      </div>
    </div>
  )
}
