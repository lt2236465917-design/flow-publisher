import { useState, useEffect } from 'react'
import { Tabs, Empty, Spin, Form } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformFieldDefinition } from '@shared/types/platform-fields'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import PlatformFieldRenderer from './PlatformFieldRenderer'

interface AccountInfo {
  id: string
  platform: string
  displayName: string
  sessionStatus: string
}

interface Props {
  platforms: PlatformId[]
  overrides: Record<PlatformId, Record<string, unknown>>
  onChange: (overrides: Record<PlatformId, Record<string, unknown>>) => void
}

export default function PlatformCustomizer({ platforms, overrides, onChange }: Props) {
  const [fieldDefs, setFieldDefs] = useState<Record<string, PlatformFieldDefinition[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [accounts, setAccounts] = useState<AccountInfo[]>([])

  useEffect(() => {
    // Fetch accounts for location search
    window.electron.ipcRenderer
      .invoke<{ success: boolean; data?: AccountInfo[] }>(IPC_CHANNELS.ACCOUNT_LIST)
      .then((res: unknown) => {
        const r = res as { success?: boolean; data?: AccountInfo[] }
        if (r.success && r.data) {
          setAccounts(r.data)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    for (const platformId of platforms) {
      if (fieldDefs[platformId] !== undefined) continue

      setLoading((prev) => ({ ...prev, [platformId]: true }))
      window.electron.ipcRenderer
        .invoke<{ success: boolean; data: PlatformFieldDefinition[] }>(
          IPC_CHANNELS.PUBLISH_GET_PLATFORM_FIELDS,
          platformId
        )
        .then((res: unknown) => {
          const r = res as { success?: boolean; data?: PlatformFieldDefinition[] }
          const fields: PlatformFieldDefinition[] = (r.success && r.data) ? r.data : []
          setFieldDefs((prev) => ({ ...prev, [platformId]: fields }))
        })
        .catch(() => {
          setFieldDefs((prev) => ({ ...prev, [platformId]: [] }))
        })
        .finally(() => {
          setLoading((prev) => ({ ...prev, [platformId]: false }))
        })
    }
  }, [platforms])

  const getAccountId = (platformId: PlatformId): string | undefined => {
    return accounts.find((a) => a.platform === platformId && a.sessionStatus === 'logged_in')?.id
  }

  const handleFieldChange = (platformId: PlatformId, fieldName: string, value: unknown) => {
    onChange({
      ...overrides,
      [platformId]: {
        ...(overrides[platformId] || {}),
        [fieldName]: value
      }
    })
  }

  if (platforms.length === 0) return null

  const tabItems = platforms.map((platformId) => {
    const info = PLATFORMS[platformId]
    const fields = fieldDefs[platformId] ?? []
    const isLoading = loading[platformId]
    const platformOverrides = overrides[platformId] || {}

    return {
      key: platformId,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {info.iconUrl ? (
            <img src={info.iconUrl} alt={info.displayName} style={{ width: 14, height: 14, borderRadius: 3 }} />
          ) : (
            info.icon
          )}
          {info.displayName}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 0' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin />
            </div>
          ) : fields.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="该平台暂无额外设置"
              style={{ margin: '24px 0' }}
            />
          ) : (
            <Form layout="vertical" style={{ maxWidth: '100%' }} size="small">
              {fields.map((field) => (
                <PlatformFieldRenderer
                  key={field.name}
                  field={field}
                  value={platformOverrides[field.name]}
                  onChange={(name, value) => handleFieldChange(platformId, name, value)}
                  platformId={platformId}
                  accountId={getAccountId(platformId)}
                />
              ))}
            </Form>
          )}
        </div>
      )
    }
  })

  return <Tabs items={tabItems} size="small" />
}
