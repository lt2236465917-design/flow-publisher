import { Typography } from 'antd'

const { Title, Paragraph } = Typography

export default function PublishRecordsPage() {
  return (
    <div>
      <Title level={3}>发布记录</Title>
      <Paragraph type="secondary">查看已发布和待发布的内容记录</Paragraph>
    </div>
  )
}
