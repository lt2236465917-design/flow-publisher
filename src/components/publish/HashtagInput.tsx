import { useState, useRef } from 'react'
import { Tag, Input, Tooltip, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  maxTags?: number
  maxTagLength?: number
}

export default function HashtagInput({
  value,
  onChange,
  maxTags = 10,
  maxTagLength = 30,
}: Props) {
  const [inputVisible, setInputVisible] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClose = (removedTag: string) => {
    onChange(value.filter((t) => t !== removedTag))
  }

  const showInput = () => {
    setInputVisible(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleInputConfirm = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) {
      setInputVisible(false)
      setInputValue('')
      return
    }

    if (value.includes(trimmed)) {
      message.warning('标签已存在')
      setInputVisible(false)
      setInputValue('')
      return
    }

    if (trimmed.length > maxTagLength) {
      message.warning(`标签不能超过${maxTagLength}个字`)
      setInputVisible(false)
      setInputValue('')
      return
    }

    if (value.length >= maxTags) {
      message.warning(`最多添加${maxTags}个标签`)
      setInputVisible(false)
      setInputValue('')
      return
    }

    onChange([...value, trimmed])
    setInputVisible(false)
    setInputValue('')
  }

  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
    >
      {value.map((tag) => (
        <Tag
          key={tag}
          closable
          onClose={() => handleClose(tag)}
          style={{
            fontSize: 13,
            background: 'rgba(0, 113, 227, 0.06)',
            color: '#0071e3',
            borderRadius: 6,
            padding: '2px 8px',
            border: 'none',
          }}
        >
          #{tag}
        </Tag>
      ))}
      {inputVisible ? (
        <Input
          ref={inputRef as never}
          size="small"
          style={{ width: 120, borderRadius: 6 }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputConfirm}
          onPressEnter={handleInputConfirm}
          placeholder="输入标签"
          maxLength={maxTagLength}
          showCount={false}
        />
      ) : value.length < maxTags ? (
        <Tooltip title={`最多 ${maxTags} 个标签`}>
          <Tag
            onClick={showInput}
            style={{
              borderStyle: 'dashed',
              cursor: 'pointer',
              borderRadius: 6,
              background: 'transparent',
              color: '#86868b',
            }}
          >
            <PlusOutlined /> 添加标签
          </Tag>
        </Tooltip>
      ) : null}
    </div>
  )
}
