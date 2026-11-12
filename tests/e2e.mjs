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

async function openStudio(page) {
  await page.getByRole('button', { name: '编辑任务' }).click()
  await page.locator('.studio').waitFor({ state: 'visible' })
  await page.waitForTimeout(120)
}

async function closeStudio(page) {
  await page.getByRole('button', { name: '返回卷宗' }).click()
  await page.locator('.studio').waitFor({ state: 'detached', timeout: 5000 })
  await page.waitForTimeout(120)
}

async function createTask(page, kind, title, content) {
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByRole('button', { name: `新建${kind}` }).click()
  const sheet = page.locator('.studio__new-sheet')
  await sheet.waitFor({ state: 'visible' })
  await sheet.getByLabel('任务标题').fill(title)
  await sheet.getByLabel('任务细则').fill(content)
  await sheet.getByRole('button', { name: '记下' }).click()
  await sheet.waitFor({ state: 'detached', timeout: 6000 })
  await page.waitForFunction(
    (value) =>
      Array.from(document.querySelectorAll('.card__title')).some(
        (element) => element.textContent === value,
      ),
    title,
    { timeout: 4000 },
  )
  await page.waitForTimeout(80)
}

async function expandCard(page, title) {
  await page.locator('.card__open', { hasText: title }).first().click()
  const editor = page.locator('.card.is-editing')
  await editor.waitFor({ state: 'visible' })
  await page.waitForTimeout(120)
}

async function addFollow(page, title, content) {
  await page.getByRole('button', { name: '添加后续任务' }).click()
  const follow = page.locator('.card__follow')
  await follow.waitFor({ state: 'visible' })
  await follow.getByLabel('任务标题').fill(title)
  await follow.getByLabel('任务细则').fill(content)
  await follow.getByRole('button', { name: '记下' }).click()
  await follow.waitFor({ state: 'detached', timeout: 6000 })
  await page.waitForFunction(
    (value) =>
      Array.from(document.querySelectorAll('.card__title')).some(
        (element) => element.textContent === value,
      ),
    title,
    { timeout: 4000 },
  )
  await page.waitForTimeout(100)
}

async function closeEditor(page) {
  const close = page.locator('.card__editor-close')
  if ((await close.count()) > 0) {
    await close.first().click()
    await page.waitForTimeout(120)
  }
}

async function confirmComplete(page, title) {
  await page.getByRole('button', { name: `盖印完成：${title}` }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '已了' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 3000 })
}

