import { useWaitingAttention } from '@/features/attendance/waiting-counts'
import { useCounterRequestAttention } from '@/features/counter/use-counter-handshake'
import { useZomatoAttention } from '@/features/zomato-sync/needs-you-count'
import type { AttentionSourceId } from '@/gates/registry'

import type { AttentionSource } from './attention'

/**
 * One implementation per source the registry names. `Record` over the id union
 * rather than a partial map, so naming a source in the registry without writing
 * one here is a compile error rather than a badge that never appears.
 *
 * This file is the only place the shell's badge and a feature's data meet. The
 * shell reads the map; it never reads attendance.
 */
export const ATTENTION_SOURCES: Record<AttentionSourceId, AttentionSource> = {
  'attendance-waiting': useWaitingAttention,
  'counter-request-waiting': useCounterRequestAttention,
  'zomato-needs-you': useZomatoAttention,
}
