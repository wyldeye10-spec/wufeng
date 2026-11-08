import { chromium } from 'playwright-core'
import { preview } from 'vite'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 4174
const URL = `http://127.0.0.1:${PORT}/`
const SHOTS = path.join(ROOT, 'screenshots')

try {
  await access(path.join(ROOT, 'dist', 'index.html'))
} catch {
  console.error('未找到 dist/index.html，请先运行 npm run build')
  process.exit(2)
}

await mkdir(SHOTS, { recursive: true })

const server = await preview({
  preview: { host: '127.0.0.1', port: PORT, strictPort: true },
  logLevel: 'error',
})
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
const contexts = []
let activePage = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

function assertArray(actual, expected, message) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) {
    throw new Error(`${message}：期望 ${right}，实际 ${left}`)
  }
}

async function newPage(options = {}, initScript) {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    colorScheme: 'dark',
    locale: 'zh-CN',
    reducedMotion: 'no-preference',
    acceptDownloads: true,
    ...options,
  })
  contexts.push(context)
  if (initScript) await context.addInitScript(initScript)
  const page = await context.newPage()
  activePage = page
  page.on('pageerror', (error) => {
    console.log('[pageerror]', error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('[console.error]', message.text())
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(
    () => document.querySelector('.chapter--open') && !document.querySelector('.loading'),
    undefined,
    { timeout: 10000 },
  )
  return { context, page }
}

async function addMemo(page, title, content, pause = 100) {
  await page.getByRole('button', { name: '新增事项' }).click()
  // 等卷纸展开动画结束再输入，避免自动化在 380ms 开卷动画中抢写受控输入框。
  await page.waitForTimeout(420)
  await page.getByLabel('事项标题').fill(title)
  await page.getByLabel('事项内容').fill(content)
  await page.waitForFunction(
    ([t, c]) =>
      document.querySelector('.field__input--title')?.value === t &&
      document.querySelector('.field__input--content')?.value === c,
    [title, content],
    { timeout: 3000 },
  )
  await page.waitForTimeout(pause)
  await page.getByRole('button', { name: '记下' }).click()
  await page.locator('.composer').waitFor({ state: 'detached', timeout: 6000 })
  await page.waitForFunction(
    (t) =>
      Array.from(document.querySelectorAll('.memo__title')).some(
        (element) => element.textContent === t,
      ),
    title,
    { timeout: 4000 },
  )
  await page.waitForTimeout(120)
}

async function openEdit(page, title) {
  await page.getByRole('button', { name: `编辑：${title}` }).click()
  await page.locator('.sheet').waitFor({ state: 'visible' })
  await page.waitForTimeout(420)
}

async function waitForComposerGone(page) {
  await page.locator('.composer').waitFor({ state: 'detached', timeout: 6000 })
}

async function readStore(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('wufeng-juanzong')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const tx = database.transaction('memos', 'readonly')
      const request = tx.objectStore('memos').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return rows
  })
}

async function titles(page, selector) {
  return page.locator(`${selector} .memo__title`).allTextContents()
}

async function test(name, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`PASS  ${name}  (${Date.now() - started} ms)`)
  } catch (error) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    console.log(`FAIL  ${name}  (${Date.now() - started} ms)\n      ${error.message}`)
    if (activePage) {
      const safe = name.replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      await activePage
        .screenshot({ path: path.join(SHOTS, `fail-${safe}.png`), fullPage: true })
        .catch(() => {})
    }
  } finally {
    while (contexts.length) {
      const context = contexts.pop()
      await context.close().catch(() => {})
    }
    activePage = null
  }
}

// 1. 首页 / 空状态 / 无横向溢出
await test('首页 / 空状态 / 无横向溢出', async () => {
  const { page } = await newPage()
  assertEqual(await page.title(), '无锋 · 事有始终，念有归处', '文档标题')
  assertEqual(await page.locator('.masthead__title').getAttribute('aria-label'), '无锋', '卷首题名')
  assert(await page.getByText('事有始终，念有归处。').first().isVisible(), '卷首题记不可见')
  assert(await page.getByRole('heading', { name: '未竟之事' }).isVisible(), '未竟之事标题缺失')
  assert(await page.getByRole('heading', { name: '已了之事' }).isVisible(), '已了之事标题缺失')
  assert(await page.getByText('此间暂无未竟之事。').isVisible(), '未竟空状态文案缺失')
  assert(await page.getByText('尚无已了之事。').isVisible(), '已了空状态文案缺失')
  assert(await page.getByRole('button', { name: '新增事项' }).isVisible(), '新增朱印缺失')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert(overflow <= 1, `存在横向滚动：${overflow}px`)
  await page.screenshot({ path: path.join(SHOTS, 'final-desktop-empty.png'), fullPage: true })
})

