import { Form, Input, Typography } from 'antd'
import HashtagInput from './HashtagInput'
import DeclarationPicker from './DeclarationPicker'
import type { PublishFormData } from '@/types/publish.types'

const { TextArea } = Input
const { Text } = Typography

interface Props {
  form: PublishFormData
  onChange: (patch: Partial<PublishFormData>) => void
}

export default function UnifiedEditor({ form, onChange }: Props) {
  return (
    <Form layout="vertical" style={{ maxWidth: '100%' }}>
      <Form.Item
        label="标题"
        required
        rules={[{ required: true, message: '请输入标题' }]}
      >
        <Input
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="输入视频标题"
          maxLength={100}
          showCount
        />
      </Form.Item>

      <Form.Item label="描述">
        <TextArea
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="输入视频描述..."
          autoSize={{ minRows: 3, maxRows: 8 }}
          maxLength={2000}
          showCount
        />
      </Form.Item>

      <Form.Item label="话题标签">
        <HashtagInput
          value={form.hashtags}
          onChange={(hashtags) => onChange({ hashtags })}
        />
      </Form.Item>

      <Form.Item label="声明">
        <DeclarationPicker
          value={form.declarations}
          onChange={(declarations) => onChange({ declarations })}
        />
      </Form.Item>
    </Form>
  )
}
