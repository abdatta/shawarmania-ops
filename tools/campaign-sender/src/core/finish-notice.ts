/**
 * The WhatsApp the owner who submitted a campaign is sent when it finishes
 * (task 4.7; spec: "the owner who scheduled it is sent those totals").
 *
 * Plain words and figures, in the same order the campaign's page shows them.
 * Delivered and read are left out: receipts keep arriving after a campaign is
 * done, so either figure would be out of date by the time it was read.
 */

export interface FinishCounts {
  recipients: number
  sent: number
  notOnWhatsapp: number
  failed: number
  unsure: number
  stopped: number
}

export function finishNoticeText(campaignName: string, counts: FinishCounts): string {
  const parts = [`Sent to ${counts.sent} of ${counts.recipients}.`]
  const rest = [
    counts.notOnWhatsapp > 0 ? `${counts.notOnWhatsapp} not on WhatsApp` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.unsure > 0 ? `${counts.unsure} unsure` : null,
    counts.stopped > 0 ? `${counts.stopped} stopped` : null,
  ].filter((part): part is string => part !== null)
  if (rest.length > 0) parts.push(`${rest.join(', ')}.`)
  return `Shawarmania campaign *${campaignName}* is finished. ${parts.join(' ')}`
}
