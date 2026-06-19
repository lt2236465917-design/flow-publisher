export function selectReusableAccount<T extends { updated_at: string }>(
  accounts: readonly T[]
): T | null {
  return (
    [...accounts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ||
    null
  )
}
