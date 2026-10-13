import { parseAppEnvironment } from './app-environment'

/** This build's environment, fixed when it was built. */
export const APP_ENVIRONMENT = parseAppEnvironment(import.meta.env.VITE_APP_ENVIRONMENT)
