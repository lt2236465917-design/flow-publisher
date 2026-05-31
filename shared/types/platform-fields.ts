export type PlatformFieldType = 'text' | 'select' | 'checkbox' | 'tags' | 'textarea' | 'checkbox-group' | 'location' | 'dynamic-select'

export interface PlatformFieldOption {
  label: string
  value: string
}

export interface PlatformFieldDefinition {
  name: string
  type: PlatformFieldType
  label: string
  placeholder?: string
  required?: boolean
  options?: PlatformFieldOption[]
  defaultValue?: unknown
  maxLength?: number
  /** For 'dynamic-select' type: identifies which data source to fetch options from */
  dynamicKey?: string
}