// 2. 新增 / 字数 / Emoji 字素 / 刷新保留
await test('新增 / 标题 8 字 / 内容 50 字 / Emoji 字素 / 刷新保留', async () => {
  const { page } = await newPage()
  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(420)
  assertEqual(await page.locator('.field__count').nth(0).textContent(), '0/8', '标题初始计数')
  assertEqual(await page.locator('.field__count').nth(1).textContent(), '0/50', '内容初始计数')

  await page.getByLabel('事项标题').fill('一二三四五六七八九十')
  assertEqual(await page.getByLabel('事项标题').inputValue(), '一二三四五六七八', '标题截断')
  assertEqual(await page.locator('.field__count').nth(0).textContent(), '8/8', '标题计数')

  await page.getByLabel('事项内容').fill('一二三四五六七八九十'.repeat(6))
  assertEqual(
    await page.getByLabel('事项内容').inputValue(),
    '一二三四五六七八九十'.repeat(5),
    '内容截断',
  )
  assertEqual(await page.locator('.field__count').nth(1).textContent(), '50/50', '内容计数')

  const family = '👨‍👩‍👧‍👦'
  await page.getByLabel('事项标题').fill(family.repeat(9))
  const titleValue = await page.getByLabel('事项标题').inputValue()
  const titleCount = await page.evaluate(
    (value) =>
      Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(value)).length,
    titleValue,
  )
  assertEqual(titleCount, 8, '标题 Emoji 字素数')
  assert(titleValue.endsWith(family), '标题末尾的 Emoji 组合被截断')

  await page.getByLabel('事项内容').fill(family.repeat(55))
  const contentValue = await page.getByLabel('事项内容').inputValue()
  const contentCount = await page.evaluate(
    (value) =>
      Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(value)).length,
    contentValue,
  )
  assertEqual(contentCount, 50, '内容 Emoji 字素数')
  assert(contentValue.endsWith(family), '内容末尾的 Emoji 组合被截断')

  await page.getByRole('button', { name: '关闭编辑' }).click()
  await waitForComposerGone(page)

  await addMemo(page, '夜行', '城北旧巷，灯灭之后再入。')
  const rows = await readStore(page)
  assertEqual(rows.length, 1, '本地卷宗条目数')
  assertEqual(rows[0].title, '夜行', '持久化标题')
  assertEqual(rows[0].content, '城北旧巷，灯灭之后再入。', '持久化内容')
  assertEqual(rows[0].done, false, '新建默认未完成')
  assertEqual(rows[0].completedAt, null, '新建未完成时间')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.memo__title')?.textContent === '夜行')
  assert(await page.getByText('城北旧巷，灯灭之后再入。').isVisible(), '刷新后内容丢失')
  assertArray(await titles(page, '.chapter--open'), ['夜行'], '刷新后未竟事项')
})

// 3. 必填校验 / 编辑 / 不产生重复
await test('必填校验 / 编辑 / 不产生重复记录', async () => {
  const { page } = await newPage()
  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '记下' }).click()
  assertEqual(await page.locator('.sheet__error').textContent(), '题，不可空。', '空标题校验')
  assert(await page.locator('.composer').count(), '校验失败时不应关闭卷纸')
  await page.getByLabel('事项标题').fill('旧约')
  await page.getByRole('button', { name: '记下' }).click()
  assertEqual(await page.locator('.sheet__error').textContent(), '文，不可空。', '空内容校验')
  await page.getByLabel('事项内容').fill('三日后，渡口相见。')
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  await page.waitForFunction(() => document.querySelectorAll('.memo').length === 1)

  await openEdit(page, '旧约')
  assertEqual(await page.locator('.sheet__heading').textContent(), '改记', '编辑卷纸标题')
  assertEqual(await page.getByLabel('事项标题').inputValue(), '旧约', '编辑预填标题')
  assertEqual(await page.getByLabel('事项内容').inputValue(), '三日后，渡口相见。', '编辑预填内容')
  await page.getByLabel('事项标题').fill('旧约改')
  await page.getByLabel('事项内容').fill('三日后，渡口不见不散。')
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.memo').length === 1 &&
      document.querySelector('.memo__title')?.textContent === '旧约改',
  )
  assertEqual(await page.locator('.memo').count(), 1, '编辑后条目数')
  const rows = await readStore(page)
  assertEqual(rows.length, 1, '本地卷宗编辑后条数')
  assertEqual(rows[0].content, '三日后，渡口不见不散。', '编辑后内容')
})

