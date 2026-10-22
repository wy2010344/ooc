// 币安公开行情：REST 快照 + 实时推送（WebSocket / SSE），无需 API Key。
// 默认走币安官方公开域名；也可以整体切到 toolkit 的伪报文网关（见 feed.ts），
// 此时 REST 仍走 /api/v3/**，实时流换成 SSE，帧结构与 wss 完全一致。
// 只使用公开市场数据，不涉及账户 / 交易接口。
//
// 深度图用的是「REST 全簿快照 + @depth 增量流」自建的本地订单簿（见 order-book.ts），
// 不靠定时轮询 REST：5000 档快照每拉一次的权重是 50，轮询是全套接口里最贵的取法。

import { createLocalBook, type DepthDiff, type DepthSnapshot } from './order-book.js'

export type Transport = 'ws' | 'sse'

export type Gateway = {
  /** REST 基址，形如 https://data-api.binance.vision/api/v3 */
  rest: string
  /** 组合流入口：ws 用 wss://.../stream?streams=，sse 用 https://.../_stream?streams= */
  stream: string
  transport: Transport
}

/** 币安官方公开行情。 */
export const LIVE_GATEWAY: Gateway = {
  rest: 'https://data-api.binance.vision/api/v3',
  stream: 'wss://data-stream.binance.vision/stream?streams=',
  transport: 'ws',
}

let gateway: Gateway = LIVE_GATEWAY

/** 切换数据源；由 feed.ts 在建立会话前调用。 */
export function setGateway(next: Gateway): void {
  gateway = next
}

export type Ticker = {
  symbol: string
  last: number
  change: number
  changePercent: number
  high: number
  low: number
  open: number
  volume: number
  quoteVolume: number
  bid: number
  ask: number
  time: number
}

export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closed: boolean
}

export type Trade = {
  id: number
  price: number
  qty: number
  time: number
  buyerMaker: boolean
}

export type DepthLevel = { price: number; qty: number }

export type Depth = {
  bids: DepthLevel[]
  asks: DepthLevel[]
  time: number
}

export type MarketSnapshot = {
  ticker: Ticker | null
  klines: Candle[]
  depth: Depth | null
  trades: Trade[]
}

export type MarketHandlers = {
  onSnapshot?(snapshot: MarketSnapshot): void
  onTicker?(ticker: Ticker): void
  onKline?(candle: Candle): void
  onDepth?(depth: Depth): void
  onTrade?(trade: Trade): void
  onStatus?(status: MarketStatus): void
  onError?(message: string): void
}

export type MarketStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'mock'
  | 'offline'

type BinanceTicker = Record<string, string>
type BinanceKline = (string | number)[]
type BinanceTrade = {
  id: number
  price: string
  qty: string
  time: number
  isBuyerMaker: boolean
}
type BinanceDepth = {
  lastUpdateId: number
  bids: [string, string][]
  asks: [string, string][]
}
type StreamEnvelope = { stream: string; data: Record<string, unknown> }

function num(value: string | number | undefined): number {
  return value === undefined ? 0 : Number(value)
}

function tickerOf(data: Record<string, string | number | undefined>): Ticker {
  const pick = (stream: string, rest: string) => data[stream] ?? data[rest]
  return {
    symbol: String(pick('s', 'symbol') ?? ''),
    last: num(pick('c', 'lastPrice')),
    change: num(pick('p', 'priceChange')),
    changePercent: num(pick('P', 'priceChangePercent')),
    high: num(pick('h', 'highPrice')),
    low: num(pick('l', 'lowPrice')),
    open: num(pick('o', 'openPrice')),
    volume: num(pick('v', 'volume')),
    quoteVolume: num(pick('q', 'quoteVolume')),
    bid: num(pick('b', 'bidPrice')),
    ask: num(pick('a', 'askPrice')),
    time: num(pick('E', 'closeTime')),
  }
}

function candleOf(data: BinanceKline): Candle {
  return {
    time: num(data[0]),
    open: num(data[1]),
    high: num(data[2]),
    low: num(data[3]),
    close: num(data[4]),
    volume: num(data[5]),
    closed: false,
  }
}