async function waitDone(page, title) {
  await page.waitForFunction(
    (value) =>
      Array.from(document.querySelectorAll('.chapter--done .memo__title')).some(
        (element) => element.textContent === value,
      ),
    title,
    { timeout: 5000 },
  )
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

async function cardTitles(page) {
  return page.locator('.card__title').allTextContents()
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

// 1. 首页 / 藏锋 / 编辑入口 / 空状态 / 页脚
await test('首页 / 藏锋题名 / 编辑入口 / 空状态 / 无存储告知 / 无横向溢出', async () => {
  const { page } = await newPage()
  assertEqual(await page.title(), '藏锋 · 事有始终，念有归处', '文档标题')
  assertEqual(await page.locator('.masthead__title').getAttribute('aria-label'), '藏锋', '卷首题名')
  assert(await page.getByText('事有始终，念有归处。').first().isVisible(), '卷首题记不可见')
  assert(await page.getByRole('button', { name: '编辑任务' }).isVisible(), '编辑入口缺失')
  assert(await page.getByRole('heading', { name: '未竟之事' }).isVisible(), '未竟之事标题缺失')
  assert(await page.getByRole('heading', { name: '已了之事' }).isVisible(), '已了之事标题缺失')
  assert(await page.getByText('此间暂无未竟之事。').isVisible(), '未竟空状态文案缺失')
  assert(await page.getByText('尚无已了之事。').isVisible(), '已了空状态文案缺失')
  assert(await page.getByRole('button', { name: '新增事项' }).isVisible(), '新增朱印缺失')
  assertEqual(await page.getByText('此卷存于本机').count(), 0, '卷宗存储告知应已删除')
  assertEqual(await page.getByText('清除网站数据、卸载应用或设备损坏后').count(), 0, '存储警示应已删除')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert(overflow <= 1, `存在横向滚动：${overflow}px`)
  await page.screenshot({ path: path.join(SHOTS, 'final-desktop-empty.png'), fullPage: true })
})

// 2. 新建三类 / 图标文字 / 类别顺序 / 字数与 Emoji / 持久化
await test('新建故事轶闻收集 / 字数与 Emoji / 类别从上往下 / 刷新保留', async () => {
  const { page } = await newPage()
  await openStudio(page)
  assert(await page.getByText('卷中尚无脉络。先新建一事。').isVisible(), '控制面板空状态缺失')

  await page.getByRole('button', { name: '新建任务' }).click()
  assert(await page.getByRole('button', { name: '新建故事' }).isVisible(), '类别选择缺少故事')
  assert(await page.getByRole('button', { name: '新建轶闻' }).isVisible(), '类别选择缺少轶闻')
  assert(await page.getByRole('button', { name: '新建收集' }).isVisible(), '类别选择缺少收集')
  await page.getByRole('button', { name: '新建故事' }).click()
  const sheet = page.locator('.studio__new-sheet')
  await sheet.waitFor({ state: 'visible' })
  assertEqual(await sheet.locator('.task-form__kind').textContent(), '故事', '新建故事图标文字')
  assertEqual(await sheet.locator('.field__count, .task-form__count').nth(0).textContent(), '0/8', '标题初始计数')

  await sheet.getByLabel('任务标题').fill('一二三四五六七八九十')
  assertEqual(await sheet.getByLabel('任务标题').inputValue(), '一二三四五六七八', '标题截断')
  await sheet.getByLabel('任务细则').fill('一二三四五六七八九十'.repeat(6))
  assertEqual(
    await sheet.getByLabel('任务细则').inputValue(),
    '一二三四五六七八九十'.repeat(5),
    '细则截断',
  )

  const family = '👨‍👩‍👧‍👦'
  await sheet.getByLabel('任务标题').fill(family.repeat(9))
  const titleValue = await sheet.getByLabel('任务标题').inputValue()
  const titleCount = await page.evaluate(
    (value) =>
      Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(value)).length,
    titleValue,
  )
  assertEqual(titleCount, 8, '标题 Emoji 字素数')
  assert(titleValue.endsWith(family), '标题末尾的 Emoji 组合被截断')
  await sheet.locator('.task-form__cancel').click()
  await sheet.waitFor({ state: 'detached' })

  await createTask(page, '故事', '夜渡寒江', '孤舟一盏灯，先寻渡口的老艄公。')
  await createTask(page, '轶闻', '酒楼听雨', '城南酒楼的说书人，知道二十年前的旧案。')
  await createTask(page, '收集', '残页三张', '散在城隍庙、药铺与废宅里的残页。')
  assertArray(await cardTitles(page), ['夜渡寒江', '酒楼听雨', '残页三张'], '控制面板类别顺序')

  await closeStudio(page)
  assertArray(await titles(page, '.chapter--open'), ['夜渡寒江', '酒楼听雨', '残页三张'], '未竟类别顺序')
  assertEqual(
    await page.locator('.chapter--open .memo-mark--gold-sword').count(),
    1,
    '故事图标不是金剑轮廓',
  )
  assertEqual(
    await page.locator('.chapter--open .memo-mark--purple-sword').count(),
    1,
    '轶闻图标不是紫剑轮廓',
  )
  assertEqual(
    await page.locator('.chapter--open .memo-mark--white-scroll').count(),
    1,
    '收集图标不是白卷轮廓',
  )
  assert(await page.getByText('故事', { exact: true }).first().isVisible(), '故事分组标签缺失')
  assert(await page.getByText('轶闻', { exact: true }).first().isVisible(), '轶闻分组标签缺失')
  assert(await page.getByText('收集', { exact: true }).first().isVisible(), '收集分组标签缺失')

  const rows = await readStore(page)
  assertEqual(rows.length, 3, '本地卷宗条目数')
  const story = rows.find((row) => row.title === '夜渡寒江')
  assert(story && story.chainId && typeof story.chainId === 'string', '新任务缺少脉络编号')
  assertEqual(story.order, 0, '新任务逻辑序号')
  assert(typeof story.updatedAt === 'number', '新任务缺少修改时间')
  assertEqual(story.done, false, '新任务默认未完成')

  await page.screenshot({ path: path.join(SHOTS, 'final-journal-groups.png'), fullPage: true })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => document.querySelectorAll('.chapter--open .memo').length === 3,
    undefined,
    { timeout: 6000 },
  )
  assertArray(await titles(page, '.chapter--open'), ['夜渡寒江', '酒楼听雨', '残页三张'], '刷新后类别顺序')
})

