/**
 * 视觉截图脚本（可选）。
 * 先运行 `npm run build && npm run preview`，再运行 `npm run capture`。
 * 会使用示例卷宗覆盖 screenshots/final-*.png。
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const base = 'http://127.0.0.1:4173/'
await mkdir('screenshots', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function context(options) {
  const ctx = await browser.newContext({
    colorScheme: 'dark',
    locale: 'zh-CN',
    reducedMotion: 'no-preference',
    ...options,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (error) => console.log('[pageerror]', error.message))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  return { ctx, page }
}

async function add(page, title, content) {
  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(420)
  await page.getByLabel('事项标题').fill(title)
  await page.getByLabel('事项内容').fill(content)
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: '记下' }).click()
  await page.locator('.composer').waitFor({ state: 'detached' })
  await page.waitForTimeout(750)
}

async function blur(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.mouse.move(8, 8)
}

const desktop = await context({ viewport: { width: 1440, height: 1180 }, deviceScaleFactor: 1 })
const d = desktop.page
await add(d, '赴约', '戌时三刻，城南旧桥。带上那柄断刃。')
await add(d, '寻人', '问遍西市茶肆，只知她曾往北去，着青衣。')
await add(d, '还书', '《寒山拾得》，三日后归架。')
await add(d, '磨刀', '青石上三寸水，刀锋不必太利。')
await d.getByRole('button', { name: '盖印完成：还书' }).click({ noWaitAfter: true })
await d.waitForTimeout(1200)
await blur(d)
await d.screenshot({ path: 'screenshots/final-desktop.png' })

// 卷纸编辑层
await d.getByRole('button', { name: '新增事项' }).click()
await d.waitForTimeout(500)
await d.getByLabel('事项标题').fill('夜行')
await d.getByLabel('事项内容').fill('城北旧巷，灯灭之后再入。')
await d.waitForTimeout(250)
await d.screenshot({ path: 'screenshots/final-composer.png' })
await d.getByRole('button', { name: '关闭编辑' }).click()
await d.waitForTimeout(350)

// 二次确认
await d.getByRole('button', { name: '编辑：磨刀' }).click()
await d.waitForTimeout(500)
await d.getByRole('button', { name: '抹去此事' }).click()
await d.waitForTimeout(350)
await d.screenshot({ path: 'screenshots/final-confirm.png' })

// 移动端首页
const mobile = await context({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const m = mobile.page
await add(m, '寻人', '问遍西市茶肆，只知她曾往北去，着青衣。')
await add(m, '赴约', '戌时三刻，城南旧桥。带上那柄断刃。')
await m.getByRole('button', { name: '盖印完成：寻人' }).click({ noWaitAfter: true })
await m.waitForTimeout(1200)
await blur(m)
await m.screenshot({ path: 'screenshots/final-mobile.png' })

// 移动端卷纸
await m.getByRole('button', { name: '新增事项' }).click()
await m.waitForTimeout(450)
await m.getByLabel('事项标题').fill('夜行')
await m.getByLabel('事项内容').fill('城北旧巷，灯灭之后再入。')
await m.waitForTimeout(250)
await m.screenshot({ path: 'screenshots/final-mobile-composer.png' })

await browser.close()
console.log('final screenshots done')
