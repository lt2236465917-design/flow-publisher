export type PlatformFieldType = 'text' | 'select' | 'checkbox' | 'tags' | 'textarea';
export interface PlatformFieldOption {
    label: string;
    value: string;
}
export interface PlatformFieldDefinition {
    name: string;
    type: PlatformFieldType;
    label: string;
    placeholder?: string;
    required?: boolean;
    options?: PlatformFieldOption[];
    defaultValue?: unknown;
    maxLength?: number;
}