// 4. 落印 / 保留 / 撤销 / 编辑保持完成
await test('朱印完成 / 内容保留 / 撤销 / 编辑不改变完成状态', async () => {
  const { page } = await newPage()
  await addMemo(page, '封刀', '此刀入鞘，不再出鞘。')

  await page.getByRole('button', { name: '盖印完成：封刀' }).click({ noWaitAfter: true })
  await page.locator('.stamp-fx__seal').waitFor({ state: 'attached', timeout: 900 })
  const animationName = await page.locator('.stamp-fx__seal').evaluate(
    (element) => getComputedStyle(element).animationName,
  )
  assertEqual(animationName, 'seal-drop', '落印动画名')

  // 先淡出未竟条目，再切到已了之事并淡入；两个阶段不能同时发生。
  await page.locator('.memo.is-leaving').waitFor({ state: 'attached', timeout: 2500 })
  assertEqual(
    await page.locator('.chapter--done .memo').count(),
    0,
    '未竟条目淡出完成前不应出现已了条目',
  )
  await page.locator('.memo.is-arriving').waitFor({ state: 'attached', timeout: 2500 })

  await page.waitForFunction(
    () =>
      document.querySelector('.chapter--done .memo__title')?.textContent === '封刀' &&
      !document.querySelector('.stamp-fx'),
    undefined,
    { timeout: 5000 },
  )
  const doneRow = page.locator('.chapter--done .memo').first()
  assert(await doneRow.getByText('此刀入鞘，不再出鞘。').isVisible(), '完成后内容未保留')
  const lineThrough = await doneRow.locator('.memo__title').evaluate(
    (element) => getComputedStyle(element).textDecorationLine,
  )
  assert(lineThrough.includes('line-through'), '完成后标题未加删除线')
  assert(await doneRow.locator('.memo__seal').isVisible(), '完成后未显示已了印章')
  assertEqual(await doneRow.locator('.memo__seal').textContent(), '已了', '已了印章文字')

  let rows = await readStore(page)
  assertEqual(rows.length, 1, '完成后仍保留记录')
  assertEqual(rows[0].done, true, '完成状态已持久化')
  assert(typeof rows[0].completedAt === 'number', '完成时间未持久化')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.chapter--done .memo__title'))
  assert(await page.getByText('此刀入鞘，不再出鞘。').isVisible(), '刷新后已完成内容丢失')
  assert(await page.locator('.memo.is-done').count(), '刷新后完成状态丢失')

  await page.getByRole('button', { name: '撤销完成：封刀' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () =>
      document.querySelector('.chapter--open .memo__title')?.textContent === '封刀' &&
      !document.querySelector('.memo.is-done'),
    undefined,
    { timeout: 5000 },
  )
  rows = await readStore(page)
  assertEqual(rows[0].done, false, '撤销后完成状态')
  assertEqual(rows[0].completedAt, null, '撤销后完成时间应清空')

  await page.getByRole('button', { name: '盖印完成：封刀' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () => document.querySelector('.chapter--done .memo__title')?.textContent === '封刀',
    undefined,
    { timeout: 5000 },
  )
  await openEdit(page, '封刀')
  await page.getByLabel('事项内容').fill('此刀已封，卷中留名。')
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  await page.waitForFunction(
    () =>
      document.querySelector('.chapter--done .memo__content')?.textContent ===
      '此刀已封，卷中留名。',
    undefined,
    { timeout: 5000 },
  )
  assertEqual(await page.locator('.memo.is-done').count(), 1, '编辑后应仍在已了之事')
  rows = await readStore(page)
  assertEqual(rows[0].done, true, '编辑后完成状态不应丢失')
})

// 5. 删除二次确认
await test('删除二次确认 / 留下 / 抹去 / 持久化', async () => {
  const { page } = await newPage()
  await addMemo(page, '留痕', '这一笔，且留着。')
  await openEdit(page, '留痕')
  await page.getByRole('button', { name: '抹去此事' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  assert((await dialog.textContent())?.includes('此事将从卷宗中抹去。'), '二次确认主文案缺失')
  assert((await dialog.textContent())?.includes('不可复得。'), '二次确认警示缺失')
  await dialog.getByRole('button', { name: '留下' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert(
    await page
      .locator('.chapter--open .memo__content')
      .filter({ hasText: '这一笔，且留着。' })
      .isVisible(),
    '选择留下后条目消失',
  )

  await page.getByRole('button', { name: '抹去此事' }).click()
  await page.evaluate(() => {
    window.__wufengDeleteProbe = { erasing: false, composerClosing: false, modalClosing: false }
    const observer = new MutationObserver(() => {
      const probe = window.__wufengDeleteProbe
      if (document.querySelector('.memo.is-erasing')) probe.erasing = true
      if (document.querySelector('.composer--closing')) probe.composerClosing = true
      if (document.querySelector('.modal--closing')) probe.modalClosing = true
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    })
  })
  await page.getByRole('alertdialog').getByRole('button', { name: '抹去' }).click()
  await page.locator('.composer--closing').waitFor({ state: 'attached', timeout: 2000 })
  const confirmModal = page.locator('.modal--confirm')
  assert(await confirmModal.isVisible(), '点击抹去后确认窗口不应瞬间消失')
  const modalAnimation = await confirmModal.evaluate(
    (element) => getComputedStyle(element).animationName,
  )
  assertEqual(modalAnimation, 'modal-fade-out', '确认窗口淡出动画')
  const composerAnimation = await page
    .locator('.composer--closing')
    .evaluate((element) => getComputedStyle(element).animationName)
  assertEqual(composerAnimation, 'composer-fade-out', '卷纸层淡出动画')
  await confirmModal.waitFor({ state: 'detached', timeout: 3000 })
  await waitForComposerGone(page)
  await page.waitForFunction(
    () => document.querySelectorAll('.memo').length === 0,
    undefined,
    { timeout: 5000 },
  )
  const deleteProbe = await page.evaluate(() => window.__wufengDeleteProbe)
  assert(deleteProbe.erasing, '删除时应出现条目墨迹消散')
  assert(
    deleteProbe.composerClosing && deleteProbe.modalClosing,
    '确认层与卷纸层应实际经过淡出状态',
  )
  assert(await page.getByText('此间暂无未竟之事。').isVisible(), '删除后未显示未竟空状态')
  assertEqual((await readStore(page)).length, 0, '删除后本地卷宗仍有余条')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.chapter--open'))
  assertEqual(await page.locator('.memo').count(), 0, '刷新后被删条目复现')
})

// 5b. 已了事项也可删除
await test('已了之事同样可以抹去', async () => {
  const { page } = await newPage()
  await addMemo(page, '旧印', '印落之后，亦可抹去。')
  await page.getByRole('button', { name: '盖印完成：旧印' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () => document.querySelector('.chapter--done .memo__title')?.textContent === '旧印',
    undefined,
    { timeout: 5000 },
  )
  await openEdit(page, '旧印')
  await page.getByRole('button', { name: '抹去此事' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '抹去' }).click()
  await waitForComposerGone(page)
  await page.waitForFunction(
    () => document.querySelectorAll('.memo').length === 0,
    undefined,
    { timeout: 5000 },
  )
  assert(await page.getByText('尚无已了之事。').isVisible(), '已了空状态未恢复')
  assertEqual((await readStore(page)).length, 0, '已了事项删除后仍有残留')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.chapter--open'))
  assertEqual(await page.locator('.memo').count(), 0, '刷新后已了事项复现')
})

// 7. 排序
await test('排序 / 完成迁移 / 撤销归位', async () => {
  const { page } = await newPage()
  await addMemo(page, '甲一', '第一笔。')
  await page.waitForTimeout(60)
  await addMemo(page, '乙二', '第二笔。')
  await page.waitForTimeout(60)
  await addMemo(page, '丙三', '第三笔。')
  assertArray(await titles(page, '.chapter--open'), ['丙三', '乙二', '甲一'], '未竟排序')

  await page.getByRole('button', { name: '盖印完成：乙二' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () => document.querySelectorAll('.chapter--done .memo').length === 1,
    undefined,
    { timeout: 5000 },
  )
  assertArray(await titles(page, '.chapter--open'), ['丙三', '甲一'], '完成后未竟排序')
  assertArray(await titles(page, '.chapter--done'), ['乙二'], '完成后已了排序')

  await page.getByRole('button', { name: '盖印完成：甲一' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () => document.querySelectorAll('.chapter--done .memo').length === 2,
    undefined,
    { timeout: 5000 },
  )
  assertArray(await titles(page, '.chapter--done'), ['乙二', '甲一'], '已了按创建时间倒序')

  await page.getByRole('button', { name: '撤销完成：乙二' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.chapter--open .memo').length === 2 &&
      document.querySelectorAll('.chapter--done .memo').length === 1,
    undefined,
    { timeout: 5000 },
  )
  assertArray(await titles(page, '.chapter--open'), ['丙三', '乙二'], '撤销后未竟排序')
  assertArray(await titles(page, '.chapter--done'), ['甲一'], '撤销后已了排序')
})

// 8. 中文输入法
await test('中文输入法组合 / 提交 / 组合期间不截断', async () => {
  const { page, context } = await newPage()
  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(420)
  await page.getByLabel('事项标题').click()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: 'ceshi',
    selectionStart: 5,
    selectionEnd: 5,
    replacementStart: 0,
    replacementEnd: 0,
  })
  await page.waitForTimeout(80)
  assertEqual(await page.getByLabel('事项标题').inputValue(), 'ceshi', '组合期间拼音被截断')
  assertEqual(await page.locator('.field__count').nth(0).textContent(), '5/8', '组合期间计数')

  await cdp.send('Input.imeSetComposition', {
    text: '测试',
    selectionStart: 2,
    selectionEnd: 2,
    replacementStart: 0,
    replacementEnd: 5,
  })
  await page.waitForTimeout(80)
  assertEqual(await page.getByLabel('事项标题').inputValue(), '测试', '候选字未写入')
  await cdp.send('Input.insertText', { text: '测试' })
  await page.waitForTimeout(120)
  assertEqual(await page.getByLabel('事项标题').inputValue(), '测试', '提交后出现重复文本')

  await page.keyboard.type('一二三四五六七')
  await page.waitForTimeout(150)
  assertEqual(await page.getByLabel('事项标题').inputValue(), '测试一二三四五六', '8 字上限失效')
  assertEqual(await page.locator('.field__count').nth(0).textContent(), '8/8', '提交后计数')
})

// 9. 关闭后重开
await test('关闭页面后重新打开仍保留记录', async () => {
  const { context, page } = await newPage()
  await addMemo(page, '长夜', '灯下留书，明日再读。')
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(URL, { waitUntil: 'networkidle' })
  await reopened.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '长夜',
    undefined,
    { timeout: 6000 },
  )
  assert(await reopened.getByText('灯下留书，明日再读。').isVisible(), '重开后内容丢失')
  activePage = reopened
})

// 10. 导出卷宗
await test('导出卷宗 / JSON 结构与下载文件名', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await addMemo(page, '导出未竟', '未竟之事，也要留底。')
  await addMemo(page, '导出已了', '已了之事，封入朱印。')
  await page.getByRole('button', { name: '盖印完成：导出已了' }).click({ noWaitAfter: true })
  await page.waitForTimeout(1800)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出卷宗' }).click()
  const download = await downloadPromise
  assert(
    /^wufeng-backup-\d{8}-\d{4}\.json$/.test(download.suggestedFilename()),
    `导出文件名不符合预期：${download.suggestedFilename()}`,
  )
  const file = await download.path()
  assert(file, '下载文件没有落盘')
  const archive = JSON.parse(await readFile(file, 'utf8'))
  assertEqual(archive.app, '无锋', '备份应用名')
  assertEqual(archive.format, 'wufeng-journal', '备份格式')
  assertEqual(archive.version, 2, '备份版本')
  assert(Array.isArray(archive.memos), '备份 memos 不是数组')
  assertEqual(archive.memos.length, 2, '备份记录数')

  const open = archive.memos.find((memo) => memo.title === '导出未竟')
  const done = archive.memos.find((memo) => memo.title === '导出已了')
  assert(open && open.done === false && open.completedAt === null, '未竟记录状态不正确')
  assertEqual(open.icon, 'gold-sword', '默认印记')
  assert(
    done && done.done === true && typeof done.completedAt === 'number',
    '已了记录状态不正确',
  )
  assertEqual(open.content, '未竟之事，也要留底。', '未竟正文')
  assertEqual(done.content, '已了之事，封入朱印。', '已了正文')
})

// 11. 导入卷宗
await test('导入卷宗 / 取消 / 并入与同号覆盖 / 持久化 / 非法文件拒绝', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await addMemo(page, '原有', '旧文留在卷中。')
  const stored = await readStore(page)
  const existing = stored.find((memo) => memo.title === '原有')
  assert(existing, '未读到原有记录')

  const base = Date.now()
  const backup = {
    app: '无锋',
    format: 'wufeng-journal',
    version: 2,
    exportedAt: new Date().toISOString(),
    memos: [
      {
        id: existing.id,
        title: '原有',
        content: '备份里的新文。',
        icon: 'purple-sword',
        done: false,
        createdAt: existing.createdAt,
        completedAt: null,
      },
      {
        id: 'import-open-1',
        title: '并入',
        content: '从备份并入的未竟。',
        icon: 'white-scroll',
        done: false,
        createdAt: base + 1000,
        completedAt: null,
      },
      {
        id: 'import-done-1',
        title: '旧印',
        content: '从备份带来的已了。',
        icon: 'gold-sword',
        done: true,
        createdAt: base + 2000,
        completedAt: base + 3000,
      },
    ],
  }
  const buffer = Buffer.from(JSON.stringify(backup), 'utf8')
  const openImport = async () => {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入卷宗' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({ name: 'wufeng-backup-test.json', mimeType: 'application/json', buffer })
  }

  await openImport()
  let dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  const note = (await dialog.textContent()) ?? ''
  assert(note.includes('新增 2 条'), `导入摘要缺少新增数：${note}`)
  assert(note.includes('覆盖 1 条同号旧记'), `导入摘要缺少覆盖数：${note}`)
  await page.waitForTimeout(450)
  await page.screenshot({ path: path.join(SHOTS, 'final-import-dialog.png') })

  await dialog.getByRole('button', { name: '再想想' }).click()
  await dialog.waitFor({ state: 'detached' })
  assertEqual(await page.locator('.memo').count(), 1, '取消导入不应改动卷宗')

  await openImport()
  dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '并入' }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.chapter--open .memo__title')).some(
        (element) => element.textContent === '并入',
      ),
    undefined,
    { timeout: 6000 },
  )

  assertArray(await titles(page, '.chapter--open'), ['并入', '原有'], '并入后的未竟列表')
  assertArray(await titles(page, '.chapter--done'), ['旧印'], '并入后的已了列表')
  assert(await page.getByText('备份里的新文。').isVisible(), '同号旧记未被覆盖')
  assertEqual(await page.getByText('旧文留在卷中。').count(), 0, '旧正文不应残留')
  assertEqual(
    await page.locator('.memo', { hasText: '原有' }).locator('.memo-mark--purple-sword').count(),
    1,
    '同号旧记的印记未更新',
  )
  assertEqual(
    await page.locator('.memo', { hasText: '并入' }).locator('.memo-mark--white-scroll').count(),
    1,
    '导入记录的印记错误',
  )

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.chapter--open .memo__title')).some(
        (element) => element.textContent === '并入',
      ),
    undefined,
    { timeout: 6000 },
  )
  assertArray(await titles(page, '.chapter--open'), ['并入', '原有'], '刷新后的未竟列表')
  assertArray(await titles(page, '.chapter--done'), ['旧印'], '刷新后的已了列表')

  const before = await page.locator('.memo').count()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入卷宗' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'not-a-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}', 'utf8'),
  })
  await page.getByText('导入失败：这不是无锋的卷宗备份。').waitFor({ timeout: 4000 })
  assertEqual(await page.locator('.memo').count(), before, '非法文件不应改动卷宗')
  assertEqual(await page.getByRole('alertdialog').count(), 0, '非法文件不应打开确认框')
})

