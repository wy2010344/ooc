// depth.ts — 累计深度图几何：共享价格轴、累计量轴、价格桶聚合、固定中间价。
// 价格轴始终以中间价居中，买卖两侧共用同一套 X/Y 刻度，缩放只改变价格跨度。
import type { Depth } from './market.js'
import {
  DEPTH_BUCKETS,
  DEPTH_RANGE_PCT,
  groupDepthSide,
  type SidePoint,
} from './depth-group.js'

const WIDTH = 1000
const HEIGHT = 100
const MIN_ZOOM = 1
const MAX_ZOOM = 24
/** 默认 X 轴刻度数；实际按面板宽度收放，见 depthXTickCount。 */
const X_TICK_COUNT = 9
/** 每个 X 轴标签按 72px 估算。 */
const X_TICK_WIDTH = 72

export type DepthTick = { value: number; top: number }
export type DepthXTick = { value: number; left: number }

export type DepthGeometry = {
  hasData: boolean
  bidMax: number
  askMax: number
  axisMax: number
  rangePct: number
  xTicks: DepthXTick[]
  yTicks: DepthTick[]
  bidArea: string
  bidLine: string
  askArea: string
  askLine: string
  midX: number
}

export type DepthHover = {
  side: 'bid' | 'ask'
  price: number
  total: number
  rangePct: number
  x: number
  y: number
  tipRight: number
  /** 到该价位为止的累计名义金额（USDT） */
  notional: number
}

export type DepthHoverPair = {
  left: DepthHover
  right: DepthHover
  wide: boolean
  maskWidth: number
}

type DepthSeries = {
  z: number
  mid: number
  min: number
  max: number
  halfSpan: number
  bidPoints: SidePoint[]
  askPoints: SidePoint[]
  bidMax: number
  askMax: number
  axisMax: number
  yStep: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 缩放范围固定在 [1, 24]，始终以中间价为中心。 */
/** 面板越窄，X 轴标签越少；否则价格标签会叠在一起。 */
export function depthXTickCount(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return X_TICK_COUNT
  return clamp(Math.floor(width / X_TICK_WIDTH), 3, X_TICK_COUNT)
}

export function clampDepthZoom(zoom: number): number {
  return clamp(Number.isFinite(zoom) ? zoom : 1, MIN_ZOOM, MAX_ZOOM)
}

/** 按钮缩放：只改变价格跨度，不改变中间价位置。 */
export function zoomDepthBy(zoom: number, factor: number): number {
  return clampDepthZoom(zoom * factor)
}

/** 滚轮缩放：以中间价对称缩放，光标位置不变也能保持曲线连续。 */
export function zoomDepthAt(event: WheelEvent, zoom: number): number {
  event.preventDefault()
  return clampDepthZoom(zoom * Math.exp(-event.deltaY * 0.0015))
}

/** 取 1 / 1.25 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 10 这类「好看」的刻度步长。 */
function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const fraction = value / power
  const candidates = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 10]
  const nice = candidates.find((item) => fraction <= item) ?? 10
  return nice * power
}

/** 累计量轴：目标 4 段，轴顶取整到刻度步长的整数倍。 */
function axisScale(rawMax: number): { max: number; step: number } {
  const value = Math.max(rawMax, 1e-8)
  const step = niceStep(value / 4)
  return { max: Math.max(step, Math.ceil(value / step) * step), step }
}

