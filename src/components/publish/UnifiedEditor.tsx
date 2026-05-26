import { Form, Input } from 'antd'
import HashtagInput from './HashtagInput'
import DeclarationPicker from './DeclarationPicker'
import type { PublishFormData } from '@/types/publish.types'

const { TextArea } = Input

interface Props {
  form: PublishFormData
  onChange: (patch: Partial<PublishFormData>) => void
  platforms?: string[]
}

export default function UnifiedEditor({ form, onChange, platforms }: Props) {
  const needsMinTitle = platforms?.includes('wechat-channels')
  const titleLen = form.title.trim().length
  const titleTooShort = needsMinTitle && titleLen > 0 && titleLen < 6

  return (
    <Form layout="vertical" style={{ maxWidth: '100%' }} size="small">
      <Form.Item
        label="标题"
        required
        validateStatus={titleTooShort ? 'error' : undefined}
        help={titleTooShort ? '视频号标题至少需要6个字' : needsMinTitle ? '视频号要求标题不少于6个字' : undefined}
        style={{ marginBottom: 10 }}
      >
        <Input
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="输入视频标题"
          maxLength={100}
          showCount
        />
      </Form.Item>

      <Form.Item label="描述" style={{ marginBottom: 10 }}>
        <TextArea
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="输入视频描述..."
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={2000}
          showCount
        />
      </Form.Item>

      <Form.Item label="话题标签" style={{ marginBottom: 10 }}>
        <HashtagInput
          value={form.hashtags}
          onChange={(hashtags) => onChange({ hashtags })}
        />
      </Form.Item>

      <Form.Item label="" style={{ marginBottom: 0 }}>
        <DeclarationPicker
          value={form.declarations}
          onChange={(declarations) => onChange({ declarations })}
        />
      </Form.Item>
    </Form>
  )
}
