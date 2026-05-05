// IPC channel names for main <-> renderer communication
// Will be populated in Phase 2+

export const IPC_CHANNELS = {
  // Account
  ACCOUNT_LOGIN: 'account:login',
  ACCOUNT_CHECK_SESSION: 'account:check-session',
  ACCOUNT_LOGOUT: 'account:logout',
  ACCOUNT_LIST: 'account:list',

  // Publish
  PUBLISH_UPLOAD: 'publish:upload',
  PUBLISH_SUBMIT: 'publish:submit',
  PUBLISH_SCHEDULE: 'publish:schedule',

  // Analytics
  ANALYTICS_FETCH: 'analytics:fetch',
  ANALYTICS_COMPARE: 'analytics:compare',

  // File
  FILE_SELECT_VIDEO: 'file:select-video',
  FILE_SELECT_IMAGE: 'file:select-image',

  // App
  APP_GET_VERSION: 'app:get-version'
} as const
