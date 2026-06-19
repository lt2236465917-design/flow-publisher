import { describe, expect, it } from 'vitest'
import { FileAccessPolicy } from './file-access-policy'

describe('FileAccessPolicy', () => {
  it('does not authorize the entire home directory', () => {
    const policy = new FileAccessPolicy(['/app/userData'], ['/tmp/flow'])
    expect(policy.isAllowed('/Users/test/.ssh/id_rsa')).toBe(false)
  })

  it('accepts explicitly authorized files and rejects sibling prefixes', () => {
    const policy = new FileAccessPolicy(['/app/userData'], ['/tmp/flow'])
    policy.authorize('/Users/test/Videos/a.mp4')

    expect(policy.isAllowed('/Users/test/Videos/a.mp4')).toBe(true)
    expect(policy.isAllowed('/app/userData-evil/file')).toBe(false)
  })

  it('allows files inside app-owned roots', () => {
    const policy = new FileAccessPolicy(['/app/userData'], ['/tmp/flow'])
    expect(policy.isAllowed('/app/userData/covers/a.jpg')).toBe(true)
    expect(policy.isAllowed('/tmp/flow/session/frame.jpg')).toBe(true)
  })
})
