// IPC channel names for main <-> renderer communication

export const IPC_CHANNELS = {
  // Account
  ACCOUNT_LOGIN: 'account:login',
  ACCOUNT_CHECK_SESSION: 'account:check-session',
  ACCOUNT_CHECK_ALL_SESSIONS: 'account:check-all-sessions',
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
  PUBLISH_SEARCH_LOCATION: 'publish:search-location',
  PUBLISH_GET_IP_LOCATION: 'publish:get-ip-location',
  PUBLISH_GET_RECOMMEND_LOCATIONS: 'publish:get-recommend-locations',
  PUBLISH_GET_COLLECTIONS: 'publish:get-collections',

  // Scheduler
  SCHEDULE_CREATE: 'schedule:create',
  SCHEDULE_LIST: 'schedule:list',
  SCHEDULE_CANCEL: 'schedule:cancel',
  SCHEDULE_DELETE: 'schedule:delete',
  SCHEDULE_PROGRESS: 'schedule:progress',

  // Analytics
  ANALYTICS_FETCH: 'analytics:fetch',
  ANALYTICS_COMPARE: 'analytics:compare',
  ANALYTICS_COLLECT: 'analytics:collect',
  ANALYTICS_COLLECT_ALL: 'analytics:collect-all',
  ANALYTICS_COLLECT_GROUP: 'analytics:collect-group',
  ANALYTICS_VIDEO_GROUPS: 'analytics:video-groups',
  ANALYTICS_VIDEO_DETAIL: 'analytics:video-detail',
  ANALYTICS_RECORD_TREND: 'analytics:record-trend',

  // File
  FILE_SELECT_VIDEO: 'file:select-video',
  FILE_SELECT_IMAGE: 'file:select-image',
  FILE_READ_DATA_URL: 'file:read-data-url',
  FILE_DATA_URL_TO_TEMP: 'file:data-url-to-temp',

  // Sign fallback warning
  PUBLISH_SIGN_FALLBACK_WARNING: 'publish:sign-fallback-warning',
  PUBLISH_CONFIRM_SIGN_FALLBACK: 'publish:confirm-sign-fallback',

  // App
  APP_GET_VERSION: 'app:get-version'
} as const
