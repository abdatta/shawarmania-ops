import { expect, test } from '@playwright/test'

const KAL = '00000000-0000-4000-a000-000000000001'
for (const width of [360, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`six-digit Overview amounts remain bold and fit at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      await page.clock.setFixedTime(new Date('2026-09-08T12:00:00+05:30'))
      // Deliberately extreme, deterministic read responses. No financial writes.
      await page.route('**/rest/v1/rpc/overview_*', async (route) => {
        const method = new URL(route.request().url()).pathname.split('/').at(-1)
        const args = route.request().postDataJSON()
        const body =
          method === 'overview_sales'
            ? { cashPaise: 55555555, upiPaise: 44444444 }
            : method === 'overview_drawer'
              ? { expectedPaise: 99999999, leftPaise: 88888888, spentPaise: 77777777 }
              : method === 'overview_expenses'
                ? args.p_outlet_id === KAL
                  ? 199999998
                  : 0
                : {
                    revenuePaise:
                      args.p_from === '2026-09-01'
                        ? 99999999
                        : args.p_outlet_id === KAL
                          ? 50000000
                          : 199999999,
                    hasSales: true,
                    provisional: false,
                    incomplete: false,
                  }
        await route.fulfill({ json: body })
      })
      await page.goto('sign-in')
      await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
      await page.reload()
      await page.getByLabel('Username or email', { exact: true }).fill('owner')
      await page.getByLabel('Password').fill('shawarmania-local')
      await page.getByRole('button', { name: 'Sign in' }).click()
      const card = page.getByTestId(`outlet-card-${KAL}`)
      await expect(card.getByTestId(`profit-${KAL}`)).toHaveText('-₹9,99,999')
      for (const metric of ['sales', 'cash', 'revenue', 'profit']) {
        const number = card.getByTestId(`${metric}-${KAL}`)
        expect(
          await number.evaluate((node) => Number(getComputedStyle(node).fontWeight)),
        ).toBeGreaterThanOrEqual(700)
        expect(
          await number.evaluate(
            (node) =>
              node.getBoundingClientRect().right <=
              node.parentElement!.nextElementSibling!.getBoundingClientRect().left,
          ),
        ).toBe(true)
      }
      await page.screenshot({ path: testInfo.outputPath('overview-extreme.png'), fullPage: true })
      const captions = card.getByTestId('metric-subtext')
      await expect(captions).toHaveCount(4)
      expect(
        await captions.evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              node.scrollWidth <= node.clientWidth + 1 &&
              node.getBoundingClientRect().height <=
                parseFloat(getComputedStyle(node).lineHeight) + 1,
          ),
        ),
      ).toBe(true)
      const headers = card.locator('a > p')
      await expect(headers).toHaveCount(4)
      expect(
        await headers.evaluateAll((nodes) =>
          nodes.every((node) => Number(getComputedStyle(node).fontWeight) >= 700),
        ),
      ).toBe(true)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })
  }
}