// 3. 必填 / 编辑标题细则类别 / 不产生重复
await test('必填校验 / 改标题细则与类别 / 不产生重复记录', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '旧约', '三日后，渡口相见。')
  await expandCard(page, '旧约')
  const editor = page.locator('.card.is-editing')

  await editor.getByLabel('任务标题').fill('')
  await editor.getByRole('button', { name: '保存' }).click()
  assertEqual(await editor.locator('.task-form__error').textContent(), '题，不可空。', '空标题校验')
  await editor.getByLabel('任务标题').fill('旧约')
  await editor.getByLabel('任务细则').fill('')
  await editor.getByRole('button', { name: '保存' }).click()
  assertEqual(await editor.locator('.task-form__error').textContent(), '文，不可空。', '空细则校验')

  await editor.getByLabel('任务细则').fill('三日后，渡口不见不散。')
  await editor.getByRole('button', { name: '轶闻' }).click()
  assertEqual(
    await editor.getByRole('button', { name: '轶闻' }).getAttribute('aria-pressed'),
    'true',
    '类别选中态',
  )
  await editor.getByRole('button', { name: '保存' }).click()
  await editor.waitFor({ state: 'detached', timeout: 5000 })
  await page.waitForTimeout(250)

  const rows = await readStore(page)
  assertEqual(rows.length, 1, '编辑后条目数')
  assertEqual(rows[0].content, '三日后，渡口不见不散。', '编辑后细则')
  assertEqual(rows[0].icon, 'purple-sword', '编辑后类别')
  assert(rows[0].updatedAt >= rows[0].createdAt, '编辑后修改时间未更新')
  assertEqual(
    await page.locator('.stack__head .memo-mark--purple-sword').count(),
    1,
    '控制面板类别图标未更新',
  )
  await closeStudio(page)
  assertArray(await titles(page, '.chapter--open'), ['旧约'], '改类别后列表')
  assertEqual(
    await page.locator('.chapter--open .memo-mark--purple-sword').count(),
    1,
    '卷宗里的类别图标未更新',
  )
})

// 4. 完成确认 / 下沉 / 浮现 / 不可撤销
await test('已了二次确认 / 取消 / 下沉消失 / 下一事浮现顶位 / 不可撤销', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '封刀', '此刀入鞘，不再出鞘。')
  await expandCard(page, '封刀')
  await addFollow(page, '问剑', '刀封之后，去向旧桥问一剑。')
  await closeEditor(page)
  await closeStudio(page)

  await page.getByRole('button', { name: '盖印完成：封刀' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  const copy = (await dialog.textContent()) ?? ''
  assert(copy.includes('确定吗？'), '确认窗口缺少主问句')
  assert(copy.includes('确定后将不可撤销。'), '确认窗口缺少不可撤销警示')
  assert(await dialog.getByRole('button', { name: '取消' }).isVisible(), '确认窗口缺少取消')
  assert(await dialog.getByRole('button', { name: '已了' }).isVisible(), '确认窗口缺少已了')
  await page.waitForTimeout(120)
  assertEqual(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    '取消',
    '确认窗口应默认聚焦取消',
  )

  await dialog.getByRole('button', { name: '取消' }).click()
  await dialog.waitFor({ state: 'detached' })
  assertEqual((await readStore(page)).find((row) => row.title === '封刀').done, false, '取消后不应完成')

  await confirmComplete(page, '封刀')
  await page.locator('.memo.is-sinking').waitFor({ state: 'attached', timeout: 2000 })
  assertEqual(
    await page.locator('.chapter--done .memo').count(),
    0,
    '下沉完成前不应先出现已了条目',
  )
  await waitDone(page, '封刀')
  await page.locator('.memo.is-rising').waitFor({ state: 'attached', timeout: 2500 })
  assertArray(await titles(page, '.chapter--open'), ['问剑'], '下一事未顶位')
  assertEqual(await page.locator('.chapter--open .memo__step').textContent(), '其二', '下一事脉络序号')

  const doneRow = page.locator('.chapter--done .memo').first()
  assert(await doneRow.getByText('此刀入鞘，不再出鞘。').isVisible(), '完成后内容未保留')
  const lineThrough = await doneRow.locator('.memo__title').evaluate(
    (element) => getComputedStyle(element).textDecorationLine,
  )
  assert(lineThrough.includes('line-through'), '完成后标题未加删除线')
  assertEqual(await doneRow.locator('.memo__seal').textContent(), '已了', '已了印章文字')
  assertEqual(await page.getByRole('button', { name: /撤销完成/ }).count(), 0, '不应存在撤销入口')

  const rows = await readStore(page)
  const finished = rows.find((row) => row.title === '封刀')
  const next = rows.find((row) => row.title === '问剑')
  assertEqual(finished.done, true, '完成状态未持久化')
  assert(typeof finished.completedAt === 'number', '完成时间未持久化')
  assertEqual(finished.chainId, next.chainId, '后续任务应共享脉络')
  assertEqual(next.done, false, '后续任务不应被连带完成')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '问剑',
    undefined,
    { timeout: 6000 },
  )
  assertArray(await titles(page, '.chapter--done'), ['封刀'], '刷新后已了记录')
})

