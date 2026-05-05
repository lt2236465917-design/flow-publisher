import { Typography } from 'antd'

const { Title, Paragraph } = Typography

export default function SettingsPage() {
  return (
    <div>
      <Title level={3}>设置</Title>
      <Paragraph type="secondary">FFmpeg 路径、代理配置、数据目录、日志级别等</Paragraph>
    </div>
  )
}
