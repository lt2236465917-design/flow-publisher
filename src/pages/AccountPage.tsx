import { Typography } from 'antd'

const { Title, Paragraph } = Typography

export default function AccountPage() {
  return (
    <div>
      <Title level={3}>账号管理</Title>
      <Paragraph type="secondary">管理各平台登录账号（抖音、小红书、视频号、快手）</Paragraph>
    </div>
  )
}