// 5. 链式推进 / 走完一脉 / 已了排序
await test('脉络逐事推进 / 走完后消失 / 已了按完成时间倒序', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '收集', '其一', '第一张残页。')
  await expandCard(page, '其一')
  await addFollow(page, '其二', '第二张残页。')
  await addFollow(page, '其三', '第三张残页。')
  await closeEditor(page)
  await closeStudio(page)
  assertEqual(await page.locator('.chapter--open .memo').count(), 1, '一条脉络只露当前一事')

  await confirmComplete(page, '其一')
  await waitDone(page, '其一')
  assertArray(await titles(page, '.chapter--open'), ['其二'], '第一事后由第二事接续')
  await confirmComplete(page, '其二')
  await waitDone(page, '其二')
  assertArray(await titles(page, '.chapter--open'), ['其三'], '第二事后由第三事接续')
  await confirmComplete(page, '其三')
  await waitDone(page, '其三')
  assert(await page.getByText('此间暂无未竟之事。').isVisible(), '走完后未显示空状态')
  assertArray(await titles(page, '.chapter--done'), ['其三', '其二', '其一'], '已了按完成时间倒序')
  assertEqual(await page.locator('.chapter--open .memo').count(), 0, '走完后不应残留当前事')

  const rows = await readStore(page)
  assertEqual(rows.filter((row) => row.done).length, 3, '三事均已写入已了')
  assertEqual(new Set(rows.map((row) => row.chainId)).size, 1, '三事应同属一脉')
})

// 6. 三类混排 / 完成只影响本脉
await test('三类混排 / 完成只推进本脉 / 其余类别不动', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '甲', '故事甲。')
  await createTask(page, '轶闻', '乙', '轶闻乙。')
  await createTask(page, '收集', '丙', '收集丙。')
  await closeStudio(page)
  assertArray(await titles(page, '.chapter--open'), ['甲', '乙', '丙'], '三类初始顺序')

  await confirmComplete(page, '乙')
  await waitDone(page, '乙')
  assertArray(await titles(page, '.chapter--open'), ['甲', '丙'], '完成轶闻后不应影响其它类别')

  await confirmComplete(page, '甲')
  await waitDone(page, '甲')
  assertArray(await titles(page, '.chapter--open'), ['丙'], '完成故事后仅剩收集')
  assertArray(await titles(page, '.chapter--done'), ['甲', '乙'], '已了顺序')
})

// 7. 添加后续 / 行内展开 / 逻辑顺序持久化
await test('添加后续任务 / 类别不变 / 新卡展开 / 顺序持久化', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '起', '起笔。')
  await expandCard(page, '起')
  await addFollow(page, '承', '承接。')
  const editingTitle = await page.locator('.card.is-editing .card__title').textContent()
  assertEqual(editingTitle, '承', '新增后续后应展开新任务')
  assertEqual(
    await page.locator('.card.is-editing .card__editor-kicker').textContent(),
    '故事 · 其二 · 共 2 事',
    '后续任务类别或序号错误',
  )
  await addFollow(page, '转', '转折。')
  await closeEditor(page)
  assertArray(await cardTitles(page), ['起', '承', '转'], '控制面板逻辑顺序')
  await closeStudio(page)
  assertArray(await titles(page, '.chapter--open'), ['起'], '卷宗只显示脉络首事')

  const rows = await readStore(page)
  const chain = rows.filter((row) => row.chainId === rows[0].chainId)
  assertEqual(chain.length, 3, '后续任务数量')
  assertArray(
    [...chain].sort((a, b) => a.order - b.order).map((row) => row.title),
    ['起', '承', '转'],
    '持久化的逻辑顺序',
  )
  assertEqual(new Set(chain.map((row) => row.icon)).size, 1, '后续任务改变了类别')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '起',
    undefined,
    { timeout: 6000 },
  )
  await openStudio(page)
  assertArray(await cardTitles(page), ['起', '承', '转'], '刷新后逻辑顺序')
})

