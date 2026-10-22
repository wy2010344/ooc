// chart-view.ts — K 线视口与几何：可见区间、蜡烛盒、价格/时间刻度、十字线。
//
// 视口用「可见根数 + 距最新一根的偏移」表示：
//   offset = 0 表示贴着右边缘（跟随最新），offset > 0 表示往回翻了几根。
// 坐标全部用百分比，组件侧直接写 style.top / style.left，不依赖像素测量；
// 像素只在两处用到：滚轮缩放的光标锚点、拖拽平移的位移换算。
import type { Candle } from './market.js'

/** 一根 K 线最少/最多显示多少根。 */
export const MIN_VISIBLE = 12
export const MAX_VISIBLE = 360
export const DEFAULT_VISIBLE = 90

/** 价格区占绘图高度的比例，下方留给成交量柱。 */
export const PRICE_AREA = 78
/** 成交量柱区的顶边（百分比）。 */
export const VOLUME_TOP = 82

const MAX_PRICE_TICKS = 8
const MIN_PRICE_TICKS = 2

export type ChartFrame = {
  total: number
  /** 实际可见根数（数据不足时会小于配置值） */
  count: number
  /** 距最新一根的偏移 */
  offset: number
  start: number
  end: number
}

export type CandleBox = {
  key: number
  /** 相对绘图宽度的百分比位置（左边缘） */
  left: number
  width: number
  up: boolean
  bodyTop: number
  bodyHeight: number
  wickTop: number
  wickHeight: number
  /** 成交量柱：顶部与高度（相对绘图高度） */
  volumeTop: number
  volumeHeight: number
}

export type PriceTick = { value: number; top: number }

export type TimeTick = {
  left: number
  text: string
  /** 标签对齐：两端贴边，中间居中 */
  align: 'start' | 'mid' | 'end'
}

