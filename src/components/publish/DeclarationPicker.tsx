import { Checkbox, Typography } from 'antd'

const { Text } = Typography

const DECLARATIONS = [
  { label: '原创声明', value: '原创声明' },
  { label: '转载声明', value: '转载声明' },
  { label: '内容由 AI 生成', value: 'AI生成' },
  { label: '可能引起不适', value: '可能引起不适' },
  { label: '虚构演绎，仅供娱乐', value: '虚构演绎' },
  { label: '危险行为，请勿模仿', value: '危险行为' }
]

interface Props {
  value: string[]
  onChange: (declarations: string[]) => void
}

export default function DeclarationPicker({ value, onChange }: Props) {
  return (
    <div>
      <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>内容声明</Text>
      <Checkbox.Group value={value} onChange={onChange as (v: string[]) => void}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {DECLARATIONS.map((d) => (
            <Checkbox key={d.value} value={d.value} style={{ fontSize: 13 }}>{d.label}</Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </div>
  )
}