function depthSeries(depth: Depth, zoom: number): DepthSeries {
  const z = clampDepthZoom(zoom)
  const bestBid = depth.bids.length ? depth.bids[0].price : null
  const bestAsk = depth.asks.length ? depth.asks[0].price : null
  const mid =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : bestAsk ?? bestBid ?? 0
  // 固定展示整幅 1%；缩放后跨度变窄，但中心价始终在 50%。
  const halfSpan = Math.max(mid * (DEPTH_RANGE_PCT / 200), 1e-8) / z
  const bidGroup = groupDepthSide(depth.bids, 'bid', mid, halfSpan, DEPTH_BUCKETS)
  const askGroup = groupDepthSide(depth.asks, 'ask', mid, halfSpan, DEPTH_BUCKETS)
  const axis = axisScale(Math.max(bidGroup.max, askGroup.max, 1e-8))
  return {
    z,
    mid,
    min: mid - halfSpan,
    max: mid + halfSpan,
    halfSpan,
    bidPoints: bidGroup.points,
    askPoints: askGroup.points,
    bidMax: bidGroup.max,
    askMax: askGroup.max,
    axisMax: axis.max,
    yStep: axis.step,
  }
}

// 同一份深度/缩放会被多个 getter 反复读取；只聚合一次，避免每次渲染重复扫 1 万档。
let seriesCache: { depth: Depth; zoom: number; series: DepthSeries } | null = null

function seriesOf(depth: Depth, zoom: number): DepthSeries {
  if (seriesCache && seriesCache.depth === depth && seriesCache.zoom === zoom) {
    return seriesCache.series
  }
  const series = depthSeries(depth, zoom)
  seriesCache = { depth, zoom, series }
  return series
}

type StepMode = 'after' | 'before'

function linePath(
  points: SidePoint[],
  xOf: (price: number) => number,
  yOf: (total: number) => number,
  step: StepMode,
): string {
  if (!points.length) return ''
  const first = points[0]
  let prevX = xOf(first.price)
  let path = `M${prevX.toFixed(2)},${yOf(first.total).toFixed(2)}`
  let prevY = yOf(first.total)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    const x = xOf(point.price)
    const y = yOf(point.total)
    // bid 从远价向中间价下降；ask 从中间价向远价上升。
    if (step === 'before') path += `L${prevX.toFixed(2)},${y.toFixed(2)}L${x.toFixed(2)},${y.toFixed(2)}`
    else path += `L${x.toFixed(2)},${prevY.toFixed(2)}L${x.toFixed(2)},${y.toFixed(2)}`
    prevX = x
    prevY = y
  }
  return path
}

function areaPath(
  points: SidePoint[],
  xOf: (price: number) => number,
  yOf: (total: number) => number,
  step: StepMode,
): string {
  const line = linePath(points, xOf, yOf, step)
  if (!line) return ''
  const left = xOf(points[0].price).toFixed(2)
  const right = xOf(points[points.length - 1].price).toFixed(2)
  return `${line}L${right},${HEIGHT}L${left},${HEIGHT}Z`
}

export function formatDepthZoom(zoom: number): string {
  return `${zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0)}×`
}

/** 显示当前 X 轴全宽对应的价差百分比。 */
export function formatDepthRange(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  const digits = value >= 1 ? 2 : value >= 0.1 ? 2 : value >= 0.01 ? 3 : 4
  return `${value.toFixed(digits)}%`
}

/** Tooltip 里的相对中间价偏移，带正负号。 */
export function formatSignedDepthRange(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0005) return '0.0%'
  const abs = Math.abs(value)
  const digits = abs >= 0.1 ? 1 : abs >= 0.01 ? 2 : 3
  return `${value > 0 ? '+' : '-'}${abs.toFixed(digits)}%`
}

