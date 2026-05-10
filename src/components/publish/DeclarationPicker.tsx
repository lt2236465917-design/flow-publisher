import { Checkbox } from 'antd'

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
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#86868b',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 10,
        }}
      >
        内容声明
      </div>
      <Checkbox.Group value={value} onChange={onChange as (v: string[]) => void}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
          {DECLARATIONS.map((d) => (
            <Checkbox key={d.value} value={d.value} style={{ fontSize: 13 }}>
              {d.label}
            </Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </div>
  )
}