// 12. PWA
await test('PWA 清单 / 图标 / 离线重载', async () => {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } })
  await addMemo(page, '离线试记', '断网之后，此卷仍在。')

  const manifest = await page.evaluate(async () => {
    const response = await fetch('./manifest.webmanifest')
    return { status: response.status, body: await response.json() }
  })
  assertEqual(manifest.status, 200, 'manifest 状态码')
  assertEqual(manifest.body.name, '无锋 · 私人卷宗', 'manifest 名称')
  assertEqual(manifest.body.display, 'standalone', 'manifest 显示模式')
  assertEqual(manifest.body.start_url, './', 'manifest start_url')
  assertEqual(manifest.body.icons.length, 3, 'manifest 图标数量')

  const iconResults = await page.evaluate(async (icons) => {
    return Promise.all(
      icons.map(
        (icon) =>
          new Promise((resolve) => {
            const image = new Image()
            image.onload = () => resolve({ src: icon.src, width: image.naturalWidth })
            image.onerror = () => resolve({ src: icon.src, width: 0 })
            image.src = icon.src
          }),
      ),
    )
  }, manifest.body.icons)
  assert(
    iconResults.every((icon) => icon.width >= 192),
    `manifest 图标未正确加载：${JSON.stringify(iconResults)}`,
  )

  const sw = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return {
      active: registration.active?.state,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    }
  })
  assertEqual(sw.active, 'activated', 'Service Worker 未激活')
  if (!sw.controller) {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  }
  await page.waitForTimeout(400)
  assert(await page.evaluate(() => document.fonts.check('16px "Wufeng Serif"')), '在线字体未加载')
  assert(
    await page.evaluate(() => document.fonts.check('20px "Wufeng Kai"', '离线试记')),
    '在线楷体未加载',
  )

  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.enable')
  const appManifest = await cdp.send('Page.getAppManifest')
  assertEqual(appManifest.errors.length, 0, 'manifest 解析错误')
  const installability = await cdp.send('Page.getInstallabilityErrors')
  const blocking = installability.installabilityErrors.filter(
    (item) => item.errorId !== 'in-incognito',
  )
  assertEqual(blocking.length, 0, 'PWA 可安装性错误')
  console.log(
    'PWA installability:',
    JSON.stringify({
      manifestErrors: appManifest.errors,
      installabilityErrors: installability.installabilityErrors,
      note: 'in-incognito 仅因自动化使用无痕上下文，与应用配置无关',
    }),
  )

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.querySelector('.masthead__title')?.getAttribute('aria-label') === '无锋',
    undefined,
    { timeout: 8000 },
  )
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '离线试记',
    undefined,
    { timeout: 8000 },
  )
  assert(await page.getByText('断网之后，此卷仍在。').isVisible(), '离线重载后内容丢失')
  const offlineFont = await page.evaluate(async () => {
    const serifFaces = await document.fonts.load('16px "Wufeng Serif"', '断网之后')
    const kaiFaces = await document.fonts.load('20px "Wufeng Kai"', '离线试记')
    return {
      faces: serifFaces.length + kaiFaces.length,
      check:
        document.fonts.check('16px "Wufeng Serif"') &&
        document.fonts.check('20px "Wufeng Kai"', '离线试记'),
      status: document.fonts.status,
    }
  })
  assert(offlineFont.faces > 0 || offlineFont.check, `离线字体未命中：${JSON.stringify(offlineFont)}`)
  await page.screenshot({ path: path.join(SHOTS, 'final-offline.png'), fullPage: true })
})

