import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

/**
 * #82 a-deactivated-person-leaves-in-two-steps, over HTTP, through the
 * `admin-accounts` function as a hand-crafted request would reach it.
 *
 * With `owner-access-in-the-database` on, the owner's own session cannot grant,
 * end, switch off or mark as left owner access (design D5). With
 * `deactivate-then-leave` on, a manager deactivates an Employee of their own,
 * the day is recorded, the new Mark as left ends the outlet on that day and
 * frees phone and username, and a new hire takes the username (design D2, D3).
 *
 * Turns both gates on for the run and puts them back as it found them. Every
 * account it makes has a fresh username, so it is re-runnable without a reset.
 */

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
type Client = SupabaseClient<Database>

const KALYANI = '00000000-0000-4000-a000-000000000001'
const GATES = ['deactivate-then-leave', 'owner-access-in-the-database'] as const

const localKeys = () =>
  JSON.parse(
    execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as { ANON_KEY: string; SERVICE_ROLE_KEY: string }

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(-6)
let seq = 0
const freshUsername = (label: string) => `left.${label}.${RUN}.${seq++}`
const freshPhone = () => `91${String(Date.now() + seq++).slice(-10)}`
const kolkataToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

interface Reply {
  status: number
  body: Record<string, unknown>
}

describe('a deactivated person leaves in two steps, and owner access is the database’s', () => {
  let anonKey: string
  let service: Client
  let ownerToken: string
  let managerToken: string
  const before = new Map<string, boolean>()

  const call = async (token: string, payload: Record<string, unknown>): Promise<Reply> => {
    const response = await fetch(`${url}/functions/v1/admin-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : {} }
  }

  const tokenFor = async (email: string) => {
    const signedIn = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await signedIn.auth.signInWithPassword({
      email,
      password: 'shawarmania-local',
    })
    if (error || !data.session) throw new Error(`local ${email} could not sign in`)
    return data.session.access_token
  }

  /** A fresh Employee at Kalyani, provisioned by the given session. */
  const hire = async (token: string, username = freshUsername('hire'), phone = freshPhone()) => {
    const reply = await call(token, {
      action: 'provision',
      fullName: `Leaver ${username}`,
      username,
      phone,
      role: 'employee',
      outletIds: [KALYANI],
    })
    expect(reply.status, JSON.stringify(reply.body)).toBe(201)
    return { id: reply.body['profileId'] as string, username, phone }
  }

  const fingerprintOf = async (token: string, id: string) => {
    const reply = await call(token, { action: 'identifiers' })
    const identifiers = reply.body['identifiers'] as Record<string, { stateFingerprint: string }>
    return identifiers[id]!.stateFingerprint
  }

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
      throw new Error('these probes require the local Supabase stack')
    }
    const keys = localKeys()
    anonKey = keys.ANON_KEY
    service = createClient<Database>(url, keys.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await service
      .from('change_gates')
      .select('key, enabled')
      .in('key', [...GATES])
    if (error) throw error
    for (const row of data ?? []) before.set(row.key, row.enabled)
    for (const key of GATES) {
      const { error: turnError } = await service.rpc('change_gate_force', {
        p_key: key,
        p_enabled: true,
        p_reason: 'zz-deactivate-then-leave: turned on for the REST probe',
      })
      if (turnError) throw turnError
    }
    ownerToken = await tokenFor('owner@login.shawarmania.invalid')
    managerToken = await tokenFor('admin.kalyani@login.shawarmania.invalid')
  })

  afterAll(async () => {
    for (const [key, enabled] of before) {
      await service.rpc('change_gate_force', {
        p_key: key,
        p_enabled: enabled,
        p_reason: 'zz-deactivate-then-leave: restored after the REST probe',
      })
    }
  })

  it('refuses every hand-crafted owner change from the owner’s own session', async () => {
    // A second owner, made in the database as the procedure makes one: the
    // assignment and its private email in one transaction.
    const target = await hire(ownerToken)
    const { data: grants, error } = await service.rpc('grant_assignment_with_invite', {
      p_person_id: target.id,
      p_role: 'super_admin',
      p_outlet_id: null as unknown as string,
      p_account_email: `${target.username}@example.com`,
      p_issued_by: '10000000-0000-4000-a000-000000000001',
      p_code_hash: 'zz-deactivate-then-leave',
      p_valid_for: '1 day',
    })
    if (error) throw error
    const granted = { id: grants![0]!.assignment_id }

    try {
      const refusals: [string, Record<string, unknown>][] = [
        [
          'provision an owner',
          {
            action: 'provision',
            fullName: 'Owner By Request',
            username: freshUsername('owner'),
            accountEmail: `${freshUsername('owner')}@example.com`,
            role: 'super_admin',
            outletIds: [],
          },
        ],
        [
          'assign owner access',
          {
            action: 'assign',
            personId: (await hire(ownerToken)).id,
            role: 'super_admin',
            outletId: null,
            accountEmail: `${freshUsername('assign')}@example.com`,
          },
        ],
        ['end owner access', { action: 'end-assignment', assignmentId: granted.id }],
        ['deactivate an owner', { action: 'set-active', profileId: target.id, isActive: false }],
        [
          'mark an owner as left',
          {
            action: 'mark-as-left',
            profileId: target.id,
            expectedStateFingerprint: await fingerprintOf(ownerToken, target.id),
          },
        ],
        [
          'mark an owner as left, the new way',
          {
            action: 'mark-as-left-v2',
            profileId: target.id,
            expectedStateFingerprint: await fingerprintOf(ownerToken, target.id),
          },
        ],
      ]
      for (const [label, payload] of refusals) {
        const reply = await call(ownerToken, payload)
        expect(reply.status, label).toBe(403)
        expect(reply.body['error'], label).toBe('owner_access_in_database')
      }

      const { data: still } = await service
        .from('profiles')
        .select('is_active, assignments(role, ended_on)')
        .eq('id', target.id)
        .single()
      expect(still?.is_active).toBe(true)
      expect(still?.assignments.some((a) => a.role === 'super_admin' && a.ended_on === null)).toBe(
        true,
      )
    } finally {
      // Back to an ordinary account: the procedure removes owner access in the
      // database too.
      await service.from('assignments').update({ ended_on: kolkataToday() }).eq('id', granted.id)
      await service.from('profiles').update({ is_active: false }).eq('id', target.id)
    }
  })

  it('refuses an edit that grants owner access', async () => {
    const person = await hire(ownerToken)
    const { data: live } = await service
      .from('assignments')
      .select('id, role, outlet_id, started_on')
      .eq('person_id', person.id)
      .is('ended_on', null)
    const reply = await call(ownerToken, {
      action: 'edit-account',
      profileId: person.id,
      expectedStateFingerprint: await fingerprintOf(ownerToken, person.id),
      fullName: `Leaver ${person.username}`,
      phone: person.phone,
      roleTitle: null,
      accountEmail: `${person.username}@example.com`,
      assignments: [
        ...(live ?? []).map((a) => ({
          assignmentId: a.id,
          outletId: a.outlet_id,
          role: a.role,
          startedOn: a.started_on,
        })),
        { assignmentId: null, outletId: null, role: 'super_admin', startedOn: kolkataToday() },
      ],
    })
    expect(reply.status).toBe(403)
    expect(reply.body['error']).toBe('owner_access_in_database')
  })

  it('refuses to mark somebody still active as left', async () => {
    const person = await hire(managerToken)
    const reply = await call(managerToken, {
      action: 'mark-as-left-v2',
      profileId: person.id,
      expectedStateFingerprint: await fingerprintOf(managerToken, person.id),
    })
    expect(reply.status).toBe(409)
    expect(reply.body['error']).toBe('account_active')
  })

  it('lets a manager deactivate, then mark as left, and a new hire take the username', async () => {
    const person = await hire(managerToken)

    const off = await call(managerToken, {
      action: 'set-active',
      profileId: person.id,
      isActive: false,
    })
    expect(off.status).toBe(200)
    const { data: deactivated } = await service
      .from('profiles')
      .select('deactivated_at')
      .eq('id', person.id)
      .single()
    // The database's own clock, within the minute this request took.
    const stamped = Date.parse(deactivated!.deactivated_at!)
    expect(Math.abs(stamped - Date.now())).toBeLessThan(60_000)
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(stamped)),
    ).toBe(kolkataToday())

    const left = await call(managerToken, {
      action: 'mark-as-left-v2',
      profileId: person.id,
      expectedStateFingerprint: await fingerprintOf(managerToken, person.id),
    })
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    expect(left.body['leftOn']).toBe(kolkataToday())

    const { data: after } = await service
      .from('profiles')
      .select('phone, is_active, assignments(ended_on)')
      .eq('id', person.id)
      .single()
    expect(after?.phone).toBeNull()
    expect(after?.is_active).toBe(false)
    expect(after?.assignments.every((a) => a.ended_on === kolkataToday())).toBe(true)
    const { data: auth } = await service.auth.admin.getUserById(person.id)
    expect(auth.user?.email).toBe(`${person.id}@left.shawarmania.invalid`)

    // The username and the phone are free for somebody else.
    const rehire = await hire(managerToken, person.username, person.phone)
    expect(rehire.id).not.toBe(person.id)
  })
})
