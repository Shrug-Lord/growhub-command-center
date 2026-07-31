import fs from 'node:fs/promises'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

async function expectNoAxeViolations(page, context) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    results.violations,
    `${context}: ${results.violations.map((entry) => `${entry.id} (${entry.nodes.length})`).join(', ')}`,
  ).toEqual([])
}

test('operator setup, control, diagnostics, and responsive shell @smoke @a11y', async ({
  page,
}) => {
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const response = await page.goto('/')
  const responseHeaders = await response.allHeaders()
  expect(responseHeaders['content-security-policy']).toContain("frame-ancestors 'none'")
  await expect(page.getByRole('heading', { name: 'Growhub Command Center' })).toBeVisible()
  await expect(page.getByText('Create the local administrator')).toBeVisible()
  await expectNoAxeViolations(page, 'first-run setup')

  await page.getByLabel('Password', { exact: true }).fill('bench password 2026')
  await page.getByLabel('Confirm password').fill('bench password 2026')
  await page.getByRole('button', { name: 'Create administrator' }).click()
  await expect(page.getByText('Administrator created. Sign in to continue.')).toBeVisible()

  await page.getByLabel('Password', { exact: true }).fill('bench password 2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Device setup' })).toBeVisible()
  await expect(page.getByText('Bench Growhub')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Bench Growhub, Setup needs review' }),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Outlet 1 assignment' })).toHaveValue('Light')
  await expect(page.getByRole('textbox', { name: 'Outlet 4 label' })).toHaveValue('Reservoir Pump')
  await expectNoAxeViolations(page, 'device dashboard')

  await page.getByRole('textbox', { name: 'Outlet 4 label' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Confirm current setup' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Setup confirmed', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'manual', exact: true }).click()
  await expect(
    page.getByText('MANUAL pauses schedule evaluation and enables direct outlet control.'),
  ).toBeVisible({
    timeout: 8_000,
  })
  const canopyControl = page.getByRole('button', { name: /Canopy Light Outlet 1 - Light/ })
  await expect(canopyControl).toBeEnabled()
  await canopyControl.click()
  if (process.env.GROWHUB_SCREENSHOT_PATH) {
    await page.waitForTimeout(250)
    await page.locator('main').evaluate((element) => element.scrollTo(0, 0))
    const screenshotPath = path.resolve(process.env.GROWHUB_SCREENSHOT_PATH)
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath })
  }
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /Diagnostics/ }).click()
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible()
  await expect(page.getByText('schedule_state', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible()
  await expectNoAxeViolations(page, 'diagnostics')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = await downloadPromise
  const bundle = JSON.parse(await fs.readFile(await download.path(), 'utf8'))
  expect(bundle.meta.export_redacted).toBe(true)
  expect(bundle.meta.contains_local_device_identifiers).toBe(true)
  expect(JSON.stringify(bundle)).not.toContain('bench password 2026')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible()
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
  if (process.env.GROWHUB_MOBILE_SCREENSHOT_PATH) {
    const screenshotPath = path.resolve(process.env.GROWHUB_MOBILE_SCREENSHOT_PATH)
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath })
  }
  expect(consoleErrors).toEqual([])
})
