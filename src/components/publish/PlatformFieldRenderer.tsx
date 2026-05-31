import { Input, Select, Checkbox, Form } from 'antd'
import type { PlatformFieldDefinition } from '@shared/types/platform-fields'
import type { PlatformId } from '@/constants/platforms'
import HashtagInput from './HashtagInput'
import LocationSearch from './LocationSearch'

const { TextArea } = Input
const { Group: CheckboxGroup } = Checkbox

interface LocationValue {
  id: string
  name: string
  address?: string
  lat?: number
  lng?: number
  poi_id?: string
  extra?: Record<string, unknown>
}

interface Props {
  field: PlatformFieldDefinition
  value: unknown
  onChange: (name: string, value: unknown) => void
  platformId?: PlatformId
  accountId?: string
}

export default function PlatformFieldRenderer({ field, value, onChange, platformId, accountId }: Props) {
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
      case 'dynamic-select':
        return (
          <Select
            value={value as string ?? field.defaultValue ?? undefined}
            onChange={(v) => onChange(field.name, v)}
            placeholder={field.placeholder}
            style={{ width: '100%' }}
            allowClear
            notFoundContent={field.type === 'dynamic-select' ? (accountId ? '加载中...' : '请先登录平台账号') : '暂无选项'}
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

      case 'checkbox-group': {
        const currentValues = Array.isArray(value) ? (value as string[]) : []
        const handleChange = (checkedValues: string[]) => {
          if (field.maxSelections === 1) {
            // Radio-like: only keep the last checked item
            const last = checkedValues.filter((v) => !currentValues.includes(v))
            onChange(field.name, last.length > 0 ? [last[last.length - 1]] : [])
          } else {
            onChange(field.name, checkedValues)
          }
        }
        return (
          <CheckboxGroup
            value={currentValues}
            onChange={handleChange}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
              {(field.options ?? []).map((opt: { label: string; value: string }) => (
                <Checkbox key={opt.value} value={opt.value} style={{ fontSize: 13 }}>
                  {opt.label}
                </Checkbox>
              ))}
            </div>
          </CheckboxGroup>
        )
      }

      case 'tags':
        return (
          <HashtagInput
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(tags) => onChange(field.name, tags)}
          />
        )

      case 'location':
        if (!platformId || !accountId) {
          return <Input value="请先登录平台账号" disabled />
        }
        return (
          <LocationSearch
            value={(value as LocationValue) ?? null}
            onChange={(loc) => onChange(field.name, loc)}
            platformId={platformId}
            accountId={accountId}
            placeholder={field.placeholder || '搜索地点'}
          />
        )

      default:
        return null
    }
  }

  // Checkbox renders its own label, so skip the Form.Item label
  if (field.type === 'checkbox') {
    return (
      <Form.Item style={{ marginBottom: 8 }}>
        {renderField()}
      </Form.Item>
    )
  }

  return (
    <Form.Item label={field.label} required={field.required} style={{ marginBottom: 8 }}>
      {renderField()}
    </Form.Item>
  )
}
