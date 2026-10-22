// orderbook-rows.ts — 盘口行：按精度聚合价位，算出 Total（该档名义金额）与深度条比例。
//
// 行为对齐币安现货盘口（用 chrome-devtools 实地量过的口径）：
//   · 三列 Price / Amount / Total，Total 是「该档挂单的名义金额」= Σ(price × qty)，大数按 K/M 收；
//   · 精度选择器按最小步长 ×10 递进，选中后同价桶合并（卖价上取整、买价下取整）；
//   · 深度条两侧都贴右边生长，宽度按两侧共用的分母算，超长的墙截到 100%。
//
// 样式不跟币安走，这里只负责数据口径。

import type { Depth, DepthLevel } from './market.js'

export type BookRow = {
  price: number
  qty: number
  /** 该档名义金额（币安 Total 列） */
  total: number
  /** 深度条宽度，0~100 */
  percent: number
  side: 'bid' | 'ask'
}

export type BookView = {
  asks: BookRow[]
  bids: BookRow[]
  /** 买盘占两侧挂单金额的比例，0~1 */
  buyRatio: number
  /** 实际生效的聚合步长 */
  step: number
}

/** 深度条口径：单档名义金额 / 从最优价外推的累计金额（币安的 Amount / Cumulative）。 */
export type BookBarMode = 'amount' | 'cumulative'

/** 一侧的汇总：均价与合计名义金额（「Display Avg.&Sum」用）。 */
export type SideSummary = { avg: number; sum: number }

export function sideSummary(rows: BookRow[]): SideSummary {
  let qty = 0
  let sum = 0
  for (const row of rows) {
    qty += row.qty
    sum += row.total
  }
  return { avg: qty > 0 ? sum / qty : 0, sum }
}

/** 最小步长由价格量级决定：BTC 0.01、XRP 0.0001 这个档。 */
function baseStep(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01
  if (price >= 1) return 0.01
  if (price >= 0.01) return 0.0001
  return 0.000001
}

/** 聚合精度档位：最小步长往上乘 10，和币安的选择器同一套。 */
export function bookSteps(price: number): number[] {
  const base = baseStep(price)
  return [1, 10, 100, 1000].map((tier) => Number((base * tier).toFixed(8)))
}

/** 步长的小数位，用来消掉 key*step 的浮点噪声。 */
function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** 最优价，缺一边就用另一边兜底。 */
export function bestPrice(depth: Depth | null): number {
  if (!depth) return 0
  const bid = depth.bids.length ? depth.bids[0].price : 0
  const ask = depth.asks.length ? depth.asks[0].price : 0
  return bid || ask
}

const EMPTY: BookView = { asks: [], bids: [], buyRatio: 0.5, step: 0.01 }

/**
 * 从最优价往外走，把同一步长桶里的挂单并成一档，凑够 count 档就停。
 * 只扫需要的部分，所以哪怕本地簿有 1 万档也不慢。
 */
function aggregate(levels: DepthLevel[], side: 'bid' | 'ask', step: number, count: number): BookRow[] {
  const rows: BookRow[] = []
  if (!levels.length || count <= 0) return rows
  const decimals = decimalsOf(step)
  const bucketOf = (price: number) =>
    side === 'ask' ? Math.ceil(price / step) : Math.floor(price / step)

  let key = bucketOf(levels[0].price)
  let qty = 0
  let total = 0
  for (const level of levels) {
    if (!(level.qty > 0)) continue
    const next = bucketOf(level.price)
    if (next !== key) {
      rows.push({ price: Number((key * step).toFixed(decimals)), qty, total, percent: 0, side })
      if (rows.length >= count) return rows
      key = next
      qty = 0
      total = 0
    }
    qty += level.qty
    total += level.price * level.qty
  }
  if (rows.length < count && qty > 0) {
    rows.push({ price: Number((key * step).toFixed(decimals)), qty, total, percent: 0, side })
  }
  return rows
}

/**
 * 生成盘口视图。step 传 0（或不在当前档位里）时按价格量级自动取最小步长。
 * 返回的 asks / bids 都是「最优价在前」，界面按需反转卖盘顺序。
 * barMode = cumulative 时深度条按「从最优价外推的累计金额」画，最深处满格。
 */
export function bookView(
  depth: Depth | null,
  count = 14,
  step = 0,
  barMode: BookBarMode = 'amount',
): BookView {
  if (!depth || (!depth.bids.length && !depth.asks.length)) return EMPTY
  const options = bookSteps(bestPrice(depth))
  const effective = options.includes(step) ? step : options[0]
  const asks = aggregate(depth.asks, 'ask', effective, count)
  const bids = aggregate(depth.bids, 'bid', effective, count)

  let max = 0
  let bidSum = 0
  let askSum = 0
  for (const row of asks) {
    if (row.total > max) max = row.total
    askSum += row.total
  }
  for (const row of bids) {
    if (row.total > max) max = row.total
    bidSum += row.total
  }
  // amount 共用「单档最大名义值」做分母；cumulative 共用「两侧累计到最深处」的较大者。
  const scale = barMode === 'cumulative' ? Math.max(askSum, bidSum) : max
  const denom = scale > 0 ? scale : 1
  applyBars(asks, denom, barMode)
  applyBars(bids, denom, barMode)
  const both = bidSum + askSum
  // 卖盘按显示顺序返回（远价在前），中间行把两边隔开。
  asks.reverse()
  return { asks, bids, buyRatio: both > 0 ? bidSum / both : 0.5, step: effective }
}

/** 单侧统一算条宽；cumulative 按「最优在前」的顺序逐档累加，最深处满格。 */
function applyBars(rows: BookRow[], denom: number, barMode: BookBarMode): void {
  if (barMode !== 'cumulative') {
    for (const row of rows) row.percent = Math.min(100, (row.total / denom) * 100)
    return
  }
  let running = 0
  for (const row of rows) {
    running += row.total
    row.percent = Math.min(100, (running / denom) * 100)
  }
}

/**
 * 总列格式化：币安给大数加 K/M，小值给到 6 位小数。
 * exact = true 时对应「Rounding 关闭」：给完整数值 + 千分位（2,508.908813）。
 */
export function formatTotal(value: number | null | undefined, exact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  if (exact) return withThousands(trimZeros(value.toFixed(6)))
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(6)
}

/** 只去掉小数部分的尾零，整数部分（如 1000）不能被吃掉。 */
function trimZeros(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

/** 给整数部分加千分位分隔。 */
function withThousands(text: string): string {
  const dot = text.indexOf('.')
  const head = dot < 0 ? text : text.slice(0, dot)
  const tail = dot < 0 ? '' : text.slice(dot)
  return head.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + tail
}

/** 精度标签：0.01 / 0.1 / 1 / 10 … */
export function formatStep(step: number): string {
  if (!Number.isFinite(step) || step <= 0) return '--'
  return String(step)
}

/** 占比标签：0~1 的比例 → 一位小数的百分数（不带 % 号）。 */
export function formatShare(ratio: number): string {
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.5
  return (value * 100).toFixed(1)
}

/**
 * 每侧能放下多少档：按实际渲染高度算（拖动分栏、单侧模式都会跟着变），
 * 行高与 orderbook.ooc 里的 h-[18px] 保持一致。
 */
export function bookRowCount(heightA: number, heightB: number): number {
  const height = Math.max(heightA || 0, heightB || 0)
  if (!Number.isFinite(height) || height <= 0) return 18
  const rows = Math.floor(height / 18)
  return Math.min(60, Math.max(3, rows))
}