/** 计算累计量曲线、共享 Y 轴与价格刻度。 */
export function depthGeometry(
  depth: Depth | null,
  zoom: number,
  xTickCount = X_TICK_COUNT,
): DepthGeometry {
  const hasData = !!depth && (depth.bids.length > 0 || depth.asks.length > 0)
  if (!depth || !hasData) {
    return {
      hasData: false,
      bidMax: 0,
      askMax: 0,
      axisMax: 0,
      rangePct: 0,
      xTicks: [],
      yTicks: [],
      bidArea: '',
      bidLine: '',
      askArea: '',
      askLine: '',
      midX: WIDTH / 2,
    }
  }

  const series = seriesOf(depth, zoom)
  const { mid, min, max, halfSpan, axisMax, yStep } = series
  const xOf = (price: number) => WIDTH / 2 + ((price - mid) / halfSpan) * (WIDTH / 2)
  const yOf = (total: number) => HEIGHT - (total / axisMax) * HEIGHT

  const tickCount = Math.max(2, Math.min(X_TICK_COUNT, Math.round(xTickCount) || X_TICK_COUNT))
  const xTicks: DepthXTick[] = []
  for (let i = 0; i < tickCount; i++) {
    const left = (i / (tickCount - 1)) * 100
    xTicks.push({ value: min + ((max - min) * i) / (tickCount - 1), left })
  }
  const yTicks: DepthTick[] = []
  const count = Math.round(axisMax / yStep)
  for (let i = count; i >= 0; i--) {
    const value = i * yStep
    yTicks.push({ value, top: HEIGHT - (value / axisMax) * HEIGHT })
  }

  return {
    hasData: true,
    bidMax: series.bidMax,
    askMax: series.askMax,
    axisMax,
    rangePct: mid > 0 ? ((max - min) / mid) * 100 : 0,
    xTicks,
    yTicks,
    bidArea: areaPath(series.bidPoints, xOf, yOf, 'before'),
    bidLine: linePath(series.bidPoints, xOf, yOf, 'before'),
    askArea: areaPath(series.askPoints, xOf, yOf, 'after'),
    askLine: linePath(series.askPoints, xOf, yOf, 'after'),
    midX: WIDTH / 2,
  }
}

/** 光标在绘图区内的横向比例；供悬停状态保存，数据刷新时再重算价格。 */
export function pointerRatioAt(event: PointerEvent): number | null {
  const el = event.currentTarget as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  if (!rect || rect.width <= 0) return null
  return clamp((event.clientX - rect.left) / rect.width, 0, 1)
}

/** 折线在某个价格处的点；与 step-before/after 的水平段保持一致。 */
function pointAt(points: SidePoint[], price: number): SidePoint | null {
  if (!points.length) return null
  if (price <= points[0].price) return points[0]
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (price < point.price) return points[i - 1]
    if (price === point.price) return point
  }
  return points[points.length - 1]
}

/** 光标位置 → 价格、累计量、曲线坐标与提示框位置。 */
function depthHoverAt(
  depth: Depth,
  zoom: number,
  ratio: number,
  side: 'bid' | 'ask',
): DepthHover | null {
  const series = seriesOf(depth, zoom)
  const points = side === 'bid' ? series.bidPoints : series.askPoints
  if (!points.length) return null

  const price = clamp(series.mid + (ratio * 2 - 1) * series.halfSpan, series.min, series.max)
  const hit = pointAt(points, price)
  const total = hit ? hit.total : 0
  const x = ratio * WIDTH
  const y = HEIGHT - clamp(total / series.axisMax, 0, 1) * HEIGHT

  return {
    side,
    price,
    total,
    rangePct: series.mid > 0 ? ((price - series.mid) / series.mid) * 100 : 0,
    x,
    y,
    tipRight: 100 - x / 10,
    notional: hit ? hit.notional : 0,
  }
}

/**
 * 光标与镜像位置组成一对：左侧永远是 bid，右侧永远是 ask。
 * wide 表示中间带宽足够放下两张 tooltip；否则 tooltip 向两侧外翻。
 */
export function depthHoverPair(
  depth: Depth | null,
  zoom: number,
  u: number | null,
): DepthHoverPair | null {
  if (u === null || !Number.isFinite(u)) return null
  if (!depth || (!depth.bids.length && !depth.asks.length)) return null
  const ratio = clamp(u, 0, 1)
  const near = Math.min(ratio, 1 - ratio)
  const left = depthHoverAt(depth, zoom, near, 'bid')
  const right = depthHoverAt(depth, zoom, 1 - near, 'ask')
  if (!left || !right) return null
  return {
    left,
    right,
    wide: near < 0.3,
    maskWidth: left.x / 10,
  }
}
