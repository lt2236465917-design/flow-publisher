import { Layout } from 'antd'
import { Outlet } from 'react-router-dom'
import AppSidebar from '@/components/common/AppSidebar'

const { Content } = Layout

export default function MainLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <AppSidebar />
      <Layout>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
