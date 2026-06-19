import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { decideScheduledPublishAction } from './scheduled-publish-policy'

describe('scheduled publish recovery policy', () => {
  it('continues from uploaded without creating another upload', () => {
    expect(decideScheduledPublishAction('uploaded')).toBe('submit')
  })

  it('never resubmits an ambiguous submitting record', () => {
    expect(decideScheduledPublishAction('submitting')).toBe('mark-unconfirmed')
  })

  it('does nothing for completed or unconfirmed records', () => {
    expect(decideScheduledPublishAction('done')).toBe('skip')
    expect(decideScheduledPublishAction('unconfirmed')).toBe('skip')
  })

  it('uploads records that have not reached submission', () => {
    expect(decideScheduledPublishAction('pending')).toBe('upload')
    expect(decideScheduledPublishAction('uploading')).toBe('upload')
    expect(decideScheduledPublishAction('error')).toBe('upload')
  })

  it('does not wrap the whole publish flow in generic retry', () => {
    const source = readFileSync(resolve(__dirname, 'TaskQueue.ts'), 'utf8')
    expect(source).not.toMatch(/retry\(\s*\(\) => this\.publishToPlatform/)
    expect(source).not.toMatch(/retry\([\s\S]{0,500}submitContentAPI/)
  })
})
