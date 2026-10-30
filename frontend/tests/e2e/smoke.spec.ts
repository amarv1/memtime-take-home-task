import { expect, test } from '@playwright/test'

const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()

test('signs in and out with the API mocked', async ({ page }) => {
  let signedIn = false
  await page.route('**/api/session', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      const { apiKey } = route.request().postDataJSON() as { apiKey: string }
      if (apiKey !== 'good-key') {
        return route.fulfill({ status: 401, json: { error: 'Invalid API key' } })
      }
      signedIn = true
      return route.fulfill({ json: { expiresAt } })
    }
    if (method === 'DELETE') {
      signedIn = false
      return route.fulfill({ status: 204 })
    }
    return signedIn
      ? route.fulfill({ json: { expiresAt } })
      : route.fulfill({ status: 401, json: { error: 'Not signed in' } })
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)

  const apiKey = page.getByLabel('API key', { exact: true })
  await apiKey.fill('bad-key')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText("wasn't accepted")

  await apiKey.fill('good-key')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})
