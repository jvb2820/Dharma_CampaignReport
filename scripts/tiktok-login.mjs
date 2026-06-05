import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const profilePath = resolve('.auth/tiktok-profile')
const businessCenterUrl =
  'https://business.tiktok.com/manage/overview?org_id=7223495844006363137&attr_source=TTAM_account_list&attr_type=web'

await mkdir(profilePath, { recursive: true })

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  viewport: { width: 1440, height: 920 },
})
const page = await context.newPage()

await page.goto('https://ads.tiktok.com/i18n/home', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await page.waitForTimeout(2_000)
await selectBusinessCenterIfNeeded(page)

if (!page.url().includes('business.tiktok.com')) {
  await page.goto(businessCenterUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
}

console.log('A TikTok Business Center browser window is open.')
console.log('Log in, select Dharma Nutrition Clinic if needed, then close the browser window.')

await page.waitForEvent('close', { timeout: 0 })
await context.close()

console.log(`Saved TikTok Ads Manager session to ${profilePath}`)

async function selectBusinessCenterIfNeeded(page) {
  if (!(await page.getByText('Select an account').isVisible().catch(() => false))) {
    return
  }

  const businessCenter = page
    .getByText(/Dharma Nutrition Clinic|7223495844006363137/)
    .first()

  if (await businessCenter.isVisible().catch(() => false)) {
    await businessCenter.click()
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => null)
    await page.waitForTimeout(3_000)
  }
}