// 8. 拖动排序 / 同脉络内 / 已了不可拖
await test('按住拖动调整先后 / 只在同一脉络内 / 已了之事不可拖', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '甲', '甲事。')
  await expandCard(page, '甲')
  await addFollow(page, '乙', '乙事。')
  await addFollow(page, '丙', '丙事。')
  await closeEditor(page)
  await createTask(page, '故事', '丁', '另一条故事脉络。')

  assertArray(await cardTitles(page), ['甲', '乙', '丙', '丁'], '拖动前顺序')
  assertEqual(
    await page.getByRole('button', { name: /^拖动排序：/ }).count(),
    4,
    '每条未竟之事都应有拖动把手',
  )

  const source = page.getByRole('button', { name: '拖动排序：丙' })
  const firstCard = page.locator('.card').first()
  const sourceBox = await source.boundingBox()
  const firstBox = await firstCard.boundingBox()
  assert(sourceBox && firstBox, '无法取得拖动目标位置')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + 6, { steps: 10 })
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(500)

  assertArray(await cardTitles(page), ['丙', '甲', '乙', '丁'], '拖动后顺序')
  const rows = await readStore(page)
  const firstChain = rows.filter((row) => row.chainId === rows.find((r) => r.title === '甲').chainId)
  assertArray(
    [...firstChain].sort((a, b) => a.order - b.order).map((row) => row.title),
    ['丙', '甲', '乙'],
    '拖动后持久化顺序',
  )
  assertEqual(
    await page.getByRole('button', { name: '拖动排序：丁' }).count(),
    1,
    '另一条脉络的把手不应被合并',
  )

  const doneChain = rows.find((row) => row.title === '甲').chainId
  await closeStudio(page)
  await confirmComplete(page, '丙')
  await waitDone(page, '丙')
  await openStudio(page)
  const doneCard = page.locator('.card.is-done', { hasText: '丙' })
  assertEqual(
    await doneCard.getByRole('button', { name: /拖动排序/ }).count(),
    0,
    '已了之事不应有拖动把手',
  )
  assertEqual(
    await page.locator(`.stack[data-chain="${doneChain}"] .card.is-done`).count(),
    1,
    '已了之事应留在原脉络',
  )
})

// 9. 排序模式
await test('排序模式 / 类别默认 / 创建 / 修改', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '先记', '先记的故事。')
  await page.waitForTimeout(30)
  await createTask(page, '轶闻', '后闻', '后记的轶闻。')
  await page.waitForTimeout(30)
  await createTask(page, '故事', '后记', '后记的故事。')
  assertArray(await cardTitles(page), ['先记', '后记', '后闻'], '默认类别排序')

  assertEqual(
    await page.getByRole('button', { name: '类别' }).getAttribute('aria-pressed'),
    'true',
    '默认排序不是类别',
  )
  await page.getByRole('button', { name: '创建' }).click()
  assertArray(await cardTitles(page), ['先记', '后闻', '后记'], '创建时间排序')

  await page.getByRole('button', { name: '修改' }).click()
  await expandCard(page, '先记')
  await page.locator('.card.is-editing').getByLabel('任务细则').fill('刚刚改过的故事。')
  await page.locator('.card.is-editing').getByRole('button', { name: '保存' }).click()
  await page.locator('.card.is-editing').waitFor({ state: 'detached', timeout: 5000 })
  await page.waitForTimeout(250)
  assertArray(await cardTitles(page), ['先记', '后记', '后闻'], '修改时间排序')
})

// 10. 删除未竟 / 二次确认 / 持久化
await test('删除未竟之事 / 留下 / 抹去 / 刷新不留', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '轶闻', '留痕', '这一笔，且留着。')
  await expandCard(page, '留痕')
  await page.getByRole('button', { name: '抹去' }).click()
  let dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  assert((await dialog.textContent())?.includes('抹去此事？'), '删除确认主文案缺失')
  await dialog.getByRole('button', { name: '留下' }).click()
  await dialog.waitFor({ state: 'detached' })
  assertEqual(await page.locator('.card').count(), 1, '选择留下后任务消失')

  await page.getByRole('button', { name: '抹去' }).click()
  dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: '抹去' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 5000 })
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 0, undefined, {
    timeout: 5000,
  })
  assert(await page.getByText('卷中尚无脉络。先新建一事。').isVisible(), '删除后未显示空状态')
  assertEqual((await readStore(page)).length, 0, '删除后本地卷宗仍有余条')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.chapter--open'))
  await openStudio(page)
  assertEqual(await page.locator('.card').count(), 0, '刷新后已删条目复现')
})

