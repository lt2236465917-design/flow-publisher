import { useState, useRef } from 'react'
import { Tag, Input, Tooltip } from 'antd'
import { PlusOutlined } from '@ant-design/icons'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  maxTags?: number
}

export default function HashtagInput({ value, onChange, maxTags = 10 }: Props) {
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
    if (trimmed && !value.includes(trimmed) && value.length < maxTags) {
      onChange([...value, trimmed])
    }
    setInputVisible(false)
    setInputValue('')
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {value.map((tag) => (
        <Tag
          key={tag}
          closable
          onClose={() => handleClose(tag)}
          style={{ fontSize: 13 }}
        >
          #{tag}
        </Tag>
      ))}
      {inputVisible ? (
        <Input
          ref={inputRef as never}
          size="small"
          style={{ width: 120 }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputConfirm}
          onPressEnter={handleInputConfirm}
          placeholder="输入标签"
        />
      ) : value.length < maxTags ? (
        <Tooltip title={`最多 ${maxTags} 个标签`}>
          <Tag onClick={showInput} style={{ borderStyle: 'dashed', cursor: 'pointer' }}>
            <PlusOutlined /> 添加标签
          </Tag>
        </Tooltip>
      ) : null}
    </div>
  )
}
