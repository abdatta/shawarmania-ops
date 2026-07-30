/// <reference types="vite/client" />
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
   * Supervised #24 cutover switch. The only accepted enabled value is
   * `email-or-username`; it is removed after production postflight.
   */
  readonly VITE_AUTH_CUTOVER_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