export type ChartLayout = {
  hasData: boolean
  frame: ChartFrame
  /** 可见区间的原始 K 线（悬停取用） */
  candles: Candle[]
  boxes: CandleBox[]
  priceTicks: PriceTick[]
  timeTicks: TimeTick[]
  /** 含上下留白的价格范围 */
  high: number
  low: number
  last: number
  /** 最新价在价格区内的位置（百分比） */
  lastTop: number
  /** 最新一根是否在可见区间内 */
  showLast: boolean
  /** 可见区间的时长（毫秒），用于时间轴格式 */
  spanMs: number
  pinned: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 实际可见根数：不超过数据量、不低于下限。 */
export function visibleCount(total: number, count: number): number {
  const max = Math.max(1, Math.min(MAX_VISIBLE, total || MAX_VISIBLE))
  const min = Math.min(MIN_VISIBLE, max)
  return clamp(Math.round(Number.isFinite(count) ? count : DEFAULT_VISIBLE), min, max)
}

function clampOffset(total: number, count: number, offset: number): number {
  return clamp(Math.round(Number.isFinite(offset) ? offset : 0), 0, Math.max(0, total - count))
}

export function chartFrame(total: number, count: number, offset: number): ChartFrame {
  const c = visibleCount(total, count)
  const off = clampOffset(total, c, offset)
  const end = Math.max(0, total - off)
  const start = Math.max(0, end - c)
  return { total, count: c, offset: off, start, end }
}

/** 以锚点（0~1，光标横向位置）为中心缩放；锚点下的那根 K 线保持不动。 */
export function zoomFrame(
  total: number,
  count: number,
  offset: number,
  factor: number,
  anchor = 0.5,
): { count: number; offset: number } {
  const frame = chartFrame(total, count, offset)
  const span = Math.max(1, frame.end - frame.start)
  const ratio = clamp(Number.isFinite(anchor) ? anchor : 0.5, 0, 1)
  const at = frame.start + ratio * span
  const next = visibleCount(total, frame.count * (Number.isFinite(factor) ? factor : 1))
  const nextStart = Math.round(at - ratio * next)
  return { count: next, offset: clampOffset(total, next, total - next - nextStart) }
}

/** 平移：delta > 0 表示往更早的方向翻（内容向右移动）。 */
export function panFrame(
  total: number,
  count: number,
  offset: number,
  delta: number,
): { count: number; offset: number } {
  const frame = chartFrame(total, count, offset)
  return { count: frame.count, offset: clampOffset(total, frame.count, frame.offset + delta) }
}

/** 取 1 / 2 / 2.5 / 5 / 10 × 10ⁿ 这类「好看」的刻度步长；按对数距离取最近的一档。 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const candidates = [1, 2, 2.5, 5, 10]
  let best = candidates[0]
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = Math.abs(Math.log(candidate / fraction))
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best * power
}

function priceTicksOf(high: number, low: number): PriceTick[] {
  const span = high - low
  if (!Number.isFinite(span) || span <= 0) return []
  // 目标 6 段：段数太少（3 条线）看不出形状，太多又会挤。
  const step = niceStep(span / 6)
  const first = Math.ceil(low / step) * step
  const ticks: PriceTick[] = []
  for (let i = 0; i < MAX_PRICE_TICKS + 2; i++) {
    const value = first + i * step
    if (value > high) break
    // 去掉浮点尾差，刻度值才能和格式化结果一致
    const rounded = Number(value.toPrecision(12))
    ticks.push({ value: rounded, top: ((high - rounded) / span) * PRICE_AREA })
  }
  if (ticks.length < MIN_PRICE_TICKS) return []
  return ticks
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** 时间轴标签：跨度越长越粗，避免一屏里出现两段同样的 12:30。 */
export function formatAxisTime(time: number, spanMs: number): string {
  const date = new Date(time)
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (spanMs >= 36 * 3600_000) return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  if (spanMs >= 20 * 3600_000) return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`
  return clock
}

/** 价格轴刻度：比行情页的 formatPrice 少一位视觉噪声，尽量塞进 64px 的轴列。 */
export function formatAxisPrice(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function timeTicksOf(candles: Candle[], spanMs: number, widthPx: number): TimeTick[] {
  const n = candles.length
  if (!n) return []
  // 每个标签按 96px 估算：宽面板多给几个，窄面板只留首尾。
  const want = clamp(Math.floor((widthPx || 520) / 96), 2, 7)
  const count = Math.min(want, n)
  const ticks: TimeTick[] = []
  let previous = ''
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.round((i * (n - 1)) / (count - 1))
    const text = formatAxisTime(candles[index].time, spanMs)
    // 跨度大时标签只到「日」，相邻两个可能撞成同一个字：跳过重复的那一个。
    if (text === previous) continue
    previous = text
    ticks.push({
      left: ((index + 0.5) / n) * 100,
      text,
      align: i === 0 ? 'start' : i === count - 1 ? 'end' : 'mid',
    })
  }
  return ticks
}

const EMPTY_LAYOUT = (frame: ChartFrame): ChartLayout => ({
  hasData: false,
  frame,
  candles: [],
  boxes: [],
  priceTicks: [],
  timeTicks: [],
  high: 0,
  low: 0,
  last: 0,
  lastTop: 0,
  showLast: false,
  spanMs: 0,
  pinned: true,
})

function buildLayout(
  all: Candle[],
  count: number,
  offset: number,
  widthPx: number,
): ChartLayout {
  const frame = chartFrame(all.length, count, offset)
  const candles = all.slice(frame.start, frame.end)
  if (!candles.length) return EMPTY_LAYOUT(frame)

  let rawHigh = -Infinity
  let rawLow = Infinity
  let volumeMax = 0
  for (const candle of candles) {
    if (candle.high > rawHigh) rawHigh = candle.high
    if (candle.low < rawLow) rawLow = candle.low
    if (candle.volume > volumeMax) volumeMax = candle.volume
  }
  // 上下各留 8% 呼吸位，避免影线贴边、最新价标签压到刻度上。
  const padding = (rawHigh - rawLow) * 0.08 || Math.abs(rawHigh) * 0.0006 || 1
  const high = rawHigh + padding
  const low = rawLow - padding
  const span = high - low || 1
  const yOf = (value: number) => ((high - value) / span) * PRICE_AREA

  const step = 100 / candles.length
  const width = Math.max(step * 0.62, 0.14)
  const volumeRange = Math.max(volumeMax, 1e-12)
  const boxes: CandleBox[] = candles.map((candle, index) => {
    const openY = yOf(candle.open)
    const closeY = yOf(candle.close)
    const volumeHeight = (candle.volume / volumeRange) * (100 - VOLUME_TOP)
    return {
      key: candle.time,
      left: index * step + step / 2 - width / 2,
      width,
      up: candle.close >= candle.open,
      bodyTop: Math.min(openY, closeY),
      bodyHeight: Math.max(Math.abs(closeY - openY), 0.55),
      wickTop: yOf(candle.high),
      wickHeight: Math.max(yOf(candle.low) - yOf(candle.high), 0.55),
      volumeTop: 100 - volumeHeight,
      volumeHeight,
    }
  })

  const lastCandle = candles[candles.length - 1]
  const newest = all[all.length - 1]
  const last = newest ? newest.close : lastCandle.close
  const lastInView = !!newest && frame.offset === 0
  const first = candles[0].time
  const spanMs = candles.length > 1 ? lastCandle.time - first : 0
  const lastPriceValue = newest ? newest.close : lastCandle.close
  const lastTop = lastInView ? yOf(lastPriceValue) : yOf(lastCandle.close)

  return {
    hasData: boxes.length > 0,
    frame,
    candles,
    boxes,
    // 最新价标签是实心的，盖住附近的刻度更干净（和币安一样让位给标签）。
    priceTicks: priceTicksOf(high, low).filter((tick) => Math.abs(tick.top - lastTop) > 3.5),
    timeTicks: timeTicksOf(candles, spanMs, widthPx),
    high,
    low,
    last,
    lastTop,
    showLast: lastInView,
    spanMs,
    pinned: frame.offset === 0,
  }
}

// 同一份 K 线/视口会被十几个 getter 反复读取，只算一次；悬停不参与换缓存。
let layoutCache: {
  candles: Candle[]
  count: number
  offset: number
  width: number
  layout: ChartLayout
} | null = null

export function chartLayout(
  all: Candle[] | null | undefined,
  count: number,
  offset: number,
  widthPx = 0,
): ChartLayout {
  const candles = all ?? []
  if (
    layoutCache &&
    layoutCache.candles === candles &&
    layoutCache.count === count &&
    layoutCache.offset === offset &&
    layoutCache.width === widthPx
  ) {
    return layoutCache.layout
  }
  const layout = buildLayout(candles, count, offset, widthPx)
  layoutCache = { candles, count, offset, width: widthPx, layout }
  return layout
}

export type ChartHover = {
  candle: Candle
  /** 光标纵坐标对应的价格 */
  price: number
  /** 吸附到 K 线中心的横向位置（百分比） */
  x: number
  /** 标签的横向位置（贴边时收紧） */
  labelX: number
  y: number
  index: number
  /** 相对上一根的涨跌幅（第一根为 null） */
  changePct: number | null
  /** 时间轴标签 */
  timeText: string
  /** 表头用的涨跌幅文本 */
  changeText: string
}

/** 光标 → 十字线与 OHLC；x 吸附到最近的 K 线，y 只决定价格。 */
export function chartHover(
  layout: ChartLayout,
  ratioX: number | null,
  ratioY: number | null,
): ChartHover | null {
  if (ratioX === null || ratioY === null) return null
  if (!Number.isFinite(ratioX) || !Number.isFinite(ratioY)) return null
  const n = layout.candles.length
  if (!n) return null

  const index = clamp(Math.floor(ratioX * n), 0, n - 1)
  const candle = layout.candles[index]
  const x = ((index + 0.5) / n) * 100
  const y = Math.min(clamp(ratioY, 0, 1) * 100, PRICE_AREA)
  const span = layout.high - layout.low || 1
  const price = layout.high - (y / PRICE_AREA) * span
  const prev = index > 0 ? layout.candles[index - 1].close : null
  const changePct = prev && prev > 0 ? ((candle.close - prev) / prev) * 100 : null
  return {
    candle,
    price,
    x,
    labelX: clamp(x, 6, 94),
    y,
    index,
    changePct,
    timeText: formatAxisTime(candle.time, layout.spanMs),
    changeText:
      changePct === null ? '--' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`,
  }
}

