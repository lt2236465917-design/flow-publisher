import { Input, Select, Checkbox, Form } from 'antd'
import type { PlatformFieldDefinition } from '@shared/types/platform-fields'
import HashtagInput from './HashtagInput'

const { TextArea } = Input

interface Props {
  field: PlatformFieldDefinition
  value: unknown
  onChange: (name: string, value: unknown) => void
}

export default function PlatformFieldRenderer({ field, value, onChange }: Props) {
  const renderField = () => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            value={value as string ?? ''}
            onChange={(e) => onChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
          />
        )

      case 'textarea':
        return (
          <TextArea
            value={value as string ?? ''}
            onChange={(e) => onChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            autoSize={{ minRows: 2, maxRows: 6 }}
          />
        )

      case 'select':
        return (
          <Select
            value={value as string ?? field.defaultValue ?? undefined}
            onChange={(v) => onChange(field.name, v)}
            placeholder={field.placeholder}
            style={{ width: '100%' }}
            allowClear
          >
            {(field.options ?? []).map((opt: { label: string; value: string }) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>
        )

      case 'checkbox':
        return (
          <Checkbox
            checked={value as boolean ?? (field.defaultValue as boolean) ?? false}
            onChange={(e) => onChange(field.name, e.target.checked)}
          >
            {field.label}
          </Checkbox>
        )

      case 'tags':
        return (
          <HashtagInput
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(tags) => onChange(field.name, tags)}
          />
        )

      default:
        return null
    }
  }

  // Checkbox renders its own label, so skip the Form.Item label
  if (field.type === 'checkbox') {
    return (
      <Form.Item>
        {renderField()}
      </Form.Item>
    )
  }

  return (
    <Form.Item label={field.label} required={field.required}>
      {renderField()}
    </Form.Item>
  )
}
