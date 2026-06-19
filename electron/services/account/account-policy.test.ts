import { describe, expect, it } from 'vitest'
import { selectReusableAccount } from './account-policy'

describe('account policy', () => {
  it('selects the latest account without deleting or sorting the source array', () => {
    const accounts = [
      { id: 'old', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'new', updated_at: '2026-02-01T00:00:00Z' }
    ]

    expect(selectReusableAccount(accounts)?.id).toBe('new')
    expect(accounts.map((account) => account.id)).toEqual(['old', 'new'])
  })

  it('returns null when no account exists', () => {
    expect(selectReusableAccount([])).toBeNull()
  })
})