// 11. 已了之事不可抹去 / 不可撤销
await test('已了之事 / 不可撤销 / 不可抹去 / 只可修字', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '收集', '旧印', '印落之后，不可复得。')
  await closeStudio(page)
  await confirmComplete(page, '旧印')
  await waitDone(page, '旧印')
  await openStudio(page)
  const doneCard = page.locator('.card.is-done', { hasText: '旧印' })
  assertEqual(await doneCard.count(), 1, '已了之事未出现在控制面板')
  await doneCard.locator('.card__open').click()
  await page.waitForTimeout(150)
  const editor = page.locator('.card.is-editing')
  assert(await editor.getByText('已了之事不可撤销，也不可抹去；此处只可修字。').isVisible(), '缺少不可逆说明')
  assertEqual(await editor.getByRole('button', { name: '抹去' }).count(), 0, '已了之事仍可抹去')
  assertEqual(await editor.getByRole('button', { name: '添加后续任务' }).count(), 0, '已了之事仍可续写')
  assertEqual(await editor.getByRole('button', { name: '前移' }).count(), 0, '已了之事仍可调序')

  await editor.getByLabel('任务细则').fill('印落之后，只可补一笔注。')
  await editor.getByRole('button', { name: '保存' }).click()
  await editor.waitFor({ state: 'detached', timeout: 5000 })
  const rows = await readStore(page)
  assertEqual(rows[0].content, '印落之后，只可补一笔注。', '已了之事修字未保存')
  assertEqual(rows[0].done, true, '修字不应改变完成状态')
})

// 12. 中文输入法组合
await test('中文输入法组合 / 新建表单不截断拼音', async () => {
  const { page, context } = await newPage()
  await openStudio(page)
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByRole('button', { name: '新建故事' }).click()
  const sheet = page.locator('.studio__new-sheet')
  await sheet.getByLabel('任务标题').click()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: 'ceshi',
    selectionStart: 5,
    selectionEnd: 5,
    replacementStart: 0,
    replacementEnd: 0,
  })
  await page.waitForTimeout(80)
  assertEqual(await sheet.getByLabel('任务标题').inputValue(), 'ceshi', '组合期间拼音被截断')
  assertEqual(await sheet.locator('.task-form__count').nth(0).textContent(), '5/8', '组合期间计数')

  await cdp.send('Input.imeSetComposition', {
    text: '测试',
    selectionStart: 2,
    selectionEnd: 2,
    replacementStart: 0,
    replacementEnd: 5,
  })
  await page.waitForTimeout(80)
  assertEqual(await sheet.getByLabel('任务标题').inputValue(), '测试', '候选字未写入')
  await cdp.send('Input.insertText', { text: '测试' })
  await page.waitForTimeout(120)
  assertEqual(await sheet.getByLabel('任务标题').inputValue(), '测试', '提交后出现重复文本')
  await page.keyboard.type('一二三四五六七')
  await page.waitForTimeout(150)
  assertEqual(await sheet.getByLabel('任务标题').inputValue(), '测试一二三四五六', '8 字上限失效')
  assertEqual(await sheet.locator('.task-form__count').nth(0).textContent(), '8/8', '提交后计数')
})

// 13. 关闭重开
await test('关闭页面后重新打开仍保留脉络与已了', async () => {
  const { context, page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '长夜', '灯下留书，明日再读。')
  await expandCard(page, '长夜')
  await addFollow(page, '续灯', '灯未灭，书未竟。')
  await closeEditor(page)
  await closeStudio(page)
  await confirmComplete(page, '长夜')
  await waitDone(page, '长夜')
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto(URL, { waitUntil: 'networkidle' })
  await reopened.waitForFunction(
    () => document.querySelector('.chapter--open .memo__title')?.textContent === '续灯',
    undefined,
    { timeout: 6000 },
  )
  assert(await reopened.getByText('灯未灭，书未竟。').isVisible(), '重开后续事丢失')
  assertArray(await titles(reopened, '.chapter--done'), ['长夜'], '重开后已了丢失')
  activePage = reopened
})

// 14. 导出卷宗 v3
await test('导出卷宗 / v3 结构与脉络字段 / 下载文件名', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await openStudio(page)
  await createTask(page, '故事', '导出未竟', '未竟之事，也要留底。')
  await expandCard(page, '导出未竟')
  await addFollow(page, '导出续事', '续事也要留底。')
  await closeEditor(page)
  await closeStudio(page)
  await confirmComplete(page, '导出未竟')
  await waitDone(page, '导出未竟')
  await page.waitForTimeout(700)

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
  assertEqual(archive.app, '藏锋', '备份应用名')
  assertEqual(archive.format, 'wufeng-journal', '备份格式')
  assertEqual(archive.version, 3, '备份版本')
  assertEqual(archive.memos.length, 2, '备份记录数')
  const done = archive.memos.find((memo) => memo.title === '导出未竟')
  const next = archive.memos.find((memo) => memo.title === '导出续事')
  assert(done && done.done === true && typeof done.completedAt === 'number', '已了记录状态不正确')
  assertEqual(done.icon, 'gold-sword', '默认类别')
  assert(done.chainId === next.chainId, '导出未保留脉络编号')
  assertEqual(done.order, 0, '导出未保留逻辑序号')
  assert(typeof next.updatedAt === 'number', '导出未保留修改时间')
})

