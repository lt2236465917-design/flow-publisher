import { describe, expect, it } from 'vitest'
import {
  validateSubmitRelationship,
  validateUploadRelationship
} from './publish-validation'

describe('publish relationship validation', () => {
  const account = {
    id: 'a1',
    platform: 'douyin',
    session_status: 'logged_in'
  }
  const record = {
    id: 'r1',
    account_id: 'a1',
    platform: 'douyin',
    status: 'uploaded'
  }

  it('rejects upload through another platform adapter', () => {
    expect(() =>
      validateUploadRelationship(account, 'xiaohongshu')
    ).toThrow('账号与平台不匹配')
  })

  it('rejects submit through another platform adapter', () => {
    expect(() =>
      validateSubmitRelationship(record, account, 'xiaohongshu')
    ).toThrow('发布记录与平台不匹配')
  })

  it('rejects submit with another account', () => {
    expect(() =>
      validateSubmitRelationship(
        record,
        { ...account, id: 'a2' },
        'douyin'
      )
    ).toThrow('发布记录账号与平台不匹配')
  })

  it.each(['pending', 'uploading', 'submitting', 'done', 'error'])(
    'rejects records in %s state',
    (status) => {
      expect(() =>
        validateSubmitRelationship({ ...record, status }, account, 'douyin')
      ).toThrow('当前状态不允许提交')
    }
  )
})
