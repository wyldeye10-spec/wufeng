import {
  MEMO_ICONS,
  MEMO_ICON_LABELS,
  type Memo,
  type MemoIcon,
} from './store'

export const CATEGORY_RANK: Record<MemoIcon, number> = {
  'gold-sword': 0,
  'purple-sword': 1,
  'white-scroll': 2,
}

export const CATEGORY_ORDER = MEMO_ICONS

export function categoryLabel(icon: MemoIcon): string {
  return MEMO_ICON_LABELS[icon]
}

export type ChainSort = 'category' | 'created' | 'updated'

export interface Chain {
  id: string
  category: MemoIcon
  /** 按逻辑先后排好，已了之事在前，未竟之事在后。 */
  tasks: Memo[]
  /** 当前应当出现在未竟之事里的那一件；整条脉络走完则为 null。 */
  head: Memo | null
  createdAt: number
  updatedAt: number
}

function byOrder(left: Memo, right: Memo): number {
  return (
    left.order - right.order ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  )
}

/** 按脉络分组；旧数据没有脉络时，每一件自成一线。 */
export function buildChains(memos: Memo[]): Chain[] {
  const groups = new Map<string, Memo[]>()
  for (const memo of memos) {
    const list = groups.get(memo.chainId)
    if (list) list.push(memo)
    else groups.set(memo.chainId, [memo])
  }

  const chains: Chain[] = []
  for (const [id, group] of groups) {
    const tasks = [...group].sort(byOrder)
    const first = tasks[0]
    chains.push({
      id,
      category: first.icon,
      tasks,
      head: tasks.find((task) => !task.done) ?? null,
      createdAt: Math.min(...tasks.map((task) => task.createdAt)),
      updatedAt: Math.max(...tasks.map((task) => task.updatedAt)),
    })
  }
  return chains
}

export function sortChains(chains: Chain[], mode: ChainSort): Chain[] {
  const list = [...chains]
  if (mode === 'created') {
    return list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }
  if (mode === 'updated') {
    return list.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  }
  // 默认：故事 → 轶闻 → 收集，同类别按脉络创建时间。
  return list.sort(
    (a, b) =>
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  )
}

/** 一个任务在脉络中的序号（从 1 起）与总事数。 */
export function stepInfo(chain: Chain, memo: Memo): { step: number; total: number } {
  const index = chain.tasks.findIndex((task) => task.id === memo.id)
  return { step: index + 1, total: chain.tasks.length }
}

const CN_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function stepLabel(step: number): string {
  if (step >= 1 && step <= CN_NUMBERS.length) return `其${CN_NUMBERS[step - 1]}`
  return `第${step}`
}

/** 后续任务：同一脉络里，排在此事之后的下一件未竟之事。 */
export function nextTask(chain: Chain, memo: Memo): Memo | null {
  return chain.tasks.find((task) => !task.done && task.order > memo.order) ?? null
}