function tradeOf(data: BinanceTrade): Trade {
  return {
    id: data.id,
    price: num(data.price),
    qty: num(data.qty),
    time: data.time,
    buyerMaker: data.isBuyerMaker,
  }
}

function depthOf(data: BinanceDepth): Depth {
  return {
    bids: data.bids.map(([price, qty]) => ({ price: num(price), qty: num(qty) })),
    asks: data.asks.map(([price, qty]) => ({ price: num(price), qty: num(qty) })),
    time: Date.now(),
  }
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(gateway.rest + path, { signal })
  if (!response.ok) {
    throw new Error(`Binance ${response.status}: ${path}`)
  }
  return (await response.json()) as T
}

export async function fetchTickers(symbols: string[], signal?: AbortSignal): Promise<Ticker[]> {
  if (!symbols.length) return []
  const query = encodeURIComponent(JSON.stringify(symbols))
  const data = await fetchJson<BinanceTicker[]>(`/ticker/24hr?symbols=${query}`, signal)
  const bySymbol = new Map(data.map((item) => [item.symbol, tickerOf(item)]))
  return symbols.map((symbol) => bySymbol.get(symbol)).filter((item): item is Ticker => !!item)
}

/** K 线一次拉多少根：默认视口 90 根，放大到 360 根时不用再发请求。 */
const CHART_HISTORY = 500
/** 深度图要的档位数；币安 `/depth` 的 limit 上限就是 5000（每侧）。 */
const DEPTH_LIMIT = 5000
/** 增量帧最多 10 帧/秒，合并到 4 帧/秒再推给界面：曲线动得够快，渲染不白烧。 */
const DEPTH_EMIT_MS = 220

/** 拉一次全簿快照；只在建立连接 / 增量断档时调用。 */
export async function fetchDepthSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<DepthSnapshot> {
  return fetchJson<DepthSnapshot>(`/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`, signal)
}

export async function loadSnapshot(
  symbol: string,
  interval: string,
  signal?: AbortSignal,
): Promise<MarketSnapshot> {
  const [ticker, klines, depth, trades] = await Promise.all([
    fetchJson<BinanceTicker>(`/ticker/24hr?symbol=${symbol}`, signal),
    fetchJson<BinanceKline[]>(`/klines?symbol=${symbol}&interval=${interval}&limit=${CHART_HISTORY}`, signal),
    fetchJson<BinanceDepth>(`/depth?symbol=${symbol}&limit=50`, signal),
    fetchJson<BinanceTrade[]>(`/trades?symbol=${symbol}&limit=30`, signal),
  ])
  return {
    ticker: tickerOf(ticker),
    klines: klines.map(candleOf),
    depth: depthOf(depth),
    trades: trades.map(tradeOf),
  }
}

type StreamHandlers = {
  onMessage(data: Record<string, unknown>): void
  onStatus?(status: MarketStatus): void
  onError?(message: string): void
  onOpen?(): void
  /** 连接存活时长（毫秒），用于判断是否为「连上就断」的抖动。 */
  onClose?(lifetime: number): void
}

const MAX_RETRY_DELAY = 20_000
const HEALTHY_LIFETIME = 20_000