// 13. IndexedDB 降级到 localStorage
await test('IndexedDB 不可用时兼容存储仍可持久化', async () => {
  const { page } = await newPage({}, () => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('blocked for test', 'UnknownError')
    }
  })
  await page.getByText('本机数据库不可用，已启用兼容存储。').waitFor({ timeout: 4000 })
  await addMemo(page, '兼容记', '本机卷库不可用时，也要留下。')
  const stored = await page.evaluate(() => localStorage.getItem('wufeng.memos.v1'))
  assert(stored && stored.includes('兼容记'), 'localStorage 未写入')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '兼容记',
    undefined,
    { timeout: 6000 },
  )
  assertEqual(await page.locator('.storage-warning').count(), 0, '兼容模式不应显示内存警告')
})

// 14. 全部本地存储不可用 → 内存
await test('本地存储全部不可用时明确警示且不崩溃', async () => {
  const { page } = await newPage({}, () => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('blocked for test', 'UnknownError')
    }
    Storage.prototype.setItem = function () {
      throw new DOMException('blocked for test', 'QuotaExceededError')
    }
  })
  await page.locator('.storage-warning').waitFor({ timeout: 4000 })
  assert(
    (await page.locator('.storage-warning').textContent())?.includes('仅存于本次开启期间'),
    '内存模式警示文案',
  )
  await addMemo(page, '浮光', '只在此刻。')
  assertArray(await titles(page, '.chapter--open'), ['浮光'], '内存模式仍可新增')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.chapter--open'))
  assertEqual(await page.locator('.memo').count(), 0, '内存模式刷新后不应残留')
  assert(await page.locator('.storage-warning').isVisible(), '刷新后警示应仍在')
})

