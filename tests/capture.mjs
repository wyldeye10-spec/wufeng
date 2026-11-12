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
  await page.waitForTimeout(450)
  return { ctx, page }
}

async function create(page, kind, title, content) {
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByRole('button', { name: `新建${kind}` }).click()
  const sheet = page.locator('.studio__new-sheet')
  await sheet.waitFor({ state: 'visible' })
  await sheet.getByLabel('任务标题').fill(title)
  await sheet.getByLabel('任务细则').fill(content)
  await page.waitForTimeout(120)
  await sheet.getByRole('button', { name: '记下' }).click()
  await sheet.waitFor({ state: 'detached', timeout: 6000 })
  await page.waitForTimeout(200)
}

async function follow(page, title, content) {
  await page.getByRole('button', { name: '添加后续任务' }).click()
  const form = page.locator('.card__follow')
  await form.waitFor({ state: 'visible' })
  await form.getByLabel('任务标题').fill(title)
  await form.getByLabel('任务细则').fill(content)
  await form.getByRole('button', { name: '记下' }).click()
  await form.waitFor({ state: 'detached', timeout: 6000 })
  await page.waitForTimeout(200)
}

async function blur(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.mouse.move(8, 8)
}

const desktop = await context({ viewport: { width: 1440, height: 1360 }, deviceScaleFactor: 1 })
const d = desktop.page
await d.addStyleTag({ content: '.add-seal { display: none !important; }' })
await d.getByRole('button', { name: '编辑任务' }).click()
await d.waitForSelector('.studio')
await create(d, '故事', '夜渡寒江', '孤舟一盏灯，先寻渡口的老艄公。')
await d.locator('.card__open', { hasText: '夜渡寒江' }).click()
await follow(d, '艄公之死', '老艄公死在船头，手里攥着半枚铜钱。')
await follow(d, '铜钱指向', '铜钱背面刻着城南酒楼的暗记。')
await d.locator('.card__editor-close').click()
await create(d, '故事', '旧桥问剑', '桥下埋着半截断剑，剑上刻着父亲的名。')
await create(d, '轶闻', '酒楼听雨', '城南酒楼的说书人，知道二十年前的旧案。')
await create(d, '收集', '残页三张', '散在城隍庙、药铺与废宅里的残页。')
await d.waitForTimeout(300)
await d.screenshot({ path: 'screenshots/final-studio.png', fullPage: true })

await d.getByRole('button', { name: '返回卷宗' }).click()
await d.waitForTimeout(500)
await d.getByRole('button', { name: '盖印完成：夜渡寒江' }).click()
await d.getByRole('alertdialog').waitFor({ state: 'visible' })
await d.waitForTimeout(300)
await d.screenshot({ path: 'screenshots/final-confirm.png' })
await d.getByRole('alertdialog').getByRole('button', { name: '已了' }).click()
await d.waitForTimeout(1600)
await blur(d)
await d.evaluate(() => window.scrollTo(0, 0))
await d.waitForTimeout(250)
await d.screenshot({ path: 'screenshots/final-desktop.png' })

const mobile = await context({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const m = mobile.page
await m.addStyleTag({ content: '.add-seal { display: none !important; }' })
await m.getByRole('button', { name: '编辑任务' }).click()
await m.waitForSelector('.studio')
await create(m, '故事', '夜渡寒江', '孤舟一盏灯，先寻渡口的老艄公。')
await m.locator('.card__open', { hasText: '夜渡寒江' }).click()
await follow(m, '艄公之死', '老艄公死在船头，手里攥着半枚铜钱。')
await m.locator('.card__editor-close').click()
await create(m, '轶闻', '酒楼听雨', '城南酒楼的说书人，知道二十年前的旧案。')
await create(m, '收集', '残页三张', '散在城隍庙、药铺与废宅里的残页。')
await m.waitForTimeout(300)
await m.screenshot({ path: 'screenshots/final-mobile-studio.png', fullPage: true })
await m.getByRole('button', { name: '返回卷宗' }).click()
await m.waitForTimeout(600)
await blur(m)
await m.evaluate(() => window.scrollTo(0, 0))
await m.waitForTimeout(250)
await m.screenshot({ path: 'screenshots/final-mobile.png' })

await browser.close()
console.log('final screenshots done')
