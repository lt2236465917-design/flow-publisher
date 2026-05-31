import { useState, useCallback, useRef } from 'react'
import { Input, List, Spin, Empty, Tag } from 'antd'
import { EnvironmentOutlined, SearchOutlined } from '@ant-design/icons'
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

interface Props {
  value: LocationResult | null
  onChange: (location: LocationResult | null) => void
  platformId: PlatformId
  accountId: string
  placeholder?: string
}

export default function LocationSearch({ value, onChange, platformId, accountId, placeholder = '输入关键词搜索地点' }: Props) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<LocationResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim() || !accountId) {
      setResults([])
      return
    }

    setLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke(
        IPC_CHANNELS.PUBLISH_SEARCH_LOCATION,
        { platformId, accountId, keyword: kw.trim() }
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
  }, [platformId, accountId])

  const handleInputChange = useCallback((val: string) => {
    setKeyword(val)
    setShowResults(true)

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
    setShowResults(false)
    setResults([])
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange(null)
    setKeyword('')
    setResults([])
    setShowResults(false)
  }, [onChange])

  return (
    <div style={{ position: 'relative' }}>
      {/* Selected location display / Search input */}
      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 11px',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            background: '#fafafa',
          }}
        >
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
        </div>
      ) : (
        <Input
          value={keyword}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setShowResults(true) }}
          onBlur={() => { setTimeout(() => setShowResults(false), 200) }}
          placeholder={placeholder}
          prefix={<SearchOutlined style={{ color: '#86868b' }} />}
          suffix={loading ? <Spin size="small" /> : null}
        />
      )}

      {/* Search results dropdown */}
      {showResults && results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1050,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.1)',
            border: '1px solid rgba(0, 0, 0, 0.06)',
            maxHeight: 280,
            overflow: 'hidden',
            marginTop: 4,
          }}
        >
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
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
        </div>
      )}

      {/* Empty state */}
      {showResults && !loading && keyword.trim() && results.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1050,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.1)',
            border: '1px solid rgba(0, 0, 0, 0.06)',
            marginTop: 4,
            padding: '16px 0',
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未找到相关地点"
            style={{ margin: 0 }}
          />
        </div>
      )}
    </div>
  )
}