// 断线重连的 WebSocket 包装；返回的 close 会清理定时器与连接。
function openSocket(url: string, handlers: StreamHandlers): () => void {
  let closed = false
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let delay = 800
  let openedAt = 0

  const connect = () => {
    if (closed) return
    handlers.onStatus?.('connecting')
    socket = new WebSocket(url)
    socket.onopen = () => {
      if (closed) return
      openedAt = Date.now()
      handlers.onOpen?.()
      handlers.onStatus?.('live')
    }
    socket.onmessage = (event) => {
      if (closed) return
      try {
        const envelope = JSON.parse(String(event.data)) as StreamEnvelope
        if (envelope.data) handlers.onMessage(envelope.data)
      } catch {
        // 忽略非 JSON 心跳/异常帧
      }
    }
    socket.onerror = () => {
      if (!closed) handlers.onError?.('行情连接异常，正在重连')
    }
    socket.onclose = () => {
      if (closed) return
      const lifetime = openedAt ? Date.now() - openedAt : 0
      openedAt = 0
      handlers.onClose?.(lifetime)
      handlers.onStatus?.('reconnecting')
      retryTimer = setTimeout(connect, delay)
      // 只有稳定连接过才重置退避，避免「连上就断」时高频重连。
      delay = lifetime > HEALTHY_LIFETIME ? 800 : Math.min(delay * 1.6, MAX_RETRY_DELAY)
    }
  }

  // 延迟到当前渲染/计算结束后再建立连接，避免在 signal 计算期同步写状态。
  retryTimer = setTimeout(connect, 0)
  return () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    socket?.close()
    // 销毁路径不写状态信号：close() 常在路由切换的批次里同步执行，
    // 此时 status 仍有订阅者，写值会撞上「计算期间不允许修改值」。
  }
}

// 伪报文网关的实时流是 SSE，帧结构与 wss 一致；这里包一层让它具备同样的重连语义。
function openEventStream(url: string, handlers: StreamHandlers): () => void {
  let closed = false
  let source: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let delay = 800
  let openedAt = 0

  const connect = () => {
    if (closed) return
    handlers.onStatus?.('connecting')
    source = new EventSource(url)
    source.onopen = () => {
      if (closed) return
      openedAt = Date.now()
      handlers.onOpen?.()
      handlers.onStatus?.('live')
    }
    source.onmessage = (event) => {
      if (closed) return
      try {
        const envelope = JSON.parse(String(event.data)) as StreamEnvelope
        if (envelope.data) handlers.onMessage(envelope.data)
      } catch {
        // 忽略非 JSON 帧
      }
    }
    source.onerror = () => {
      if (closed) return
      const lifetime = openedAt ? Date.now() - openedAt : 0
      openedAt = 0
      // EventSource 自带重连，但那套退避不可控；这里关掉它自己接管。
      source?.close()
      source = null
      handlers.onClose?.(lifetime)
      handlers.onStatus?.('reconnecting')
      retryTimer = setTimeout(connect, delay)
      delay = lifetime > HEALTHY_LIFETIME ? 800 : Math.min(delay * 1.6, MAX_RETRY_DELAY)
      if (lifetime > HEALTHY_LIFETIME) return
      handlers.onError?.('行情流断开，正在重连')
    }
  }

  retryTimer = setTimeout(connect, 0)
  return () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    source?.close()
    // 同上：销毁即意味着使用方已卸载，不再回写 status。
  }
}

function openStream(url: string, handlers: StreamHandlers): () => void {
  return gateway.transport === 'sse' ? openEventStream(url, handlers) : openSocket(url, handlers)
}

/** ws 用 `前缀 + 流列表`，sse 用 `前缀?streams=…`；两者后面都拼同样的 stream 名。 */
function streamUrlOf(streams: string[]): string {
  const joined = streams.join('/')
  return gateway.transport === 'sse' ? `${gateway.stream}?streams=${joined}&interval=1000` : gateway.stream + joined
}

function streamUrl(symbol: string, interval: string): string {
  const s = symbol.toLowerCase()
  return streamUrlOf([`${s}@ticker`, `${s}@kline_${interval}`, `${s}@depth@100ms`, `${s}@aggTrade`])
}

