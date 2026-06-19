import { create } from 'zustand'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { ipcInvoke } from '@/utils/ipc'
import type {
  TimeRange,
  AnalyticsOverview,
  PlatformCompareItem,
  VideoGroupSummary,
  VideoGroupDetail,
  VideoGroupListResult,
  VideoGroupQuery,
  TrendPoint,
  CollectResult
} from '../../shared/contracts/analytics.contract'

interface AnalyticsState {
  // 发布统计（原有）
  overview: AnalyticsOverview | null
  compareResult: PlatformCompareItem[]
  timeRange: TimeRange
  loading: boolean

  // 视频数据（新增）
  videoGroups: VideoGroupSummary[]
  videoGroupsTotal: number
  videoGroupsPage: number
  videoDetail: VideoGroupDetail | null
  recordTrend: TrendPoint[]
  collecting: boolean
  collectResult: CollectResult | null
  videoGroupsLoading: boolean
  videoDetailLoading: boolean

  // 原有方法
  setTimeRange: (range: TimeRange) => void
  fetchOverview: () => Promise<void>
  fetchCompare: () => Promise<void>

  // 新增方法
  fetchVideoGroups: (query?: VideoGroupQuery) => Promise<void>
  fetchVideoDetail: (groupId: string) => Promise<void>
  fetchRecordTrend: (recordId: string, days?: number) => Promise<void>
  collectAccount: (accountId: string) => Promise<CollectResult>
  collectAll: () => Promise<CollectResult>
  collectVideoGroup: (groupId: string) => Promise<CollectResult>
  clearVideoDetail: () => void
  clearCollectResult: () => void
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
  // 发布统计
  overview: null,
  compareResult: [],
  timeRange: '30d',
  loading: false,

  // 视频数据
  videoGroups: [],
  videoGroupsTotal: 0,
  videoGroupsPage: 1,
  videoDetail: null,
  recordTrend: [],
  collecting: false,
  collectResult: null,
  videoGroupsLoading: false,
  videoDetailLoading: false,

  setTimeRange: (range) => {
    set({ timeRange: range })
    get().fetchOverview()
    get().fetchCompare()
  },

  fetchOverview: async () => {
    const { timeRange } = get()
    set({ loading: true })
    try {
      const res = await ipcInvoke<AnalyticsOverview>(IPC_CHANNELS.ANALYTICS_FETCH, { timeRange })
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
      const res = await ipcInvoke<PlatformCompareItem[]>(IPC_CHANNELS.ANALYTICS_COMPARE, { timeRange })
      if (res.success && res.data) {
        set({ compareResult: res.data })
      } else {
        set({ compareResult: [] })
      }
    } catch {
      set({ compareResult: [] })
    }
  },

  // ---- 视频数据 ----

  fetchVideoGroups: async (query?: VideoGroupQuery) => {
    set({ videoGroupsLoading: true })
    try {
      const res = await ipcInvoke<VideoGroupListResult>(IPC_CHANNELS.ANALYTICS_VIDEO_GROUPS, query || {})
      if (res.success && res.data) {
        set({
          videoGroups: res.data.groups,
          videoGroupsTotal: res.data.total,
          videoGroupsPage: res.data.page
        })
      } else {
        set({ videoGroups: [], videoGroupsTotal: 0 })
      }
    } catch {
      set({ videoGroups: [], videoGroupsTotal: 0 })
    } finally {
      set({ videoGroupsLoading: false })
    }
  },

  fetchVideoDetail: async (groupId: string) => {
    set({ videoDetailLoading: true, videoDetail: null })
    try {
      const res = await ipcInvoke<VideoGroupDetail>(IPC_CHANNELS.ANALYTICS_VIDEO_DETAIL, { groupId })
      if (res.success && res.data) {
        set({ videoDetail: res.data })
      }
    } catch {
      set({ videoDetail: null })
    } finally {
      set({ videoDetailLoading: false })
    }
  },

  fetchRecordTrend: async (recordId: string, days?: number) => {
    try {
      const res = await ipcInvoke<TrendPoint[]>(IPC_CHANNELS.ANALYTICS_RECORD_TREND, { recordId, days })
      if (res.success && res.data) {
        set({ recordTrend: res.data })
      } else {
        set({ recordTrend: [] })
      }
    } catch {
      set({ recordTrend: [] })
    }
  },

  collectAccount: async (accountId: string) => {
    if (get().collecting) throw new Error('数据采集正在进行中')
    set({ collecting: true, collectResult: null })
    try {
      const res = await ipcInvoke<CollectResult>(IPC_CHANNELS.ANALYTICS_COLLECT, { accountId })
      if (res.success && res.data) {
        set({ collectResult: res.data })
        await get().fetchVideoGroups()
        return res.data
      }
      throw new Error(res.error || '数据采集失败')
    } catch (err) {
      set({ collectResult: null })
      throw err
    } finally {
      set({ collecting: false })
    }
  },

  collectAll: async () => {
    if (get().collecting) throw new Error('数据采集正在进行中')
    set({ collecting: true, collectResult: null })
    try {
      const res = await ipcInvoke<CollectResult>(IPC_CHANNELS.ANALYTICS_COLLECT_ALL)
      if (res.success && res.data) {
        set({ collectResult: res.data })
        await get().fetchVideoGroups()
        return res.data
      }
      throw new Error(res.error || '数据采集失败')
    } catch (err) {
      set({ collectResult: null })
      throw err
    } finally {
      set({ collecting: false })
    }
  },

  collectVideoGroup: async (groupId: string) => {
    if (get().collecting) throw new Error('数据采集正在进行中')
    set({ collecting: true, collectResult: null })
    try {
      const res = await ipcInvoke<CollectResult>(IPC_CHANNELS.ANALYTICS_COLLECT_GROUP, { groupId })
      if (res.success && res.data) {
        set({ collectResult: res.data })
        await get().fetchVideoDetail(groupId)
        return res.data
      }
      throw new Error(res.error || '数据采集失败')
    } catch (err) {
      set({ collectResult: null })
      throw err
    } finally {
      set({ collecting: false })
    }
  },

  clearVideoDetail: () => set({ videoDetail: null, recordTrend: [] }),
  clearCollectResult: () => set({ collectResult: null })
}))
