/**
 * Outbox layer — the durable queue for counter writes.
 *
 * Feature code enqueues an intent here and returns immediately; it never
 * awaits the network on the billing path. The queue drains in the background,
 * keyed by a client-generated UUID so a retry that arrives twice inserts once.
 *
 * Deliberately empty until counter-devices-and-offline (#9). The folder exists
 * now so the boundary is established before anything is tempted to bypass it:
 * a bill written straight to Supabase from a feature is the bug this layer
 * exists to make impossible.
 */

export {}