export function createMarketSession(
  symbol: string,
  interval: string,
  handlers: MarketHandlers,
): () => void {
  const controller = new AbortController()
  let closed = false
  // 连续「连上就断」时降级为 REST 轮询，保证行情仍能刷新。
  let failures = 0
  let polling = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let healthyTimer: ReturnType<typeof setTimeout> | undefined

  const clearHealthy = () => {
    if (healthyTimer) {
      clearTimeout(healthyTimer)
      healthyTimer = undefined
    }
  }
  const stopPolling = () => {
    polling = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }
  const pollSnapshot = () => {
    loadSnapshot(symbol, interval, controller.signal)
      .then((snapshot) => {
        if (!closed) handlers.onSnapshot?.(snapshot)
      })
      .catch(() => {
        // 轮询失败交给下一轮，不覆盖现有数据
      })
  }
  const startPolling = () => {
    if (polling) return
    polling = true
    handlers.onStatus?.('polling')
    pollSnapshot()
    pollTimer = setInterval(pollSnapshot, 4000)
  }

  // 本地全簿：快照拉一次，之后全靠 @depth 增量帧修正，不再定时轮询 REST。
  const book = createLocalBook()
  let emitTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let syncBusy = false
  let syncDelay = 800

  /** 把最新全簿推给界面；增量帧很密，合并后再推。 */
  const flushDepth = () => {
    if (emitTimer) {
      clearTimeout(emitTimer)
      emitTimer = undefined
    }
    if (closed) return
    const depth = book.depth()
    if (depth) handlers.onDepth?.(depth)
  }
  const scheduleEmit = () => {
    if (closed || emitTimer) return
    emitTimer = setTimeout(flushDepth, DEPTH_EMIT_MS)
  }

  const scheduleSync = (delay: number) => {
    if (closed) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(syncBook, delay)
  }
  /** 拉快照重建本地簿；连接建立、断线重连、增量缺帧都走这里。 */
  const syncBook = () => {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    if (closed || syncBusy) return
    syncBusy = true
    fetchDepthSnapshot(symbol, controller.signal)
      .then((snapshot) => {
        if (closed) return
        if (book.reset(snapshot) !== 'resync') {
          syncDelay = 800
          flushDepth()
          return
        }
        // 缓冲的增量帧比这份快照还新：间隔一会儿再拉，别热循环。
        scheduleSync(syncDelay)
        syncDelay = Math.min(syncDelay * 2, 15_000)
      })
      .catch(() => {
        // 限频或网络抖动：退避重试，界面继续用上一份簿。
        scheduleSync((syncDelay = Math.min(syncDelay * 2, 15_000)))
      })
      .finally(() => {
        syncBusy = false
      })
  }

  const closeStream = openStream(streamUrl(symbol, interval), {
    onStatus(status) {
      // 轮询期间不暴露 WebSocket 的 connecting/reconnecting 抖动。
      if (!polling) handlers.onStatus?.(status)
    },
    onError: handlers.onError,
    onOpen() {
      handlers.onError?.('')
      clearHealthy()
      // 断线期间增量流是断的，本地簿已经落后，重连后必须重新对齐。
      syncBook()
      // 连接稳定存活一段时间后才退出轮询，避免「连上就断」时来回切换。
      healthyTimer = setTimeout(() => {
        healthyTimer = undefined
        failures = 0
        stopPolling()
        handlers.onStatus?.('live')
      }, HEALTHY_LIFETIME)
    },
    onClose(lifetime) {
      clearHealthy()
      // 只有稳定连接过才清零；「连上就断」会持续累计并触发轮询降级。
      failures = lifetime > HEALTHY_LIFETIME ? 0 : failures + 1
      if (failures >= 3) startPolling()
    },
    onMessage(data) {
      const type = data.e
      if (type === '24hrTicker') {
        handlers.onTicker?.(tickerOf(data as unknown as BinanceTicker))
      } else if (type === 'kline') {
        const k = data.k as Record<string, string | number | boolean>
        handlers.onKline?.({
          time: num(k.t as number),
          open: num(k.o as string),
          high: num(k.h as string),
          low: num(k.l as string),
          close: num(k.c as string),
          volume: num(k.v as string),
          closed: Boolean(k.x),
        })
      } else if (type === 'aggTrade') {
        handlers.onTrade?.({
          id: num(data.a as number),
          price: num(data.p as string),
          qty: num(data.q as string),
          time: num(data.T as number),
          buyerMaker: Boolean(data.m),
        })
      } else if (type === 'depthUpdate') {
        const diff = data as unknown as DepthDiff
        if (book.apply(diff) === 'resync') syncBook()
        else scheduleEmit()
      }
    },
  })

  loadSnapshot(symbol, interval, controller.signal)
    .then((snapshot) => {
      if (closed) return
      // 本地簿已就绪时，别让 50 档的浅快照把全簿覆盖回去。
      handlers.onSnapshot?.({ ...snapshot, depth: book.depth() ?? snapshot.depth })
    })
    .catch((error: unknown) => {
      if (!closed) handlers.onError?.(String(error))
    })

  return () => {
    closed = true
    clearHealthy()
    stopPolling()
    if (emitTimer) {
      clearTimeout(emitTimer)
      emitTimer = undefined
    }
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    controller.abort()
    closeStream()
    // 不 emit 'offline'：本函数由页面销毁钩子在批次执行期间调用。
  }
}

