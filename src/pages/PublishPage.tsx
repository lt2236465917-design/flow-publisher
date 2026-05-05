import { Typography } from 'antd'

const { Title, Paragraph } = Typography

export default function PublishPage() {
  return (
    <div>
      <Title level={3}>内容发布</Title>
      <Paragraph type="secondary">上传视频，编辑内容，一键发布到多个平台</Paragraph>
    </div>
  )
}
