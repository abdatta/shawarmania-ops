import { describe, expect, it } from 'vitest'

import {
  PRODUCTION_RECOVERY_REDIRECT,
  recoveryRuntimeReady,
  type RecoveryRuntimeConfig,
} from '../../shared/auth-readiness'

const completeConfig: RecoveryRuntimeConfig = {
  sendEmailHookSecret: 'v1,whsec_base64value',
  resendApiKey: 're_provider-key',
  recoveryEmailFrom: 'Shawarmania Ops <access@ops.shawarmania.in>',
  ownerRecoveryRedirectUrl: PRODUCTION_RECOVERY_REDIRECT,
}

describe('recovery runtime deployment readiness', () => {
  it('accepts the complete canonical production configuration', () => {
    expect(recoveryRuntimeReady(completeConfig, { local: false })).toBe(true)
  })

  it.each(Object.keys(completeConfig) as (keyof RecoveryRuntimeConfig)[])(
    'fails closed when %s is absent',
    (key) => {
      expect(
        recoveryRuntimeReady(
          {
            ...completeConfig,
            [key]: undefined,
          },
          { local: false },
        ),
      ).toBe(false)
    },
  )

  it('refuses malformed provider values and a non-canonical redirect', () => {
    for (const config of [
      { ...completeConfig, sendEmailHookSecret: 'wrong' },
      { ...completeConfig, resendApiKey: 'wrong' },
      { ...completeConfig, recoveryEmailFrom: 'not-an-address' },
      { ...completeConfig, ownerRecoveryRedirectUrl: 'https://example.com/recover' },
    ]) {
      expect(recoveryRuntimeReady(config, { local: false })).toBe(false)
    }
  })

  it('accepts the committed local Mailpit and hook configuration', () => {
    expect(recoveryRuntimeReady({}, { local: true })).toBe(true)
  })
})
