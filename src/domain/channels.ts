/**
 * The delivery channels this business trades on.
 *
 * **A domain fact, not a surface detail**, and it lives here because three
 * layers need the same list and none of them may import the others': the
 * Delivery surface draws one tab per channel, and the Ledger's month has to
 * know which channels are *expected* in order to say that one reported nothing
 * at all. A channel that produced no rows and a channel that had no orders are
 * indistinguishable in the data, and only a list of what was expected makes the
 * first of them sayable.
 */
export const DELIVERY_CHANNELS = ['zomato', 'swiggy'] as const

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number]

/** Whether a route segment names a channel this surface actually serves. */
export function isDeliveryChannel(value: string | undefined): value is DeliveryChannel {
  return DELIVERY_CHANNELS.some((channel) => channel === value)
}
