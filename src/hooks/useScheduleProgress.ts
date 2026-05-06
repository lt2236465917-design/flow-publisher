import { useEffect } from 'react'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { useRecordStore } from '@/stores/recordStore'

export function useScheduleProgress() {
  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(
      IPC_CHANNELS.SCHEDULE_PROGRESS,
      () => {
        // Refresh scheduled tasks on any progress event
        useRecordStore.getState().fetchScheduledTasks()
      }
    )
    return () => { unsubscribe() }
  }, [])
}