// 15. 移动端
await test('移动端 390/320 布局与键盘高度压测', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  assertEqual(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    0,
    '390px 横向溢出',
  )
  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(500)
  assert(await page.getByRole('button', { name: '记下' }).isVisible(), '移动端记下按钮不可见')
  const sheet = await page.locator('.sheet').boundingBox()
  console.log('390 sheet box:', JSON.stringify(sheet))
  assert(
    sheet && sheet.y > -1 && sheet.y + sheet.height <= 848,
    `移动端卷纸超出屏幕：${JSON.stringify(sheet)}`,
  )

  await page.setViewportSize({ width: 390, height: 460 })
  await page.waitForFunction(
    () => {
      const footer = document.querySelector('.sheet__foot')?.getBoundingClientRect()
      const height = window.visualViewport?.height ?? window.innerHeight
      return !!footer && footer.bottom <= height + 1
    },
    undefined,
    { timeout: 4000 },
  )
  const footer = await page.locator('.sheet__foot').boundingBox()
  console.log('460 footer box:', JSON.stringify(footer))
  assert(footer && footer.y + footer.height <= 463, `键盘高度下保存区被遮挡：${JSON.stringify(footer)}`)
  await page.getByLabel('事项标题').fill('窄窗')
  await page.getByLabel('事项内容').click()
  await page.getByLabel('事项内容').fill('键盘弹起时，仍要看见落笔处。')
  const activeRect = await page.evaluate(() => {
    const active = document.activeElement
    const rect = active?.getBoundingClientRect()
    return rect
      ? { top: rect.top, bottom: rect.bottom, innerHeight: window.visualViewport?.height ?? innerHeight }
      : null
  })
  assert(
    activeRect && activeRect.top >= 0 && activeRect.bottom <= activeRect.innerHeight + 1,
    `输入框被虚拟键盘遮挡：${JSON.stringify(activeRect)}`,
  )
  await page.screenshot({ path: path.join(SHOTS, 'final-mobile-keyboard.png') })
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  assertEqual(await page.locator('.memo').count(), 1, '移动端窄视口保存失败')

  await page.setViewportSize({ width: 320, height: 700 })
  await page.waitForTimeout(350)
  assertEqual(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    0,
    '320px 横向溢出',
  )
  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(500)
  const smallFooter = await page.locator('.sheet__foot').boundingBox()
  console.log('320 footer box:', JSON.stringify(smallFooter))
  assert(smallFooter && smallFooter.y + smallFooter.height <= 703, '320px 保存区超出屏幕')
  await page.screenshot({ path: path.join(SHOTS, 'final-mobile-320.png') })
})

