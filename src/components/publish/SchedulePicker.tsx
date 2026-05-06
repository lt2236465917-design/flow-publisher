import { useState } from 'react'
import { Modal, DatePicker, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

const { Text } = Typography

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
      title="选择发布时间"
      open={open}
      onOk={handleOk}
      onCancel={() => {
        setSelectedTime(null)
        onCancel()
      }}
      okText="确认定时"
      cancelText="取消"
      okButtonProps={{ disabled: !selectedTime }}
    >
      <div style={{ padding: '16px 0' }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          定时时间需在当前时间5分钟之后
        </Text>
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
