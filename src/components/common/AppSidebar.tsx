import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Badge, Tooltip, Typography } from 'antd'
import {
  UserOutlined,
  SendOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
  SettingOutlined,
  WifiOutlined,
  DisconnectOutlined
} from '@ant-design/icons'
import { useUIStore } from '@/stores/uiStore'

const { Sider } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/account', icon: <UserOutlined />, label: '账号管理' },
  { key: '/publish', icon: <SendOutlined />, label: '内容发布' },
  { key: '/records', icon: <UnorderedListOutlined />, label: '发布记录' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '数据统计' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' }
]

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false)
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
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      style={{ background: '#fff', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          height: 48,
          margin: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: collapsed ? 16 : 18,
          color: '#1677ff',
          whiteSpace: 'nowrap',
          overflow: 'hidden'
        }}
      >
        {collapsed ? 'VS' : 'VideoSync'}
      </div>

      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ flex: 1 }}
      />

      {/* Bottom status area */}
      <div style={{ padding: collapsed ? '12px 0' : '12px 16px', textAlign: 'center', borderTop: '1px solid #f0f0f0' }}>
        <Tooltip title={networkOnline ? '网络连接正常' : '网络连接断开'}>
          <Badge status={networkOnline ? 'success' : 'error'}>
            {networkOnline ? (
              <WifiOutlined style={{ color: '#52c41a', fontSize: 16 }} />
            ) : (
              <DisconnectOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
            )}
          </Badge>
        </Tooltip>
        {!collapsed && appVersion && (
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>v{appVersion}</Text>
          </div>
        )}
      </div>
    </Sider>
  )
}
