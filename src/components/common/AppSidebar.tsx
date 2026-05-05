import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import {
  UserOutlined,
  SendOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
  SettingOutlined
} from '@ant-design/icons'

const { Sider } = Layout

const menuItems = [
  { key: '/account', icon: <UserOutlined />, label: '账号管理' },
  { key: '/publish', icon: <SendOutlined />, label: '内容发布' },
  { key: '/records', icon: <UnorderedListOutlined />, label: '发布记录' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '数据统计' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' }
]

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      style={{ background: '#fff' }}
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
      />
    </Sider>
  )
}