// 16. 减少动态
await test('prefers-reduced-motion 下完成流程仍可用', async () => {
  const { page } = await newPage({ reducedMotion: 'reduce' })
  assert(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    '未模拟减少动态',
  )
  await addMemo(page, '静水', '不兴波澜。')
  const started = Date.now()
  await page.getByRole('button', { name: '盖印完成：静水' }).click({ noWaitAfter: true })
  await page.waitForFunction(
    () => document.querySelector('.chapter--done .memo__title')?.textContent === '静水',
    undefined,
    { timeout: 2000 },
  )
  const elapsed = Date.now() - started
  assert(elapsed < 1500, `减少动态模式下完成耗时过长：${elapsed}ms`)
})

// 17. 键盘焦点
await test('Escape 关闭 / 焦点归还 / 确认框焦点', async () => {
  const { page } = await newPage()
  const addButton = page.getByRole('button', { name: '新增事项' })
  await addButton.click()
  await page.waitForTimeout(500)
  const focusState = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    className: document.activeElement?.className,
  }))
  assertEqual(focusState.tag, 'INPUT', '打开卷纸后应聚焦标题输入框')
  assert(
    typeof focusState.className === 'string' &&
      focusState.className.includes('field__input--title'),
    '焦点应落在标题输入框',
  )
  await page.keyboard.press('Escape')
  await waitForComposerGone(page)
  assertEqual(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '新增事项',
    'Escape 关闭后焦点未归还新增朱印',
  )

  await addButton.click()
  await page.getByLabel('事项标题').fill('焦点')
  await page.getByLabel('事项内容').fill('Tab 应在卷纸内循环。')
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  await page.waitForTimeout(100)
  await openEdit(page, '焦点')
  await page.getByRole('button', { name: '抹去此事' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  await page.waitForTimeout(100)
  assertEqual(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    '留下',
    '确认框未默认聚焦留下',
  )
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert(await page.locator('.sheet').isVisible(), 'Escape 应只关闭确认框')
})

