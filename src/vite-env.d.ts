/// <reference types="vite/client" />

declare module 'fake-indexeddb/auto'
/// <reference types="vite-plugin-pwa/client" />

/** Injected by Vite at build time — see `define` in vite.config.ts. */
declare const __BUILD_SHA__: string
declare const __BUILD_TIME__: string

interface ImportMetaEnv {
  /** Public Supabase project URL. Safe in the browser; RLS is what protects data. */
  readonly VITE_SUPABASE_URL?: string
  /** Public anon key. The service-role key never appears in client config. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Where the customer's receipt is served, if not `https://shawarmania.in`.
   * A public URL -- the local Worker under `wrangler dev`, or a `workers.dev`
   * one before the apex route exists.
   */
  readonly VITE_RECEIPT_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