export type WatchlistHandlers = {
  onTickers?(tickers: Ticker[]): void
  onTicker?(ticker: Ticker): void
  onStatus?(status: MarketStatus): void
  onError?(message: string): void
}

export function createWatchlistSession(
  symbols: string[],
  handlers: WatchlistHandlers,
): () => void {
  const controller = new AbortController()
  let closed = false
  // 与主行情一致：WebSocket 连续抖动时降级为 REST 轮询。
  let failures = 0
  let polling = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let healthyTimer: ReturnType<typeof setTimeout> | undefined

  const clearHealthy = () => {
    if (healthyTimer) {
      clearTimeout(healthyTimer)
      healthyTimer = undefined
    }
  }
  const stopPolling = () => {
    polling = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }
  const pollTickers = () => {
    fetchTickers(symbols, controller.signal)
      .then((tickers) => {
        if (!closed) handlers.onTickers?.(tickers)
      })
      .catch(() => {
        // 下一轮再试
      })
  }
  const startPolling = () => {
    if (polling) return
    polling = true
    handlers.onStatus?.('polling')
    pollTickers()
    pollTimer = setInterval(pollTickers, 8000)
  }

  const streams = symbols.map((symbol) => `${symbol.toLowerCase()}@ticker`)
  const closeStream = openStream(streamUrlOf(streams), {
    onStatus(status) {
      if (!polling) handlers.onStatus?.(status)
    },
    onError: handlers.onError,
    onOpen() {
      clearHealthy()
      healthyTimer = setTimeout(() => {
        healthyTimer = undefined
        failures = 0
        stopPolling()
      }, HEALTHY_LIFETIME)
    },
    onClose(lifetime) {
      clearHealthy()
      failures = lifetime > HEALTHY_LIFETIME ? 0 : failures + 1
      if (failures >= 3) startPolling()
    },
    onMessage(data) {
      if (data.e === '24hrTicker') {
        handlers.onTicker?.(tickerOf(data as unknown as BinanceTicker))
      }
    },
  })

  fetchTickers(symbols, controller.signal)
    .then((tickers) => {
      if (!closed) handlers.onTickers?.(tickers)
    })
    .catch((error: unknown) => {
      if (!closed) handlers.onError?.(String(error))
    })

  return () => {
    closed = true
    clearHealthy()
    stopPolling()
    controller.abort()
    closeStream()
  }
}

// ---------- 图表 / 盘口 / 格式化（纯函数，页面直接调用） ----------

export function upsertTicker(list: Ticker[], ticker: Ticker): Ticker[] {
  const index = list.findIndex((item) => item.symbol === ticker.symbol)
  if (index < 0) return [...list, ticker]
  const next = list.slice()
  next[index] = ticker
  return next
}

export function upsertKline(list: Candle[], candle: Candle, max = CHART_HISTORY): Candle[] {
  if (!list.length) return [candle]
  const last = list[list.length - 1]
  if (last.time === candle.time) {
    return [...list.slice(0, -1), candle]
  }
  return [...list, candle].slice(-max)
}

export function pushTrade(list: Trade[], trade: Trade, max = 30): Trade[] {
  return [trade, ...list].slice(0, max)
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 3 : 5
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return value.toLocaleString('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  })
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function formatTime(value: number | null | undefined): string {
  if (!value) return '--'
  return new Date(value).toLocaleTimeString('en-GB', { hour12: false })
}