// 15. 导入 v2 / v1 / v3 / 非法
await test('导入卷宗 / v2 旧备份兼容 / 同号覆盖 / 非法文件拒绝', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await openStudio(page)
  await createTask(page, '故事', '原有', '旧文留在卷中。')
  await closeStudio(page)
  const stored = await readStore(page)
  const existing = stored.find((memo) => memo.title === '原有')
  assert(existing, '未读到原有记录')

  const base = Date.now()
  const backup = {
    app: '藏锋',
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
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(SHOTS, 'final-import-dialog.png') })
  await dialog.getByRole('button', { name: '再想想' }).click()
  await dialog.waitFor({ state: 'detached' })
  assertEqual(await page.locator('.chapter--open .memo').count(), 1, '取消导入不应改动卷宗')

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
  assertArray(await titles(page, '.chapter--open'), ['原有', '并入'], '并入后的未竟列表')
  assertArray(await titles(page, '.chapter--done'), ['旧印'], '并入后的已了列表')
  assert(await page.getByText('备份里的新文。').isVisible(), '同号旧记未被覆盖')
  assertEqual(await page.getByText('旧文留在卷中。').count(), 0, '旧正文不应残留')
  assertEqual(
    await page.locator('.memo', { hasText: '原有' }).locator('.memo-mark--purple-sword').count(),
    1,
    '同号旧记的类别未更新',
  )
  assertEqual(
    await page.locator('.memo', { hasText: '并入' }).locator('.memo-mark--white-scroll').count(),
    1,
    '导入记录的类别错误',
  )

  const imported = await readStore(page)
  const open1 = imported.find((memo) => memo.id === 'import-open-1')
  assert(open1 && open1.chainId, 'v2 导入缺少脉络编号')
  assertEqual(open1.chainId, 'legacy-import-open-1', 'v2 导入脉络回退值')
  assertEqual(open1.order, 0, 'v2 导入逻辑序号回退值')
  assert(typeof open1.updatedAt === 'number', 'v2 导入修改时间回退值')

  const badChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入卷宗' }).click()
  const chooser = await badChooser
  await chooser.setFiles({
    name: 'not-a-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}', 'utf8'),
  })
  await page.getByText('导入失败：这不是藏锋的卷宗备份。').waitFor({ timeout: 4000 })
  assertEqual(await page.getByRole('alertdialog').count(), 0, '非法文件不应打开确认框')
})

// 16. PWA / 离线
await test('PWA 清单 / 图标 / 离线重载', async () => {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } })
  await openStudio(page)
  await createTask(page, '轶闻', '离线试记', '断网之后，此卷仍在。')
  await closeStudio(page)

  const manifest = await page.evaluate(async () => {
    const response = await fetch('./manifest.webmanifest')
    return { status: response.status, body: await response.json() }
  })
  assertEqual(manifest.status, 200, 'manifest 状态码')
  assertEqual(manifest.body.name, '藏锋 · 私人卷宗', 'manifest 名称')
  assertEqual(manifest.body.display, 'standalone', 'manifest 显示模式')
  assertEqual(manifest.body.start_url, './', 'manifest start_url')
  assertEqual(manifest.body.icons.length, 3, 'manifest 图标数量')

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

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.querySelector('.masthead__title')?.getAttribute('aria-label') === '藏锋',
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
  await page.screenshot({ path: path.join(SHOTS, 'final-offline.png'), fullPage: true })
})

// 17. 存储降级
await test('IndexedDB 不可用时兼容存储仍可持久化', async () => {
  const { page } = await newPage({}, () => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('blocked for test', 'UnknownError')
    }
  })
  await page.getByText('本机数据库不可用，已启用兼容存储。').waitFor({ timeout: 4000 })
  await openStudio(page)
  await createTask(page, '故事', '兼容记', '本机卷库不可用时，也要留下。')
  await closeStudio(page)
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
  await openStudio(page)
  await createTask(page, '故事', '浮光', '只在此刻。')
  await closeStudio(page)
  assertArray(await titles(page, '.chapter--open'), ['浮光'], '内存模式仍可新增')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.chapter--open'))
  assertEqual(await page.locator('.memo').count(), 0, '内存模式刷新后不应残留')
  assert(await page.locator('.storage-warning').isVisible(), '刷新后警示应仍在')
})

