export type ScheduledPublishAction =
  | 'upload'
  | 'submit'
  | 'mark-unconfirmed'
  | 'skip'

export function decideScheduledPublishAction(
  status: string
): ScheduledPublishAction {
  if (status === 'uploaded') return 'submit'
  if (status === 'submitting') return 'mark-unconfirmed'
  if (status === 'done' || status === 'unconfirmed') return 'skip'
  return 'upload'
}
