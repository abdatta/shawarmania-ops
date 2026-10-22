import { describe, expect, it } from 'vitest'

import { appliesToAppFile, findAppStaffLists, findSqlRoleChecks } from './check-roles.mjs'

describe('a staff role is never listed by name outside the includes', () => {
  it('finds a staff list kept by hand in the app', () => {
    expect(findAppStaffLists(`const STAFF = ['biller', 'employee']`)).toHaveLength(1)
    expect(findAppStaffLists(`if (role === 'employee' || role === 'biller') go()`)).toHaveLength(1)
    expect(
      findAppStaffLists(`const roles = [\n  'biller',\n  'employee',\n]`).map(
        (hit) => hit.split(':')[0],
      ),
    ).toEqual(['1'])
  })

  it('passes one role named to route to its own shell', () => {
    expect(findAppStaffLists(`if (session.role === 'biller') return <CounterShell />`)).toEqual([])
    expect(findAppStaffLists(`const role = 'employee'`)).toEqual([])
  })

  it('passes a comment, and a line allowed with a reason on it or above it', () => {
    expect(findAppStaffLists(`// was ['biller', 'employee'] before the includes`)).toEqual([])
    expect(
      findAppStaffLists(`const X = ['biller', 'employee'] // roles-lint: allow persona keys`),
    ).toEqual([])
    expect(
      findAppStaffLists(`// roles-lint: allow persona keys\nconst X = ['biller', 'employee']`),
    ).toEqual([])
    expect(
      findAppStaffLists(`// roles-lint: allow\nconst X = ['biller', 'employee']`),
    ).toHaveLength(1)
  })

  it('applies to app source, and not to tests, fixtures, generated types or the includes', () => {
    expect(appliesToAppFile('src/session/session.ts')).toBe(true)
    expect(appliesToAppFile('src/features/accounts/accounts-surface.tsx')).toBe(true)
    expect(appliesToAppFile('src/session/session.test.ts')).toBe(false)
    expect(appliesToAppFile('src/data-access/mock/fixtures/accounts.ts')).toBe(false)
    expect(appliesToAppFile('src/data-access/database.types.ts')).toBe(false)
    expect(appliesToAppFile('src/data-access/role-includes.ts')).toBe(false)
  })

  it('finds every by-name staff check in a migration', () => {
    for (const sql of [
      `  or public.app_has_role_at('biller', outlet_id)`,
      `  or outlet_id in (select public.app_outlets_for('employee'))`,
      `     and a.role = 'biller'`,
      `     and a.role in ('employee', 'biller')`,
      `     where wanted.role not in ('employee', 'biller')`,
      `  select 'employee'::public.app_role`,
    ]) {
      expect(findSqlRoleChecks(sql), sql).toHaveLength(1)
    }
  })

  it('passes the includes helpers, a manager check, a discount source and a comment', () => {
    for (const sql of [
      `  and public.app_role_includes(a.role, 'employee')`,
      `  or public.app_acts_as('employee', outlet_id)`,
      `  or outlet_id in (select public.app_outlets_for('franchise_admin'))`,
      `  coalesce(d ->> 'source', 'biller')::public.discount_row_source`,
      `  -- every role in ('employee', 'biller') became an includes row`,
      `  and a.role = 'biller' -- roles-lint: allow a historical attribution`,
    ]) {
      expect(findSqlRoleChecks(sql), sql).toEqual([])
    }
  })
})
