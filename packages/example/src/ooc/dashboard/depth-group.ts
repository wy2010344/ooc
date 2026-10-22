import type { DepthLevel } from './market.js'

export type SidePoint = { price: number; total: number; notional: number }
export type GroupedSide = { points: SidePoint[]; max: number }

/** 深度图固定展示中间价 ±0.5%（整幅 1%），与币安范围选择器的默认档接近。 */
export const DEPTH_RANGE_PCT = 1
/** 每侧价格桶数量；真实盘口按价格桶聚合后，累计曲线才会均匀。 */
export const DEPTH_BUCKETS = 80

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 把原始价位聚合成等宽价格桶，再返回累计量折线点。
 * bid 点从远价到中间价，累计量单调降到 0；ask 从中间价到远价，累计量单调升到最大值。
 */
export function groupDepthSide(
  levels: DepthLevel[],
  side: 'bid' | 'ask',
  mid: number,
  halfSpan: number,
  buckets = DEPTH_BUCKETS,
): GroupedSide {
  if (!levels.length || !Number.isFinite(halfSpan) || halfSpan <= 0) {
    return { points: [], max: 0 }
  }
  const count = Math.max(1, Math.floor(buckets))
  const step = halfSpan / count
  const quantities = new Array<number>(count).fill(0)
  const notionals = new Array<number>(count).fill(0)

  for (const level of levels) {
    const offset = side === 'bid' ? mid - level.price : level.price - mid
    if (!Number.isFinite(offset) || offset < 0 || offset > halfSpan) continue
    const index = clamp(Math.floor(offset / step), 0, count - 1)
    quantities[index] += level.qty
    notionals[index] += level.price * level.qty
  }

  // totals[i] = 从中间价到第 i 个边界的累计量；notionalTotals 同步累加名义金额。
  const totals = new Array<number>(count + 1).fill(0)
  const notionalTotals = new Array<number>(count + 1).fill(0)
  for (let i = 0; i < count; i++) {
    totals[i + 1] = totals[i] + quantities[i]
    notionalTotals[i + 1] = notionalTotals[i] + notionals[i]
  }

  const points: SidePoint[] = []
  if (side === 'bid') {
    for (let i = count; i >= 0; i--) {
      points.push({ price: mid - i * step, total: totals[i], notional: notionalTotals[i] })
    }
  } else {
    for (let i = 0; i <= count; i++) {
      points.push({ price: mid + i * step, total: totals[i], notional: notionalTotals[i] })
    }
  }
  return { points, max: totals[count] }
}
