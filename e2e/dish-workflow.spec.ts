import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'] as const) {
  test(`dish workflow review and shared Ready (${theme})`, async ({ page, context }, info) => {
    await context.addInitScript((theme) => localStorage.setItem('shawarmania.theme', theme), theme)
    await page.setViewportSize({ width: 1080, height: 810 })
    await page.goto('demo/biller')
    const rail = page.getByRole('list', { name: 'The pipeline' })
    await expect(rail.locator('article')).toHaveCount(6)
    await expect(rail.getByText('Prepared', { exact: true })).toHaveCount(0)
    await expect(rail.getByText('Table 6', { exact: true })).toBeVisible()
    await expect(rail.getByText('Table 9', { exact: true })).toBeVisible()
    await expect(rail.getByText('Takeaway', { exact: true })).toHaveCount(2)
    await expect(rail.getByTestId('order-age')).toHaveCount(6)
    const oldAge = page.getByTestId('open-order-104').getByTestId('order-age')
    await expect(oldAge).toHaveText('84')
    const ageCenter = await oldAge.evaluate((ring) => {
      const circle = ring.getBoundingClientRect()
      const text = ring.querySelector('text')!.getBoundingClientRect()
      return {
        x: Math.abs((text.left + text.right - circle.left - circle.right) / 2),
        y: Math.abs((text.top + text.bottom - circle.top - circle.bottom) / 2),
      }
    })
    expect(ageCenter.x).toBeLessThan(1)
    expect(ageCenter.y).toBeLessThan(1.5)
    await expect(oldAge.locator('text')).toHaveClass(/text-danger-critical/)
    await expect(
      page.getByTestId('open-order-104').getByRole('img', { name: /^Kitchen / }),
    ).toHaveCount(0)
    await expect(
      rail.locator('[data-testid^="order-reference-"]').getByRole('img', { name: 'Gold member' }),
    ).toBeVisible()
    const blueCap = rail.locator('article').filter({ hasText: 'Blue cap' })
    const readyDish = blueCap.getByRole('button', {
      name: 'Tick 1 Classic Chicken Shawarma',
      exact: true,
    })
    expect(await readyDish.evaluate((row) => getComputedStyle(row).animationName)).toBe('none')
    const checkboxColor = await readyDish
      .getByTestId('dish-checkbox')
      .evaluate((box) => getComputedStyle(box).borderColor)
    expect(checkboxColor).not.toBe(
      await blueCap
        .getByRole('button', { name: 'Tick 1 Classic Chicken Shawarma, No onion', exact: true })
        .getByTestId('dish-checkbox')
        .evaluate((box) => getComputedStyle(box).borderColor),
    )
    expect(
      await readyDish.evaluate((row) => getComputedStyle(row.lastElementChild!).borderColor),
    ).toBe('rgba(0, 0, 0, 0)')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await rail.evaluate((root) => getComputedStyle(root).animationName)).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const geometry = await blueCap.evaluate((card) => {
      const rows = Array.from(card.querySelectorAll('li')).map((row) => row.getBoundingClientRect())
      const top = card.querySelector('[data-testid="order-age"]')!.getBoundingClientRect()
      const bottom = card
        .querySelector('button[aria-label^="More actions"]')!
        .getBoundingClientRect()
      const bell = card.querySelector('[data-testid="kitchen-bell-slot"]')!.getBoundingClientRect()
      return {
        gap: rows[1]!.top - rows[0]!.bottom,
        bellOffset: Math.abs(
          (bell.top + bell.bottom) / 2 - (top.top + top.bottom + bottom.top + bottom.bottom) / 4,
        ),
      }
    })
    expect(geometry.gap).toBeGreaterThanOrEqual(5)
    expect(geometry.bellOffset).toBeLessThan(2)
    for (const cue of ['halo', 'pulse-dot', 'steady-dot']) {
      await page.getByRole('combobox', { name: 'Demo ready cue' }).selectOption(cue)
      await expect(readyDish.getByTestId('dish-ready-cue')).toHaveAttribute('data-cue', cue)
      await readyDish.hover()
      const cuePath = info.outputPath(`ready-cue-${cue}-${theme}.png`)
      await blueCap.screenshot({ path: cuePath })
      await info.attach(`ready-cue-${cue}-${theme}`, { path: cuePath, contentType: 'image/png' })
      const signals = await rail
        .getByTestId('dish-ready-cue')
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).opacity))
      expect(new Set(signals).size).toBe(1)
    }
    await page.getByRole('combobox', { name: 'Demo ready cue' }).selectOption('pulse-dot')
    const pulseSamples: { scale: number; opacity: number }[] = []
    const pulseStarted = Date.now()
    await expect
      .poll(
        async () => {
          pulseSamples.push(
            await readyDish.getByTestId('dish-ready-cue').evaluate((dot) => {
              const light = getComputedStyle(dot, '::before')
              return {
                scale: new DOMMatrixReadOnly(light.transform).a,
                opacity: Number.parseFloat(light.opacity),
              }
            }),
          )
          return Date.now() - pulseStarted
        },
        { intervals: [80], timeout: 5000 },
      )
      .toBeGreaterThan(2600)
    expect(Math.max(...pulseSamples.map((sample) => sample.opacity))).toBeGreaterThan(0.85)
    expect(Math.min(...pulseSamples.map((sample) => sample.opacity))).toBeLessThan(0.03)
    for (let index = 1; index < pulseSamples.length; index++) {
      const previous = pulseSamples[index - 1]!
      const current = pulseSamples[index]!
      // A new dot can start only after the old pulse has disappeared.
      if (current.scale < previous.scale - 0.01) expect(previous.opacity).toBeLessThan(0.05)
    }
    await expect
      .poll(
        () =>
          readyDish.getByTestId('dish-ready-cue').evaluate((dot) => {
            const light = getComputedStyle(dot, '::before')
            return (
              new DOMMatrixReadOnly(light.transform).a > 0.88 &&
              Number.parseFloat(light.opacity) > 0.2
            )
          }),
        { intervals: [30], timeout: 4000 },
      )
      .toBe(true)
    await blueCap.screenshot({ path: info.outputPath(`ready-fill-peak-${theme}.png`) })
    if (info.project.name === 'desktop') {
      const dish = blueCap.getByRole('button', { name: /^Untick/ })
      await dish.hover()
      await expect
        .poll(() => dish.evaluate((row) => getComputedStyle(row).boxShadow))
        .not.toBe('none')
      expect(await dish.evaluate((row) => getComputedStyle(row).cursor)).toBe('pointer')
      const spacing = await dish.evaluate((row) => {
        const box = row.getBoundingClientRect()
        const checkbox = row.querySelector('[data-testid="dish-checkbox"]')!.getBoundingClientRect()
        const quantity = row.querySelector('[data-testid="dish-quantity"]')!.getBoundingClientRect()
        const content = row.lastElementChild!.getBoundingClientRect()
        return {
          inset: checkbox.left - box.left,
          quantityOffset: quantity.left - box.left,
          right: content.right - box.right,
          overflow: row.scrollWidth - row.clientWidth,
          rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        }
      })
      expect(spacing.inset).toBeCloseTo(spacing.rem / 4, 1)
      // Move 0.25rem from the existing 0.375rem gap; the content's start stays put.
      expect(spacing.quantityOffset).toBeCloseTo(15 + 1 + spacing.rem * 0.75, 1)
      expect(Math.abs(spacing.right)).toBeLessThan(1)
      expect(spacing.overflow).toBe(0)
      const hoverPath = info.outputPath(`dish-hover-${theme}.png`)
      await blueCap.screenshot({ path: hoverPath })
      await info.attach(`dish-hover-${theme}`, { path: hoverPath, contentType: 'image/png' })
    }
    // Each column packs its own tickets instead of inheriting a neighbour's height.
    await expect
      .poll(() =>
        rail.evaluate((root) => {
          const columns = new Map<number, DOMRect[]>()
          for (const item of Array.from(root.children)) {
            if (!(item instanceof HTMLLIElement)) continue
            const box = item.getBoundingClientRect()
            const x = Math.round(box.left)
            const column = columns.get(x) ?? []
            column.push(box)
            columns.set(x, column)
          }
          return (
            columns.size === 2 &&
            [...columns.values()].every((column) =>
              column
                .sort((a, b) => a.top - b.top)
                .every(
                  (box, index) =>
                    index === 0 || Math.abs(box.top - column[index - 1]!.bottom - 8) < 1,
                ),
            )
          )
        }),
      )
      .toBe(true)
    await expect(page.getByRole('tablist', { name: 'Counter records' })).toHaveCount(0)
    const history = page.getByRole('region', { name: 'Bills this shift' })
    await expect
      .poll(() =>
        history.evaluate(
          (element) =>
            element.getBoundingClientRect().height <=
            element.parentElement!.getBoundingClientRect().height,
        ),
      )
      .toBe(true)
    const shot = async (name: string) => {
      const path = info.outputPath(`${name}-${theme}.png`)
      await page.screenshot({ path, fullPage: true })
      await info.attach(`${name}-${theme}`, { path, contentType: 'image/png' })
    }
    await shot('six-orders-A')
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('textbox', { name: /Order label/ }).fill('Window table')
    const composer = page.getByTestId('bill-panel')
    await expect(page.getByPlaceholder('Order Label', { exact: true })).toBeVisible()
    expect(
      await page
        .locator('label[for="order-label"]')
        .evaluate((label) => getComputedStyle(label).position),
    ).toBe('absolute')
    const item = composer.locator('li').first()
    expect(
      await item.evaluate((row) => {
        const fewer = row.querySelector('button[aria-label^="One fewer"]')!
        const more = row.querySelector('button[aria-label^="One more"]')!
        const note = row.querySelector('button[aria-label^="Note for"]')!
        return (
          fewer.parentElement === more.parentElement &&
          note === row.lastElementChild &&
          !!note.querySelector('svg.lucide-pencil')
        )
      }),
    ).toBe(true)
    await shot('new-composer')
    await page.getByRole('button', { name: 'Note for Classic Chicken Shawarma' }).click()
    await expect(page.getByRole('radio', { name: 'Only 1' })).toBeVisible()
    await shot('note-sheet-two')
    await page.getByRole('textbox', { name: 'Dish note' }).fill('No mayo')
    await page.getByRole('radio', { name: 'Only 1' }).check()
    await page.getByRole('button', { name: 'Save note' }).click()
    await page.getByRole('button', { name: 'Takeaway', exact: true }).click()
    await page.getByRole('button', { name: 'Enter Customer Info', exact: true }).click()
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await page.getByRole('button', { name: 'Order', exact: true }).click()
    const created = rail.locator('article').filter({ hasText: 'Window table' })
    await expect(created).toHaveCount(1)
    const kitchen = await context.newPage()
    await kitchen.setViewportSize({ width: 1080, height: 810 })
    await kitchen.goto('demo/kitchen')
    const mixed = page.getByTestId('open-order-97')
    const firstKitchen = mixed.locator('[data-kitchen="1"]')
    const secondKitchen = mixed.locator('[data-kitchen="2"]')
    await expect(firstKitchen).toHaveAttribute('data-kitchen-state', 'ready')
    await expect(secondKitchen).toHaveAttribute('data-kitchen-state', 'sent')
    const secondPosition = await secondKitchen.boundingBox()
    await kitchen.getByRole('combobox', { name: 'Demo kitchen' }).selectOption('2')
    const mixedTicket = kitchen.getByTestId('kitchen-card-97')
    await mixedTicket.getByRole('button', { name: 'ACK order 97', exact: true }).click()
    await expect(secondKitchen).toHaveAttribute('data-kitchen-state', 'acknowledged')
    await expect(firstKitchen).toHaveAttribute('data-kitchen-state', 'ready')
    await mixedTicket.getByRole('button', { name: 'Ready order 97', exact: true }).click()
    await expect(mixed.getByTestId('kitchen-pickup-bell')).toHaveCount(2)
    await mixed.getByRole('button', { name: 'Tick 1 Chicken Katsu Rice', exact: true }).click()
    await expect(secondKitchen).toHaveAttribute('data-kitchen-state', 'handed_over')
    await expect(secondKitchen.locator('svg')).toHaveCount(0)
    await expect(firstKitchen).toHaveAttribute('data-kitchen-state', 'ready')
    expect((await secondKitchen.boundingBox())?.y).toBeCloseTo(secondPosition!.y, 1)
    await mixed.getByRole('button', { name: 'Untick 1 Chicken Katsu Rice', exact: true }).click()
    await expect(secondKitchen).toHaveAttribute('data-kitchen-state', 'ready')
    await kitchen
      .getByTestId('kitchen-done-97-1')
      .getByRole('button', { name: 'Ready order 97', exact: true })
      .click()
    await expect(secondKitchen).toHaveAttribute('data-kitchen-state', 'acknowledged')
    await expect(firstKitchen).toHaveAttribute('data-kitchen-state', 'ready')
    await kitchen.getByRole('combobox', { name: 'Demo kitchen' }).selectOption('1')
    await expect(created).toHaveAttribute('data-testid', /^open-order-\d+$/)
    const number = (await created.getAttribute('data-testid'))!.replace('open-order-', '')
    const ticket = kitchen.getByTestId(`kitchen-card-${number}`)
    const done = kitchen.getByTestId(`kitchen-done-${number}-1`)
    await expect(ticket.getByText('No mayo', { exact: true })).toBeVisible()
    await expect(kitchen.getByText('Window table', { exact: true })).toHaveCount(0)
    const kitchenPath = info.outputPath(`kitchen-noted-${theme}.png`)
    await kitchen.screenshot({ path: kitchenPath, fullPage: true })
    const readyButton = ticket.getByRole('button', { name: /^Ready order/ })
    const circleSizes = await ticket.evaluate((card) => {
      const timer = card.querySelector('[data-testid="kitchen-wait"]')!.getBoundingClientRect()
      const button = card
        .querySelector('button[aria-label^="Ready order"]')!
        .getBoundingClientRect()
      return { timer: timer.width, ready: button.width }
    })
    expect(circleSizes.ready).toBeCloseTo(circleSizes.timer, 2)
    await expect(readyButton.locator('circle').first()).toHaveAttribute('r', '21')
    await expect(readyButton.locator('svg.lucide-check')).toBeVisible()
    await readyButton.click()
    await expect(done).toHaveAttribute('data-collapsed', 'true')
    await expect(done).toHaveClass(/bg-surface-raised/)
    await expect(done.getByTestId('kitchen-wait')).toHaveCount(0)
    await expect(done.getByRole('button', { name: /^Ready order/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(
      done
        .getByRole('button', { name: /^Ready order/ })
        .locator('circle')
        .first(),
    ).toHaveAttribute('r', '21')
    await expect(created.locator('[data-ready="true"]')).toHaveCount(2, { timeout: 2500 })
    await expect(created.getByTestId('kitchen-pickup-bell')).toBeVisible()
    await kitchen.screenshot({
      path: info.outputPath(`kitchen-collapsed-${theme}.png`),
      fullPage: true,
    })
    // The whole collapsed card expands; the arrow also remains keyboard-accessible.
    await done.locator('header > span').click()
    await expect(done.getByText('No mayo', { exact: true })).toBeVisible()
    await kitchen.screenshot({
      path: info.outputPath(`kitchen-expanded-${theme}.png`),
      fullPage: true,
    })
    await done.getByText('No mayo', { exact: true }).click()
    await expect(done).toHaveAttribute('data-collapsed', 'true')
    await done.locator('header > span').click()
    await expect(done.getByText('No mayo', { exact: true })).toBeVisible()
    await kitchen.waitForTimeout(6000)
    await expect(done).toBeVisible()
    await done.getByRole('button', { name: /^Ready order/ }).click()
    await expect(ticket).toBeVisible()
    await expect(done).toHaveCount(0)
    await expect(created.locator('[data-ready="true"]')).toHaveCount(0)
    await readyButton.click()
    await expect(done).toHaveAttribute('data-collapsed', 'true')
    await expect(created.locator('[data-ready="true"]')).toHaveCount(2)
    await shot('ready')
    await created.getByRole('button', { name: /^Tick.*No mayo/ }).click()
    const ticked = created.getByRole('button', { name: /^Untick.*No mayo/ })
    expect(await ticked.evaluate((row) => getComputedStyle(row).animationName)).toBe('none')
    await expect(ticked.getByTestId('dish-quantity')).toHaveText('1')
    const checkboxSize = await ticked
      .getByTestId('dish-checkbox')
      .evaluate((box) => box.getBoundingClientRect().width)
    expect(checkboxSize).toBeLessThanOrEqual(17)
    await expect(created.locator('[data-ready="true"]')).toHaveCount(1)
    await expect(done).toBeVisible()
    await created
      .getByRole('button', { name: 'Tick 1 Classic Chicken Shawarma', exact: true })
      .click()
    await expect(done).toHaveCount(0)
    await expect(created.getByTestId('kitchen-pickup-bell')).toHaveCount(0)
    await created.getByRole('button', { name: /^Untick.*No mayo/ }).click()
    await expect(done).toHaveAttribute('data-collapsed', 'true')
    await expect(done.getByRole('button', { name: /^Ready order/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await created.getByRole('button', { name: /More actions/ }).click()
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await shot('edit-composer')
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    const save = page.getByRole('button', { name: 'Save', exact: true })
    expect(await save.evaluate((button) => getComputedStyle(button).whiteSpace)).toBe('nowrap')
    await save.click()
    await expect(ticket).toBeVisible()
    await expect(ticket).toContainText('· 2')
    await expect(done).toBeVisible()
    await kitchen.screenshot({
      path: info.outputPath(`kitchen-ticket-2-${theme}.png`),
      fullPage: true,
    })
    // Finish a middle Done receipt from the counter and inspect its held slot.
    const middle = kitchen.getByTestId('kitchen-done-98-1')
    const readSlots = () =>
      middle.evaluate((card) => {
        const slot = card.parentElement!
        const grid = slot.parentElement!
        return {
          index: Array.from(grid.children).indexOf(slot),
          neighbors: Array.from(grid.children)
            .filter((child) => child !== slot)
            .map((child) => ({
              id: child.querySelector('article')!.getAttribute('data-order-id'),
              top: (child as HTMLElement).offsetTop,
              left: (child as HTMLElement).offsetLeft,
            })),
        }
      })
    const slotsBefore = await readSlots()
    // Capture the short exit phases in the browser itself. Driver round trips
    // can otherwise read a detached card after the 180ms gap has ended.
    const masonry = kitchen.getByTestId('kitchen-masonry')
    await masonry.evaluate((grid) => {
      const proof: {
        phase: string | null
        visibility: string
        index: number
        neighbors: { id: string | null; top: number; left: number }[]
      }[] = []
      const observer = new MutationObserver(() => {
        const card = grid.querySelector('[data-testid="kitchen-done-98-1"]')
        if (!card) return
        const slot = card.parentElement!
        const phase = card.getAttribute('data-ready-phase')
        proof.push({
          phase,
          visibility: getComputedStyle(slot).visibility,
          index: Array.from(grid.children).indexOf(slot),
          neighbors: Array.from(grid.children)
            .filter((child) => child !== slot)
            .map((child) => ({
              id: child.querySelector('article')!.getAttribute('data-order-id'),
              top: (child as HTMLElement).offsetTop,
              left: (child as HTMLElement).offsetLeft,
            })),
        })
        ;(grid as HTMLElement).dataset.exitProof = JSON.stringify(proof)
        if (phase === 'gap') observer.disconnect()
      })
      observer.observe(grid, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-ready-phase'],
      })
    })
    await readyDish.click()
    await expect(middle).toHaveCount(0)
    const proof = JSON.parse((await masonry.getAttribute('data-exit-proof'))!) as {
      phase: string
      visibility: string
      index: number
      neighbors: typeof slotsBefore.neighbors
    }[]
    const slotsDuringExit = proof.find((step) => step.phase === 'leaving')!
    expect(slotsDuringExit).toBeDefined()
    expect(slotsDuringExit.index).toBe(slotsBefore.index)
    expect(slotsDuringExit.neighbors).toEqual(slotsBefore.neighbors)
    expect(proof.find((step) => step.phase === 'gap')?.visibility).toBe('hidden')
    for (const width of [1080, 1600, 390]) {
      await kitchen.setViewportSize({ width, height: 844 })
      await expect
        .poll(() =>
          kitchen.getByTestId('kitchen-masonry').evaluate((root) => {
            const columns = new Map<number, DOMRect[]>()
            for (const item of Array.from(root.children)) {
              const box = item.getBoundingClientRect()
              const x = Math.round(box.left)
              columns.set(x, [...(columns.get(x) ?? []), box])
            }
            return [...columns.values()].every((column) =>
              column
                .sort((a, b) => a.top - b.top)
                .every(
                  (box, index) =>
                    index === 0 || Math.abs(box.top - column[index - 1]!.bottom - 16) < 1,
                ),
            )
          }),
        )
        .toBe(true)
    }
    await expect(page.getByRole('combobox', { name: 'Demo totals placement' })).toHaveCount(0)
    await expect(page.getByTestId('demo-search-totals')).toHaveCount(0)
    await expect(page.getByTestId('counter-status')).not.toContainText('Total')
    await expect(page.getByTestId('demo-header-total')).toHaveCount(0)
    const records = page.getByTestId('counter-records-columns')
    const expenses = page.getByRole('region', { name: 'Counter expenses' })
    const checkRecordsViewport = async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect
        .poll(() =>
          records.evaluate((root) => {
            const box = root.getBoundingClientRect()
            const banner = document
              .querySelector('[data-window-edge="top"]')!
              .getBoundingClientRect()
            const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
            return Math.max(
              Math.abs(box.bottom - (innerHeight - rem)),
              Math.abs(box.top - (banner.bottom + rem)),
            )
          }),
        )
        .toBeLessThan(2)
      expect(
        await page
          .getByTestId('counter-workspace')
          .evaluate((root) => root.getBoundingClientRect().bottom),
      ).toBeLessThan(0)
    }
    await expect(expenses).toBeVisible()
    const initialBillsWidth = await records.evaluate(
      (root) => root.lastElementChild!.getBoundingClientRect().width,
    )
    await page.getByRole('separator', { name: 'Resize order rail' }).press('ArrowLeft')
    await expect
      .poll(() => records.evaluate((root) => root.lastElementChild!.getBoundingClientRect().width))
      .toBe(initialBillsWidth + 16)
    expect(
      await records.evaluate((root) => {
        const [expenses, bills] = Array.from(root.children).map((child) =>
          child.getBoundingClientRect(),
        )
        const workspace = document.querySelector('[data-testid="counter-workspace"]')!
        const rail = workspace.lastElementChild!.getBoundingClientRect()
        const menu = workspace.firstElementChild!.getBoundingClientRect()
        return (
          expenses!.right < bills!.left &&
          Math.abs(bills!.top - expenses!.top) < 1 &&
          Math.abs(bills!.width - rail.width) < 1 &&
          Math.abs(expenses!.width - menu.width) < 1
        )
      }),
    ).toBe(true)
    await shot('expenses')
    await checkRecordsViewport()
    await page.screenshot({ path: info.outputPath(`records-viewport-${theme}.png`) })
    await page.setViewportSize({ width: 880, height: 810 })
    await checkRecordsViewport()
    expect(
      await records.evaluate((root) => {
        const [expenses, bills] = Array.from(root.children).map((child) =>
          child.getBoundingClientRect(),
        )
        return expenses!.right < bills!.left && Math.abs(bills!.top - expenses!.top) < 1
      }),
    ).toBe(true)
    await shot('records-narrow')
    await page.setViewportSize({ width: 390, height: 844 })
    await checkRecordsViewport()
    expect(
      await records.evaluate((root) => {
        const [expenses, bills] = Array.from(root.children).map((child) =>
          child.getBoundingClientRect(),
        )
        return (
          expenses!.right < bills!.left &&
          Math.abs(bills!.top - expenses!.top) < 1 &&
          root.scrollWidth > root.clientWidth &&
          document.documentElement.scrollWidth <= innerWidth
        )
      }),
    ).toBe(true)
    await records.evaluate((root) => {
      root.scrollLeft = root.scrollWidth - root.clientWidth
    })
    await expect
      .poll(() => page.getByTestId('counter-workspace').evaluate((root) => root.scrollLeft))
      .toBe(await records.evaluate((root) => root.scrollLeft))
    await shot('phone')
    await page.getByTestId('counter-workspace').evaluate((root) => {
      root.scrollLeft = 0
    })
    await expect.poll(() => records.evaluate((root) => root.scrollLeft)).toBe(0)
    await kitchen.setViewportSize({ width: 390, height: 844 })
    expect(await kitchen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    const phoneKitchen = info.outputPath(`kitchen-phone-${theme}.png`)
    await kitchen.screenshot({ path: phoneKitchen, fullPage: true })
    await info.attach('kitchen-phone', {
      path: phoneKitchen,
      contentType: 'image/png',
    })
  })
}
