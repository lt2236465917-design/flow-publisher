// IPC channel names for main <-> renderer communication

export const IPC_CHANNELS = {
  // Account
  ACCOUNT_LOGIN: 'account:login',
  ACCOUNT_CHECK_SESSION: 'account:check-session',
  ACCOUNT_LOGOUT: 'account:logout',
  ACCOUNT_LIST: 'account:list',

  // Publish
  PUBLISH_PROBE_VIDEO: 'publish:probe-video',
  PUBLISH_EXTRACT_FRAMES: 'publish:extract-frames',
  PUBLISH_VALIDATE_VIDEO: 'publish:validate-video',
  PUBLISH_UPLOAD: 'publish:upload',
  PUBLISH_SUBMIT: 'publish:submit',
  PUBLISH_SCHEDULE: 'publish:schedule',
  PUBLISH_PROGRESS: 'publish:progress',
  PUBLISH_LIST_RECORDS: 'publish:list-records',
  PUBLISH_GET_PLATFORM_FIELDS: 'publish:get-platform-fields',
  PUBLISH_GET_MODE: 'publish:get-mode',
  PUBLISH_SET_MODE: 'publish:set-mode',

  // Scheduler
  SCHEDULE_CREATE: 'schedule:create',
  SCHEDULE_LIST: 'schedule:list',
  SCHEDULE_CANCEL: 'schedule:cancel',
  SCHEDULE_DELETE: 'schedule:delete',
  SCHEDULE_PROGRESS: 'schedule:progress',

  // Analytics
  ANALYTICS_FETCH: 'analytics:fetch',
  ANALYTICS_COMPARE: 'analytics:compare',

  // File
  FILE_SELECT_VIDEO: 'file:select-video',
  FILE_SELECT_IMAGE: 'file:select-image',
  FILE_READ_DATA_URL: 'file:read-data-url',
  FILE_DATA_URL_TO_TEMP: 'file:data-url-to-temp',

  // App
  APP_GET_VERSION: 'app:get-version'
} as const