/** 光标相对绘图区的比例；拖拽/缩放都用它把像素换算成根数。 */
export function pointerRatio(event: PointerEvent | MouseEvent): { x: number; y: number } | null {
  const el = event.currentTarget as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  }
}

/** 滚轮：以光标为锚点缩放。 */
export function zoomByEvent(
  total: number,
  count: number,
  offset: number,
  event: WheelEvent,
): { count: number; offset: number } {
  event.preventDefault()
  const el = event.currentTarget as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  const anchor =
    rect && rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5
  const delta = Number.isFinite(event.deltaY) ? event.deltaY : 0
  const factor = clamp(Math.exp(delta * 0.0015), 0.5, 2)
  return zoomFrame(total, count, offset, factor, anchor)
}

/** 按钮缩放：以中线为锚点。 */
export function zoomByStep(
  total: number,
  count: number,
  offset: number,
  factor: number,
): { count: number; offset: number } {
  return zoomFrame(total, count, offset, factor, 0.5)
}

/** 拖拽平移：像素位移换算成根数。 */
export function panByPixels(
  total: number,
  count: number,
  offset: number,
  dxPixels: number,
  plotWidth: number,
): { count: number; offset: number } {
  const frame = chartFrame(total, count, offset)
  const perCandle = plotWidth > 0 ? plotWidth / Math.max(1, frame.end - frame.start) : 12
  const delta = Number.isFinite(dxPixels) ? dxPixels / perCandle : 0
  return panFrame(total, count, offset, delta)
}

/** 拖拽时把指针捕获到绘图区，移出面板也能继续接收事件。 */
export function capturePointer(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement | null
  const id = event.pointerId
  if (!el || id === undefined || id === null) return
  try {
    el.setPointerCapture(id)
  } catch {
    // 部分浏览器对已释放的 pointerId 会抛错，忽略即可
  }
}

export function releasePointer(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement | null
  const id = event.pointerId
  if (!el || id === undefined || id === null) return
  try {
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id)
  } catch {
    // 同上：捕获已释放时无需处理
  }
}
