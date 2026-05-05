import { Typography } from 'antd'

const { Title, Paragraph } = Typography

export default function AnalyticsPage() {
  return (
    <div>
      <Title level={3}>数据统计</Title>
      <Paragraph type="secondary">查看各平台播放、互动、粉丝数据及跨平台对比</Paragraph>
    </div>
  )
}