// 18. 移动端
await test('移动端 390/320 布局 / 行内编辑 / 键盘高度', async () => {
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
  await openStudio(page)
  assertEqual(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    0,
    '390px 控制面板横向溢出',
  )
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByRole('button', { name: '新建故事' }).click()
  const sheet = page.locator('.studio__new-sheet')
  await sheet.waitFor({ state: 'visible' })
  const box = await sheet.boundingBox()
  assert(box && box.x >= 0 && box.x + box.width <= 391, `新建卷纸超出屏幕：${JSON.stringify(box)}`)

  await page.setViewportSize({ width: 390, height: 460 })
  await sheet.getByLabel('任务细则').click()
  await sheet.getByLabel('任务细则').fill('键盘弹起时，仍要看见落笔处。')
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
  await sheet.getByLabel('任务标题').fill('窄窗')
  await sheet.getByRole('button', { name: '记下' }).click()
  await sheet.waitFor({ state: 'detached', timeout: 6000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(SHOTS, 'final-mobile-studio.png'), fullPage: true })

  await page.setViewportSize({ width: 320, height: 700 })
  await page.waitForTimeout(400)
  assertEqual(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    0,
    '320px 横向溢出',
  )
  const smallBox = await page.locator('.card').first().boundingBox()
  assert(smallBox && smallBox.x >= 0 && smallBox.x + smallBox.width <= 321, '320px 卡片超出屏幕')
  await page.locator('.card__open').first().click()
  await page.waitForTimeout(300)
  const editorBox = await page.locator('.card.is-editing').boundingBox()
  assert(
    editorBox && editorBox.x >= 0 && editorBox.x + editorBox.width <= 321,
    `320px 编辑卡片超出屏幕：${JSON.stringify(editorBox)}`,
  )
  await page.screenshot({ path: path.join(SHOTS, 'final-mobile-320.png'), fullPage: true })
})

// 19. 减少动态
await test('prefers-reduced-motion 下完成流程仍可用', async () => {
  const { page } = await newPage({ reducedMotion: 'reduce' })
  assert(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    '未模拟减少动态',
  )
  await openStudio(page)
  await createTask(page, '故事', '静水', '不兴波澜。')
  await closeStudio(page)
  const started = Date.now()
  await confirmComplete(page, '静水')
  await waitDone(page, '静水')
  const elapsed = Date.now() - started
  assert(elapsed < 1500, `减少动态模式下完成耗时过长：${elapsed}ms`)
})

// 20. 键盘与焦点
await test('Escape 关闭确认框 / 焦点归还 / 编辑表单焦点', async () => {
  const { page } = await newPage()
  await openStudio(page)
  await createTask(page, '故事', '焦点', '以键盘走完一段。')
  await expandCard(page, '焦点')
  await page.locator('.card.is-editing').getByRole('button', { name: '抹去' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ state: 'visible' })
  await page.waitForTimeout(140)
  assertEqual(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    '留下',
    '确认框未默认聚焦留下',
  )
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert(await page.locator('.card.is-editing').isVisible(), 'Escape 应只关闭确认框')
  await closeEditor(page)
  await page.getByRole('button', { name: '返回卷宗' }).click()
  await page.waitForSelector('.studio', { state: 'detached' })
  assertEqual(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '编辑任务',
    '返回卷宗后焦点未归还编辑入口',
  )

  await page.getByRole('button', { name: '盖印完成：焦点' }).click()
  const completeDialog = page.getByRole('alertdialog')
  await completeDialog.waitFor({ state: 'visible' })
  await page.waitForTimeout(140)
  await page.keyboard.press('Escape')
  await completeDialog.waitFor({ state: 'detached' })
  assertEqual(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '盖印完成：焦点',
    '取消完成后焦点未归还原按钮',
  )
})

// 21. 字体与层级
await test('楷体字族 / 标题大于细则 / 行内编辑同用楷体', async () => {
  const { page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await openStudio(page)
  await createTask(page, '故事', '楷体试记', '正文与标题同用一档楷体，标题略大。')
  await closeStudio(page)
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

  await openStudio(page)
  await expandCard(page, '楷体试记')
  const editor = await page.evaluate(() => {
    const title = getComputedStyle(document.querySelector('.task-form__input--title'))
    const content = getComputedStyle(document.querySelector('.task-form__input--content'))
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
  await page.screenshot({ path: path.join(SHOTS, 'final-typography.png'), fullPage: true })
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
  '藏锋 · 端到端验收报告',
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
