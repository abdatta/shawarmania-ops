export const PRODUCTION_RECOVERY_REDIRECT = 'https://ops.shawarmania.in/recover'

export interface RecoveryRuntimeConfig {
  sendEmailHookSecret?: string
  resendApiKey?: string
  recoveryEmailFrom?: string
  ownerRecoveryRedirectUrl?: string
}

/**
 * Deployment readiness checks only values available inside the Edge runtime.
 * Sender DNS and the Auth dashboard hook registration remain supervised
 * rollout checks because proving either here would require a management
 * credential or an outbound message.
 */
export function recoveryRuntimeReady(
  config: RecoveryRuntimeConfig,
  options: { local: boolean },
): boolean {
  if (options.local) return true

  const hookSecret = config.sendEmailHookSecret?.trim() ?? ''
  const resendApiKey = config.resendApiKey?.trim() ?? ''
  const recoveryEmailFrom = config.recoveryEmailFrom?.trim() ?? ''
  const recoveryRedirect = config.ownerRecoveryRedirectUrl?.trim() ?? ''

  return (
    hookSecret.startsWith('v1,whsec_') &&
    resendApiKey.startsWith('re_') &&
    recoveryEmailFrom.includes('@') &&
    recoveryRedirect === PRODUCTION_RECOVERY_REDIRECT
  )
}
