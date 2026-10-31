import type { APIRequestContext, Browser, Page } from '@playwright/test'

import { expect, test } from './test'
import { LOCAL_ANON_KEY, OUTLET_KALYANI, PASSWORD, SUPABASE_URL } from './tills'

/**
 * A tablet keeps its login (a-tablet-keeps-its-login).
 *
 * The counter laptop at Kalyani Cafe was set up again and again because a staff
 * member signed in on it at `/sign-in` to mark attendance, which replaced the
 * tablet's session in the browser's one Auth slot, and signing out left it
 * unregistered. These set a tablet up the way a counter is set up, from a
 * setup code an admin issued, so it holds a real machine identity, and then
 * open the addresses that used to draw a password form.
 *
 * Setting it up through `/counter/setup` also walks the setup race (design D4):
 * the session check fired by setup's own sign-in reads the row before the proof
 * lands, and must not sign the tablet out.
 */

const DEVICE_DOMAIN = '@device.shawarmania.invalid'

interface StoredSession {
  access_token: string
  user: { id: string; email: string }
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'admin.kalyani@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(response.ok(), 'admin.kalyani could not sign in').toBe(true)
  return ((await response.json()) as { access_token: string }).access_token
}

async function counterDevices(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
) {
  return request.post(`${SUPABASE_URL}/functions/v1/counter-devices`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
    data: body,
  })
}

async function storedSession(page: Page): Promise<StoredSession> {
  const raw = await page.evaluate(() => localStorage.getItem('shawarmania.auth'))
  expect(raw, 'the tablet holds no session').not.toBeNull()
  return JSON.parse(raw!) as StoredSession
}

/** A fresh counter tablet, set up from a code, open at `/counter`. */
async function setUpTablet(browser: Browser, request: APIRequestContext, token: string) {
  const label = `Keeps its login ${Date.now()}`
  const issued = await counterDevices(request, token, {
    action: 'issue-setup-code',
    outletId: OUTLET_KALYANI,
    label,
  })
  expect(issued.ok(), 'could not issue a setup code').toBe(true)
  const { code } = (await issued.json()) as { code: string }

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('counter/setup')
  await page.getByLabel('Setup code').fill(code)
  await page.getByRole('button', { name: 'Set up' }).click()
  await expect(page).toHaveURL(/\/counter$/)
  await expect(page.getByText(label, { exact: true })).toBeVisible()

  const session = await storedSession(page)
  expect(session.user.email.endsWith(DEVICE_DOMAIN)).toBe(true)
  return { context, page, session, label }
}

async function removeTablet(request: APIRequestContext, token: string, deviceId: string) {
  const removed = await counterDevices(request, token, { action: 'remove', deviceId })
  expect(removed.ok(), 'could not remove the test tablet').toBe(true)
}

test(
  'a set-up counter tablet opens sign-in and activation and lands on the counter, still itself',
  { tag: '@cg-on:a-tablet-keeps-its-login' },
  async ({ browser, request }) => {
    const token = await adminToken(request)
    const { context, page, session, label } = await setUpTablet(browser, request, token)
    try {
      // Watched over the whole visit, not read at the end: a flash is the bug.
      await page.addInitScript(() => {
        const seen = { password: false }
        ;(window as unknown as { __passwordSeen: typeof seen }).__passwordSeen = seen
        new MutationObserver(() => {
          if (document.querySelector('input[type=password]')) seen.password = true
        }).observe(document, { childList: true, subtree: true })
      })

      for (const address of ['sign-in', 'activate?code=x', 'owner', 'no-such-page']) {
        await page.goto(address)
        await expect(page).toHaveURL(/\/counter$/)
        await expect(page.getByText(label, { exact: true })).toBeVisible()
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { __passwordSeen: { password: boolean } }).__passwordSeen
                .password,
          ),
          `a password field was drawn at /${address}`,
        ).toBe(false)
      }

      // The same session, and it still works as the tablet.
      const after = await storedSession(page)
      expect(after.user.id).toBe(session.user.id)
      const own = await request.get(`${SUPABASE_URL}/rest/v1/counter_devices`, {
        headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${after.access_token}` },
        params: { id: `eq.${session.user.id}`, select: 'id' },
      })
      expect(own.ok()).toBe(true)
      expect(await own.json()).toEqual([{ id: session.user.id }])
    } finally {
      await context.close()
      await removeTablet(request, token, session.user.id)
    }
  },
)

test(
  'a set-up counter tablet still draws the sign-in form, as before',
  { tag: '@cg-off:a-tablet-keeps-its-login' },
  async ({ browser, request }) => {
    const token = await adminToken(request)
    const { context, page, session } = await setUpTablet(browser, request, token)
    try {
      await page.goto('sign-in')
      await expect(page).toHaveURL(/\/sign-in$/)
      await expect(page.locator('input[type=password]')).toBeVisible()
    } finally {
      await context.close()
      await removeTablet(request, token, session.user.id)
    }
  },
)
