import { useState, useCallback, useRef, useEffect } from 'react'
import { Input, List, Spin, Empty, Popover, Tabs, Button } from 'antd'
import { EnvironmentOutlined, SearchOutlined, AimOutlined, LoadingOutlined } from '@ant-design/icons'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import type { PlatformId } from '@/constants/platforms'

interface LocationResult {
  id: string
  name: string
  address?: string
  lat?: number
  lng?: number
  poi_id?: string
  extra?: Record<string, unknown>
}

interface IPLocation {
  lat: number
  lng: number
  city?: string
  province?: string
}

interface Props {
  value: LocationResult | null
  onChange: (location: LocationResult | null) => void
  platformId: PlatformId
  accountId: string
  placeholder?: string
}

export default function LocationSearch({ value, onChange, platformId, accountId, placeholder = '选择位置' }: Props) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<LocationResult[]>([])
  const [recommendResults, setRecommendResults] = useState<LocationResult[]>([])
  const [loading, setLoading] = useState(false)
  const [recommendLoading, setRecommendLoading] = useState(false)
  const [showPopover, setShowPopover] = useState(false)
  const [activeTab, setActiveTab] = useState('recommend')
  const [ipLocation, setIpLocation] = useState<IPLocation | null>(null)
  const [ipLoading, setIpLoading] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 获取IP定位
  const fetchIPLocation = useCallback(async () => {
    setIpLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.PUBLISH_GET_IP_LOCATION
      ) as { success: boolean; data?: IPLocation; error?: string }
      if (res.success && res.data) {
        setIpLocation(res.data)
        return res.data
      }
    } catch (err) {
      console.error('Failed to get IP location:', err)
    } finally {
      setIpLoading(false)
    }
    return null
  }, [])

  // 获取推荐位置
  const fetchRecommendLocations = useCallback(async (location?: IPLocation) => {
    if (!accountId) return

    setRecommendLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.PUBLISH_GET_RECOMMEND_LOCATIONS,
        {
          platformId,
          accountId,
          lat: location?.lat || ipLocation?.lat,
          lng: location?.lng || ipLocation?.lng
        }
      ) as { success: boolean; data?: LocationResult[]; error?: string }
      if (res.success && res.data) {
        setRecommendResults(res.data)
      }
    } catch (err) {
      console.error('Failed to get recommend locations:', err)
    } finally {
      setRecommendLoading(false)
    }
  }, [platformId, accountId, ipLocation])

  // 打开Popover时获取数据
  const handleOpenChange = useCallback(async (open: boolean) => {
    setShowPopover(open)
    if (open && recommendResults.length === 0) {
      const location = await fetchIPLocation()
      await fetchRecommendLocations(location || undefined)
    }
  }, [fetchIPLocation, fetchRecommendLocations, recommendResults.length])

  // 搜索位置
  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim() || !accountId) {
      setResults([])
      return
    }

    setLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.PUBLISH_SEARCH_LOCATION,
        {
          platformId,
          accountId,
          keyword: kw.trim(),
          lat: ipLocation?.lat,
          lng: ipLocation?.lng
        }
      ) as { success: boolean; data?: LocationResult[]; error?: string }
      if (res.success && res.data) {
        setResults(res.data)
      } else {
        setResults([])
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [platformId, accountId, ipLocation])

  const handleInputChange = useCallback((val: string) => {
    setKeyword(val)

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
    }

    if (!val.trim()) {
      setResults([])
      return
    }

    // Debounce search by 600ms
    searchTimeout.current = setTimeout(() => {
      doSearch(val)
    }, 600)
  }, [doSearch])

  const handleSelect = useCallback((item: LocationResult) => {
    onChange(item)
    setKeyword('')
    setResults([])
    setShowPopover(false)
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null)
    setKeyword('')
    setResults([])
  }, [onChange])

  // 渲染推荐列表
  const renderRecommendList = () => {
    if (recommendLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
        </div>
      )
    }

    if (recommendResults.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无推荐位置"
          style={{ margin: '16px 0' }}
        />
      )
    }

    return (
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {ipLocation && (
          <div style={{
            padding: '8px 12px',
            background: '#f0f7ff',
            borderRadius: 6,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <AimOutlined style={{ color: '#1677ff' }} />
            <span style={{ fontSize: 12, color: '#666' }}>
              当前位置: {ipLocation.city || ipLocation.province || '未知'}
            </span>
          </div>
        )}
        <List
          size="small"
          dataSource={recommendResults}
          renderItem={(item) => (
            <List.Item
              onClick={() => handleSelect(item)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(0, 113, 227, 0.04)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>
                  <EnvironmentOutlined style={{ marginRight: 6, color: '#0071e3' }} />
                  {item.name}
                </div>
                {item.address && (
                  <div style={{ fontSize: 11, color: '#86868b', marginTop: 2, marginLeft: 18 }}>
                    {item.address}
                  </div>
                )}
              </div>
            </List.Item>
          )}
        />
      </div>
    )
  }

  // 渲染搜索列表
  const renderSearchList = () => {
    return (
      <div>
        <Input
          value={keyword}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="输入关键词搜索地点"
          prefix={<SearchOutlined style={{ color: '#86868b' }} />}
          suffix={loading ? <Spin size="small" /> : null}
          allowClear
          style={{ marginBottom: 8 }}
        />
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
          </div>
        ) : results.length > 0 ? (
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <List
              size="small"
              dataSource={results}
              renderItem={(item) => (
                <List.Item
                  onClick={() => handleSelect(item)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(0, 113, 227, 0.04)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <div style={{ width: '100%' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>
                      <EnvironmentOutlined style={{ marginRight: 6, color: '#0071e3' }} />
                      {item.name}
                    </div>
                    {item.address && (
                      <div style={{ fontSize: 11, color: '#86868b', marginTop: 2, marginLeft: 18 }}>
                        {item.address}
                      </div>
                    )}
                  </div>
                </List.Item>
              )}
            />
          </div>
        ) : keyword.trim() ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未找到相关地点"
            style={{ margin: '16px 0' }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#999', fontSize: 13 }}>
            输入关键词搜索地点
          </div>
        )}
      </div>
    )
  }

  // Popover内容
  const popoverContent = (
    <div style={{ width: 320 }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'recommend',
            label: (
              <span>
                <AimOutlined /> 推荐
              </span>
            ),
            children: renderRecommendList()
          },
          {
            key: 'search',
            label: (
              <span>
                <SearchOutlined /> 搜索
              </span>
            ),
            children: renderSearchList()
          }
        ]}
      />
    </div>
  )

  return (
    <Popover
      content={popoverContent}
      trigger="click"
      open={showPopover}
      onOpenChange={handleOpenChange}
      placement="bottomLeft"
      overlayStyle={{ padding: 0 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 11px',
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          background: '#fff',
          cursor: 'pointer',
          minHeight: 32
        }}
      >
        {value ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <EnvironmentOutlined style={{ color: '#0071e3', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {value.name}
                </div>
                {value.address && (
                  <div style={{ fontSize: 11, color: '#86868b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {value.address}
                  </div>
                )}
              </div>
            </div>
            <span
              onClick={handleClear}
              style={{ cursor: 'pointer', color: '#86868b', fontSize: 12, flexShrink: 0, marginLeft: 8 }}
            >
              ✕
            </span>
          </>
        ) : (
          <>
            <EnvironmentOutlined style={{ color: '#86868b', marginRight: 6 }} />
            <span style={{ color: '#bfbfbf', fontSize: 13 }}>{placeholder}</span>
          </>
        )}
      </div>
    </Popover>
  )
}
