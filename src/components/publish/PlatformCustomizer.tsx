import { useState, useEffect } from 'react'
import { Tabs, Empty, Spin, Form, message } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import PlatformIcon from '@/components/common/PlatformIcon'
import type { PlatformFieldDefinition } from '@shared/types/platform-fields'
import { ipcInvoke } from '@/utils/ipc'
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
      .catch((err) => {
        console.error('[PlatformCustomizer] Failed to fetch accounts:', err)
      })
  }, [])

  useEffect(() => {
    for (const platformId of platforms) {
      // 如果已有字段定义且不需要重新解析动态选项，跳过
      const hasExistingFields = fieldDefs[platformId] !== undefined
      const needsDynamicResolve = hasExistingFields && fieldDefs[platformId].some(
        (f) => f.type === 'dynamic-select' && f.dynamicKey && (!f.options || f.options.length === 0)
      )
      if (hasExistingFields && !needsDynamicResolve) continue

      setLoading((prev) => ({ ...prev, [platformId]: true }))
      window.electron.ipcRenderer
        .invoke<{ success: boolean; data: PlatformFieldDefinition[] }>(
          IPC_CHANNELS.PUBLISH_GET_PLATFORM_FIELDS,
          platformId
        )
        .then(async (res: unknown) => {
          const r = res as { success?: boolean; data?: PlatformFieldDefinition[] }
          let fields: PlatformFieldDefinition[] = (r.success && r.data) ? r.data : []

          // Resolve dynamic-select fields: fetch options from backend
          const DYNAMIC_KEY_IPC: Record<string, string> = {
            collections: IPC_CHANNELS.PUBLISH_GET_COLLECTIONS
          }
          const account = accounts.find((a) => a.platform === platformId && a.sessionStatus === 'logged_in')
          if (account) {
            fields = await Promise.all(
              fields.map(async (field) => {
                if (field.type !== 'dynamic-select' || !field.dynamicKey) return field
                const ipcChannel = DYNAMIC_KEY_IPC[field.dynamicKey]
                if (!ipcChannel) return field
                try {
                  const optRes = await ipcInvoke<Array<{ label: string; value: string }>>(
                    ipcChannel,
                    { platformId, accountId: account.id }
                  )
                  if (optRes.success && optRes.data) {
                    return { ...field, options: optRes.data }
                  }
                } catch (err) {
                  console.error(`[PlatformCustomizer] Failed to fetch dynamic options for ${platformId}/${field.dynamicKey}:`, err)
                }
                return field
              })
            ).catch((err) => {
              console.error(`[PlatformCustomizer] Failed to load platform fields for ${platformId}:`, err)
            })
          }

          setFieldDefs((prev) => ({ ...prev, [platformId]: fields }))
        })
        .catch(() => {
          setFieldDefs((prev) => ({ ...prev, [platformId]: [] }))
        })
        .finally(() => {
          setLoading((prev) => ({ ...prev, [platformId]: false }))
        })
    }
  }, [platforms, accounts])

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
          <PlatformIcon platformId={platformId} size={14} radius={3} />
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
