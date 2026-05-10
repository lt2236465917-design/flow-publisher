import { useState } from 'react'
import { Modal, DatePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

interface Props {
  open: boolean
  onConfirm: (scheduledAt: string) => void
  onCancel: () => void
}

export default function SchedulePicker({ open, onConfirm, onCancel }: Props) {
  const [selectedTime, setSelectedTime] = useState<Dayjs | null>(null)

  const disabledDate = (current: Dayjs) => {
    return current && current.isBefore(dayjs().startOf('day'))
  }

  const disabledTime = () => {
    const now = dayjs()
    if (selectedTime && selectedTime.isSame(now, 'day')) {
      return {
        disabledHours: () => {
          const hours: number[] = []
          for (let i = 0; i < now.hour(); i++) hours.push(i)
          return hours
        },
        disabledMinutes: (selectedHour: number) => {
          if (selectedHour === now.hour()) {
            const mins: number[] = []
            for (let i = 0; i <= now.minute() + 4; i++) mins.push(i)
            return mins
          }
          return []
        }
      }
    }
    return {}
  }

  const handleOk = () => {
    if (!selectedTime) return
    onConfirm(selectedTime.toISOString())
    setSelectedTime(null)
  }

  return (
    <Modal
      open={open}
      onOk={handleOk}
      onCancel={() => {
        setSelectedTime(null)
        onCancel()
      }}
      okText="确认定时"
      cancelText="取消"
      okButtonProps={{ disabled: !selectedTime }}
      title={null}
      width={380}
    >
      <div style={{ padding: '8px 0' }}>
        <div
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: 18,
            fontWeight: 600,
            color: '#1d1d1f',
            letterSpacing: '-0.02em',
            marginBottom: 4,
          }}
        >
          选择发布时间
        </div>
        <div style={{ fontSize: 13, color: '#86868b', marginBottom: 20 }}>
          定时时间需在当前时间 5 分钟之后
        </div>
        <DatePicker
          showTime
          format="YYYY年MM月DD日 HH:mm"
          value={selectedTime}
          onChange={(v) => setSelectedTime(v)}
          disabledDate={disabledDate}
          disabledTime={disabledTime}
          placeholder="选择日期和时间"
          style={{ width: '100%' }}
          showNow={false}
        />
      </div>
    </Modal>
  )
}