// 18. 楷体与标题层级
await test('楷体字族 / 标题大于正文 / 编辑卷纸同用楷体', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await addMemo(page, '楷体试记', '正文与标题同用一档楷体，标题略大。')
  const metrics = await page.locator('.chapter--open .memo').first().evaluate((node) => {
    const title = getComputedStyle(node.querySelector('.memo__title'))
    const content = getComputedStyle(node.querySelector('.memo__content'))
    return {
      titleFamily: title.fontFamily,
      contentFamily: content.fontFamily,
      titleSize: Number.parseFloat(title.fontSize),
      contentSize: Number.parseFloat(content.fontSize),
      titleWeight: title.fontWeight,
      contentWeight: content.fontWeight,
    }
  })
  assert(metrics.titleFamily.includes('Wufeng Kai'), `标题未使用楷体：${metrics.titleFamily}`)
  assert(metrics.contentFamily.includes('Wufeng Kai'), `正文未使用楷体：${metrics.contentFamily}`)
  assert(
    metrics.titleSize >= metrics.contentSize + 5,
    `标题未明显大于正文：标题 ${metrics.titleSize}px / 正文 ${metrics.contentSize}px`,
  )
  assertEqual(metrics.titleWeight, '400', '楷体标题字重')
  assertEqual(metrics.contentWeight, '400', '楷体正文字重')

  await openEdit(page, '楷体试记')
  const editor = await page.evaluate(() => {
    const title = getComputedStyle(document.querySelector('.field__input--title'))
    const content = getComputedStyle(document.querySelector('.field__input--content'))
    return {
      titleFamily: title.fontFamily,
      contentFamily: content.fontFamily,
      titleSize: Number.parseFloat(title.fontSize),
      contentSize: Number.parseFloat(content.fontSize),
    }
  })
  assert(editor.titleFamily.includes('Wufeng Kai'), `编辑标题未使用楷体：${editor.titleFamily}`)
  assert(editor.contentFamily.includes('Wufeng Kai'), `编辑正文未使用楷体：${editor.contentFamily}`)
  assert(
    editor.titleSize >= editor.contentSize + 8,
    `编辑标题未明显大于正文：标题 ${editor.titleSize}px / 正文 ${editor.contentSize}px`,
  )
  await page.getByRole('button', { name: '关闭编辑' }).click()
  await waitForComposerGone(page)
  await page.screenshot({ path: path.join(SHOTS, 'final-typography.png') })
})

// 19. 事项印记
await test('事项印记 / 默认金剑 / 选择紫剑与白卷 / 刷新保留', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await addMemo(page, '默认', '默认用金剑。')
  assertEqual(
    await page.locator('.chapter--open .memo').first().locator('.memo-mark--gold-sword').count(),
    1,
    '默认印记不是金剑',
  )

  await page.getByRole('button', { name: '新增事项' }).click()
  await page.waitForTimeout(450)
  await page.getByRole('button', { name: '紫剑', exact: true }).click()
  await page.getByLabel('事项标题').fill('紫电')
  await page.getByLabel('事项内容').fill('紫剑一柄，悬于题左。')
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  await page.waitForTimeout(400)

  const purpleRow = page.locator('.memo', { hasText: '紫电' })
  assertEqual(await purpleRow.locator('.memo-mark--purple-sword').count(), 1, '紫剑印记未显示')

  await openEdit(page, '紫电')
  await page.getByRole('button', { name: '白卷', exact: true }).click()
  assertEqual(
    await page.getByRole('button', { name: '白卷', exact: true }).getAttribute('aria-pressed'),
    'true',
    '白卷未显示选中态',
  )
  await page.getByRole('button', { name: '记下' }).click()
  await waitForComposerGone(page)
  await page.waitForTimeout(300)
  assertEqual(
    await page.locator('.memo', { hasText: '紫电' }).locator('.memo-mark--white-scroll').count(),
    1,
    '编辑后印记未改为白卷',
  )

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '紫电',
    undefined,
    { timeout: 6000 },
  )
  assertEqual(
    await page.locator('.memo', { hasText: '紫电' }).locator('.memo-mark--white-scroll').count(),
    1,
    '刷新后印记未保留',
  )
  await page.screenshot({ path: path.join(SHOTS, 'final-marks.png') })
})

// 20. 旧备份兼容
await test('导入 v1 旧备份 / 缺失印记回退金剑', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const backup = {
    app: '无锋',
    format: 'wufeng-journal',
    version: 1,
    exportedAt: new Date().toISOString(),
    memos: [
      {
        id: 'legacy-v1-1',
        title: '旧卷',
        content: '二点零一时的旧备份。',
        done: false,
        createdAt: Date.now(),
        completedAt: null,
      },
    ],
  }
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入卷宗' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'wufeng-v1-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup), 'utf8'),
  })
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '并入' }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '旧卷',
    undefined,
    { timeout: 6000 },
  )
  assertEqual(
    await page.locator('.memo', { hasText: '旧卷' }).locator('.memo-mark--gold-sword').count(),
    1,
    'v1 旧备份缺失印记未回退金剑',
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '旧卷',
    undefined,
    { timeout: 6000 },
  )
  assertEqual(
    await page.locator('.memo', { hasText: '旧卷' }).locator('.memo-mark--gold-sword').count(),
    1,
    '刷新后 v1 旧记录印记丢失',
  )
})

// 汇总
const passed = results.filter((result) => result.ok).length
const failed = results.length - passed
const report = {
  generatedAt: new Date().toISOString(),
  url: URL,
  browser: await browser.version(),
  passed,
  failed,
  total: results.length,
  results,
}
await writeFile(path.join(ROOT, 'tests', 'report.json'), JSON.stringify(report, null, 2))
const textReport = [
  '无锋 · 端到端验收报告',
  `生成时间：${report.generatedAt}`,
  `运行环境：Chrome ${report.browser} / ${URL}`,
  `结果：${passed}/${results.length} 通过，${failed} 失败`,
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.ms}ms)${
        result.ok ? '' : `\n      ${result.error}`
      }`,
  ),
].join('\n')
await writeFile(path.join(ROOT, 'tests', 'last-report.txt'), `${textReport}\n`)
console.log(`\n${textReport}`)

await browser.close()
await new Promise((resolve) => server.httpServer.close(resolve))
process.exit(failed > 0 ? 1 : 0)
