import { test, expect } from '@playwright/test'

// Smoke coverage for the flows a unit test can't see: the real build, real
// server, real browser. Each test uses its own task titles — the in-memory
// database is shared across the file.

test('quick-add detects a natural-language date and saves it', async ({ page }) => {
  await page.goto('/')
  const input = page.getByPlaceholder(/Add a task/)
  await input.fill('buy milk tomorrow 6pm')
  await expect(page.getByText('from “tomorrow 6pm”')).toBeVisible() // the chip
  await input.press('Enter')

  const row = page.locator('li', { hasText: 'buy milk' })
  await expect(row).toBeVisible()
  await expect(row.getByText(/Tomorrow/)).toBeVisible() // due date stored, title stripped
})

test('completing a task shows the undo toast, and undo restores it', async ({ page }) => {
  await page.goto('/')
  const input = page.getByPlaceholder(/Add a task/)
  await input.fill('finish e2e draft')
  await input.press('Enter')

  const row = page.locator('li', { hasText: 'finish e2e draft' })
  await row.getByRole('button', { name: 'Mark as done' }).click()
  await expect(page.getByText('Task completed')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('li', { hasText: 'finish e2e draft' })).toBeVisible()
})

test('search opens with / and finds tasks', async ({ page }) => {
  await page.goto('/')
  const input = page.getByPlaceholder(/Add a task/)
  await input.fill('water the ficus')
  await input.press('Enter')
  await expect(page.locator('li', { hasText: 'water the ficus' })).toBeVisible()

  // blur explicitly — the / shortcut ignores keystrokes while a field is focused
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('/')
  const search = page.getByPlaceholder('Search tasks and notes…')
  await expect(search).toBeVisible()
  await search.fill('ficus')
  await expect(
    page.locator('li', { hasText: 'water the ficus' }).last()
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).not.toBeVisible()
})

test('theme cycles into Wa mode', async ({ page }) => {
  await page.goto('/')
  const themeButton = page.getByTitle(/Theme:/).first()
  await themeButton.click() // auto → light
  await themeButton.click() // light → dark
  await themeButton.click() // dark → wa
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa')
  await expect(page.getByText('トドデス').first()).toBeVisible()
})

test('board shows the three columns', async ({ page }) => {
  await page.goto('/board')
  for (const column of ['To do', 'In progress', 'Done']) {
    await expect(page.getByRole('heading', { name: column })).toBeVisible()
  }
})

test('focus switches to Pomodoro with the round indicator', async ({ page }) => {
  await page.goto('/focus')
  await page.getByRole('button', { name: 'Pomodoro' }).click()
  await expect(page.getByText('Round 1 of 4')).toBeVisible()
  await expect(page.getByText('25 / 5')).toBeVisible()
})

test('completing a recurring task spawns the next occurrence', async ({ page, request }) => {
  // Due 2h ago so the task always renders (Overdue section) no matter the wall
  // clock; completing a daily task then spawns the next occurrence within 24h,
  // which always lands in Today or Tomorrow. A future "+26h" due date was flaky:
  // depending on the runner's timezone and hour, the task or its spawn could
  // overflow past the Tomorrow section and render in no section at all.
  const due = new Date(Date.now() - 2 * 3600_000).toISOString()
  await request.post('/api/tasks', {
    data: { title: 'water the bonsai', due_at: due, repeat: 'daily' },
  })

  await page.goto('/')
  const row = page.locator('li', { hasText: 'water the bonsai' })
  await expect(row.getByLabel('repeats daily')).toBeVisible()
  await row.getByRole('button', { name: 'Mark as done' }).click()
  await expect(page.getByText('Task completed')).toBeVisible()

  // the done task leaves the open list; what remains must be the SPAWNED
  // occurrence — an open task (its circle still says "Mark as done") that repeats
  const spawned = page.locator('li', { hasText: 'water the bonsai' })
  await expect(spawned).toHaveCount(1)
  await expect(spawned.getByRole('button', { name: 'Mark as done' })).toBeVisible()
  await expect(spawned.getByLabel('repeats daily')).toBeVisible()
})
