import { useMemo } from 'react'
import { Form, Input } from 'antd'
import HashtagInput from './HashtagInput'
import {
  getMergedLimits,
  validateTitle,
  validateDescription,
  validateHashtags,
} from '@/constants/platform-limits'
import type { PublishFormData } from '@/types/publish.types'

const { TextArea } = Input

interface Props {
  form: PublishFormData
  onChange: (patch: Partial<PublishFormData>) => void
  platforms?: string[]
}

export default function UnifiedEditor({ form, onChange, platforms }: Props) {
  const activePlatforms = platforms || []

  // 获取合并后的平台限制（自动调整输入框最大字数）
  const limits = useMemo(
    () => getMergedLimits(activePlatforms),
    [activePlatforms]
  )

  // 验证标题（仅在有内容且超出限制时显示错误）
  const titleValidation = useMemo(
    () => validateTitle(form.title, activePlatforms),
    [form.title, activePlatforms]
  )

  // 验证描述（仅在有内容且超出限制时显示错误）
  const descValidation = useMemo(
    () => validateDescription(form.description, activePlatforms),
    [form.description, activePlatforms]
  )

  // 验证话题标签（仅在有内容且超出限制时显示错误）
  const hashtagValidation = useMemo(
    () => validateHashtags(form.hashtags, activePlatforms),
    [form.hashtags, activePlatforms]
  )

  // 标题帮助信息：仅在超出限制时显示
  const titleHelp = useMemo(() => {
    if (form.title.trim().length > 0 && !titleValidation.valid) {
      return titleValidation.message
    }
    return undefined
  }, [form.title, titleValidation])

  // 描述帮助信息：仅在超出限制时显示
  const descHelp = useMemo(() => {
    if (form.description.trim().length > 0 && !descValidation.valid) {
      return descValidation.message
    }
    return undefined
  }, [form.description, descValidation])

  // 话题标签帮助信息：仅在超出限制时显示
  const hashtagHelp = useMemo(() => {
    if (form.hashtags.length > 0 && !hashtagValidation.valid) {
      return hashtagValidation.message
    }
    return undefined
  }, [form.hashtags, hashtagValidation])

  return (
    <Form layout="vertical" style={{ maxWidth: '100%' }} size="small">
      <Form.Item
        label="标题"
        required
        validateStatus={
          form.title.trim().length > 0 && !titleValidation.valid
            ? 'error'
            : undefined
        }
        help={titleHelp}
        style={{ marginBottom: 10 }}
      >
        <Input
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="输入视频标题"
          maxLength={limits.titleMaxLength}
          showCount
          style={{ border: '1px solid #d9d9d9', borderRadius: 8 }}
        />
      </Form.Item>

      <Form.Item
        label="描述"
        validateStatus={
          form.description.trim().length > 0 && !descValidation.valid
            ? 'error'
            : undefined
        }
        help={descHelp}
        style={{ marginBottom: 10 }}
      >
        <TextArea
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="输入视频描述..."
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={limits.descriptionMaxLength}
          showCount
          style={{ border: '1px solid #d9d9d9', borderRadius: 8 }}
        />
      </Form.Item>

      <Form.Item
        label="话题标签"
        validateStatus={
          form.hashtags.length > 0 && !hashtagValidation.valid
            ? 'error'
            : undefined
        }
        help={hashtagHelp}
        style={{ marginBottom: 0 }}
      >
        <HashtagInput
          value={form.hashtags}
          onChange={(hashtags) => onChange({ hashtags })}
          maxTags={limits.hashtagMaxCount}
          maxTagLength={limits.hashtagMaxLength}
        />
      </Form.Item>
    </Form>
  )
}
