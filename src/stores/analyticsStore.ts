import { create } from 'zustand'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import type {
  TimeRange,
  AnalyticsOverview,
  PlatformCompareItem
} from '../../shared/contracts/analytics.contract'

interface AnalyticsState {
  overview: AnalyticsOverview | null
  compareResult: PlatformCompareItem[]
  timeRange: TimeRange
  loading: boolean

  setTimeRange: (range: TimeRange) => void
  fetchOverview: () => Promise<void>
  fetchCompare: () => Promise<void>
}

function defaultOverview(): AnalyticsOverview {
  return {
    totalPublishes: 0,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
    successRate: 0,
    platformStats: [],
    dailyTrends: [],
    statusDistribution: []
  }
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  overview: null,
  compareResult: [],
  timeRange: '30d',
  loading: false,

  setTimeRange: (range) => {
    set({ timeRange: range })
    get().fetchOverview()
    get().fetchCompare()
  },

  fetchOverview: async () => {
    const { timeRange } = get()
    set({ loading: true })
    try {
      const res = await window.electron.ipcRenderer.invoke<AnalyticsOverview>(
        IPC_CHANNELS.ANALYTICS_FETCH,
        { timeRange }
      )
      if (res.success && res.data) {
        set({ overview: res.data })
      } else {
        set({ overview: defaultOverview() })
      }
    } catch {
      set({ overview: defaultOverview() })
    } finally {
      set({ loading: false })
    }
  },

  fetchCompare: async () => {
    const { timeRange } = get()
    try {
      const res = await window.electron.ipcRenderer.invoke<PlatformCompareItem[]>(
        IPC_CHANNELS.ANALYTICS_COMPARE,
        { timeRange }
      )
      if (res.success && res.data) {
        set({ compareResult: res.data })
      } else {
        set({ compareResult: [] })
      }
    } catch {
      set({ compareResult: [] })
    }
  }
}))
