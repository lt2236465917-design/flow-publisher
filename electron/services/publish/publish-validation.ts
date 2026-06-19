interface PublishAccount {
  id: string
  platform: string
  session_status?: string
}

interface PublishRecord {
  account_id: string
  platform: string
  status: string
}

export function validateUploadRelationship(
  account: PublishAccount,
  platformId: string
): void {
  if (account.platform !== platformId) {
    throw new Error('账号与平台不匹配')
  }
  if (account.session_status !== 'logged_in') {
    throw new Error('账号未登录，请先登录')
  }
}

export function validateSubmitRelationship(
  record: PublishRecord,
  account: PublishAccount,
  platformId: string
): void {
  if (record.platform !== platformId) {
    throw new Error('发布记录与平台不匹配')
  }
  if (account.id !== record.account_id || account.platform !== platformId) {
    throw new Error('发布记录账号与平台不匹配')
  }
  if (record.status !== 'uploaded') {
    throw new Error('发布记录当前状态不允许提交')
  }
}
