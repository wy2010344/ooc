// feed.ts — 行情数据源门面：币安实时行情 ⇄ 本机伪报文，随时可切。
//
// 伪报文服务是独立项目 C:\github\mock-api（在那边 `npm run dev`，端口固定 8787），
// 路径与币安一致，所以这里只需要换基址 + 传输方式（WS → SSE）。
//
// 切换方式（优先级从高到低）：
//   ?feed=live|mock        地址栏指定，会记住
//   ?mock=http://host:port 指定伪报文服务地址，会记住
//   localStorage           上次的选择
//   VITE_MOCK_API          构建期默认地址
//   默认                    http://localhost:8787
// 页面右上角 MOCK 按钮等价于切换 feed。币安报 418/429 等硬错误时会自动接管到伪报文。

import {
  LIVE_GATEWAY,
  createMarketSession as createBinanceSession,
  createWatchlistSession as createBinanceWatchlist,
  setGateway,
  type Gateway,
  type MarketHandlers,
  type MarketStatus,
  type WatchlistHandlers,
} from './market.js'

// 纯函数 / 格式化 / 类型原样透出，页面只 import 这一个模块。
export * from './market.js'

/** 本机伪报文服务默认地址（mock-api 项目的 dev 端口）。 */
const DEFAULT_MOCK_ORIGIN = 'http://localhost:8787'
const ENV_MOCK_ORIGIN = import.meta.env.VITE_MOCK_API as string | undefined

const STORAGE_SOURCE = 'ooc.market.source'
const STORAGE_ORIGIN = 'ooc.market.mock'

function envMockOrigin(): string {
  return parseOrigin(String(ENV_MOCK_ORIGIN ?? '')) ?? DEFAULT_MOCK_ORIGIN
}

function readMockOrigin(): string {
  const fallback = envMockOrigin()
  try {
    const fromQuery = readParam('mock')
    if (fromQuery) {
      // ?mock=1 只开开关，地址沿用默认/已记住的。
      if (SWITCH_ONLY.test(fromQuery.trim())) return fallback
      const parsed = parseOrigin(fromQuery)
      if (parsed) {
        window.localStorage.setItem(STORAGE_ORIGIN, parsed)
        return parsed
      }
      // 写法认不出来：清掉可能残留的坏值，回默认，别让请求落到 dev server 上。
      window.localStorage.removeItem(STORAGE_ORIGIN)
      return fallback
    }
    const saved = window.localStorage.getItem(STORAGE_ORIGIN)
    if (saved) {
      const parsed = parseOrigin(saved)
      if (parsed) {
        // 顺手把「8787」「localhost」这类简写存成规范地址。
        if (parsed !== saved) window.localStorage.setItem(STORAGE_ORIGIN, parsed)
        return parsed
      }
      window.localStorage.removeItem(STORAGE_ORIGIN)
    }
  } catch {
    // 隐私模式下读不到 storage，走默认值
  }
  return fallback
}

/** 落到备用源之后，隔多久再试首选源。 */
const RETRY_MS = 60_000
/** 两次自动切换的最小间隔，防止两边都挂时来回抖。 */
const SWITCH_GUARD_MS = 15_000
/** 探活超时：本地服务应当是毫秒级，超过这个时间就当没起。 */
const PROBE_TIMEOUT_MS = 2_500
/** 硬失败：HTTP 4xx/5xx（418 限频、404 未部署）或浏览器层面的网络错误。 */
const HARD_FAIL = /Binance (4\d{2}|5\d{2})|Failed to fetch|NetworkError|Load failed|ERR_NETWORK/i

type Source = 'live' | 'mock'

/** `?mock=1` / `?mock=true` 这类只表示「启用伪报文」，地址仍用默认的。 */
const SWITCH_ONLY = /^(1|true|on|yes|mock)$/i

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/**
 * 把各种写法的地址归一成 `http(s)://host[:port]`。
 * 认不出来就返回 null —— 关键是不能让半截字符串（`1`、`8787`、`localhost`）
 * 原样拼进请求路径，那样会变成相对路径打到 dev server 自己身上（5173 的 404）。
 */
function parseOrigin(raw: string): string | null {
  const text = normalizeOrigin(raw)
  if (!text || SWITCH_ONLY.test(text)) return null
  // 只写端口：?mock=8787
  if (/^\d{2,5}$/.test(text)) {
    const port = Number(text)
    return port > 0 && port < 65536 ? `http://localhost:${text}` : null
  }
  // 剩下的只认 [http(s)://]host[:port]；带路径的一律丢弃（我们只要 origin）。
  const hit = /^(?:(https?):\/\/)?([\w.-]+)(?::(\d{2,5}))?$/i.exec(text)
  if (!hit) return null
  const protocol = (hit[1] ?? 'http').toLowerCase()
  const host = hit[2]
  // 没写端口时补默认端口，否则 http://localhost 会去连 80 端口，永远连不上。
  const port = hit[3] ?? (protocol === 'http' ? defaultPort() : '')
  const suffix = port && port !== '80' && port !== '443' ? `:${port}` : ''
  try {
    const url = new URL(`${protocol}://${host}${suffix}`)
    return url.host ? `${url.protocol}//${url.host}` : null
  } catch {
    return null
  }
}

/** 默认伪报文服务的端口，跟 DEFAULT_MOCK_ORIGIN 保持一致。 */
function defaultPort(): string {
  try {
    return new URL(DEFAULT_MOCK_ORIGIN).port || '8787'
  } catch {
    return '8787'
  }
}

/**
 * 读地址栏参数。页面是 hash 路由，`?feed=mock#/dashboard` 与 `#/dashboard?feed=mock`
 * 两种写法都认，免得非要记住参数放哪边。
 */
function readParam(name: string): string | null {
  const direct = new URLSearchParams(window.location.search).get(name)
  if (direct) return direct
  const hash = window.location.hash
  const index = hash.indexOf('?')
  if (index < 0) return null
  return new URLSearchParams(hash.slice(index + 1)).get(name)
}

function readPreferred(): Source {
  try {
    const query = readParam('feed')
    if (query === 'live' || query === 'mock') {
      window.localStorage.setItem(STORAGE_SOURCE, query)
      return query
    }
    return window.localStorage.getItem(STORAGE_SOURCE) === 'mock' ? 'mock' : 'live'
  } catch {
    return 'live'
  }
}

function persistSource(next: Source): void {
  try {
    window.localStorage.setItem(STORAGE_SOURCE, next)
  } catch {
    // 忽略：只是记不住选择
  }
}

/** 伪报文服务的地址（页面可以显示出来，方便排查）。 */
let mockOrigin = readMockOrigin()
let preferred: Source = readPreferred()
let source: Source = preferred
let lastSwitchAt = 0
let revertTimer: ReturnType<typeof setTimeout> | undefined

/** 源切换时通知所有在跑的会话重建。 */
const listeners = new Set<(note: string) => void>()
/** 只想弹一条提示、不重建会话时走这里。 */
const errorSinks = new Set<(message: string) => void>()

function mockGateway(): Gateway {
  // 再兜一次底：万一 mockOrigin 被写坏成相对路径，请求会打到 dev server 自己身上变成 404。
  const origin = parseOrigin(mockOrigin) ?? DEFAULT_MOCK_ORIGIN
  return { rest: `${origin}/api/v3`, stream: `${origin}/stream`, transport: 'sse' }
}

function gatewayOf(next: Source): Gateway {
  return next === 'mock' ? mockGateway() : LIVE_GATEWAY
}

setGateway(gatewayOf(source))

/** 当前实际用着伪报文吗。 */
export function isMockMode(): boolean {
  return source === 'mock'
}

/** 页面按钮用：偏好是伪报文（可能因为服务没起而暂时落在实时）。 */
export function isMockForced(): boolean {
  return preferred === 'mock'
}

/** 伪报文服务地址。 */
export function mockServiceOrigin(): string {
  return mockOrigin
}

/** 探活：伪报文服务是否在跑。 */
export async function probeMock(candidate: string = mockOrigin): Promise<boolean> {
  const origin = parseOrigin(candidate)
  // 地址认不出来就别拿相对路径去探活——那只会探到 dev server 自己的 404。
  if (!origin) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${origin}/api/v3/ping`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function notifyError(message: string): void {
  for (const sink of errorSinks) sink(message)
}

/** 改伪报文服务地址（比如 mock-api 换端口了），会记住并立刻重连。 */
export function setMockOrigin(next: string): boolean {
  const parsed = parseOrigin(next)
  if (!parsed) {
    notifyError(`伪报文地址不合法：${next}（要形如 http://localhost:8787）`)
    return false
  }
  mockOrigin = parsed
  try {
    window.localStorage.setItem(STORAGE_ORIGIN, mockOrigin)
  } catch {
    // 忽略
  }
  if (source === 'mock') switchSource('mock', `伪报文地址改为 ${mockOrigin}`)
  return true
}

/**
 * 在「伪报文 / 币安实时」之间切换偏好。
 * 切到伪报文前先探活：服务没起就只提示、不改数据源，免得界面挂成一片空白。
 */
export function toggleMockMode(_event?: unknown): boolean {
  const target: Source = preferred === 'mock' ? 'live' : 'mock'
  preferred = target
  persistSource(target)

  if (target === 'live') {
    switchSource('live', source === 'mock' ? '已切回币安实时行情' : '')
    return false
  }

  void probeMock().then((ok) => {
    if (!ok) {
      preferred = 'live'
      persistSource('live')
      notifyError(`伪报文服务没响应：${mockOrigin}（先在 mock-api 项目里 npm run dev）`)
      return
    }
    switchSource('mock', `已切到本机伪报文：${mockOrigin}`)
  })
  return true
}

function reasonOf(message: string): string {
  const hit = /Binance (\d{3})/.exec(message)
  return hit ? `HTTP ${hit[1]}` : '网络不可达'
}

function switchSource(next: Source, note: string): void {
  const changed = next !== source
  source = next
  lastSwitchAt = Date.now()
  setGateway(gatewayOf(next))
  if (revertTimer) {
    clearTimeout(revertTimer)
    revertTimer = undefined
  }
  // 自动回退是临时的：过一会儿再试首选源。
  if (next !== preferred) {
    revertTimer = setTimeout(() => {
      revertTimer = undefined
      switchSource(preferred, '')
    }, RETRY_MS)
  }
  if (!changed && !note) return
  for (const restart of listeners) restart(note)
}

/** 一路挂了就换另一路，带节流；换过去之前先确认对面真的活着。 */
function failover(failed: Source, message: string): void {
  if (Date.now() - lastSwitchAt < SWITCH_GUARD_MS) return
  if (failed === 'mock') {
    switchSource('live', `伪报文不可用（${reasonOf(message)}），已切回币安实时行情`)
    return
  }
  void probeMock().then((ok) => {
    if (ok) {
      switchSource('mock', `币安接口不可用（${reasonOf(message)}），已切到本机伪报文`)
    } else {
      notifyError(`币安接口不可用（${reasonOf(message)}），伪报文服务也没起：${mockOrigin}`)
    }
  })
}

type SwitcherOptions = {
  onStatus?(status: MarketStatus): void
  onError?(message: string): void
}

/**
 * 会话骨架：按当前数据源建会话，源切换时整体重建。
 * open 拿到的 fail 由调用方在「真实报错」时触发，交由 failover 决定是否换源。
 */
function createSwitcher(
  open: (fail: (message: string) => void) => () => void,
  options: SwitcherOptions,
): () => void {
  let closed = false
  let stop: (() => void) | null = null

  const restart = (note: string) => {
    if (closed) return
    const previous = stop
    stop = null
    previous?.()
    options.onStatus?.(source === 'mock' ? 'mock' : 'connecting')
    stop = open((message) => {
      if (!closed) failover(source, message)
    })
    // 首帧快照会清空错误行，来源提示要晚一步再说。
    if (note) {
      setTimeout(() => {
        if (!closed) options.onError?.(note)
      }, 1200)
    }
  }

  listeners.add(restart)
  // 只弹提示的通道也要在卸载时摘掉，否则旧会话会一直被通知。
  const sink = options.onError
  if (sink) errorSinks.add(sink)

  // 首启用伪报文的话先探活，服务没起就直接落回币安，别让页面空着等。
  const boot = setTimeout(() => {
    if (closed) return
    if (source !== 'mock') {
      restart('')
      return
    }
    void probeMock().then((ok) => {
      if (closed) return
      if (ok) {
        restart('')
        return
      }
      preferred = 'live'
      persistSource('live')
      switchSource('live', `伪报文服务没响应：${mockOrigin}（先在 mock-api 项目里 npm run dev）`)
    })
  }, 0)

  const dispose = () => {
    closed = true
    clearTimeout(boot)
    listeners.delete(restart)
    if (sink) errorSinks.delete(sink)
    stop?.()
    // 这里刻意不回写 'offline'：dispose 由页面的 addDestroy 触发，
    // 而路由切页发生在信号批次的 listener 阶段（onWorkBatch 已置位），
    // 此时对仍有订阅者的 status 写值会被信号库判为非法（"计算期间不允许修改值"）。
    // 使用方已经卸载，状态也没有展示意义；换源/换币造成的短暂空档由后续 'connecting' 覆盖。
  }
  return dispose
}

/** 主行情会话：伪报文 / 币安实时共用一套接口。 */
export function createMarketSession(
  symbol: string,
  interval: string,
  handlers: MarketHandlers,
): () => void {
  return createSwitcher(
    (fail) =>
      createBinanceSession(symbol, interval, {
        onSnapshot: handlers.onSnapshot,
        onTicker: handlers.onTicker,
        onKline: handlers.onKline,
        onDepth: handlers.onDepth,
        onTrade: handlers.onTrade,
        onStatus(status) {
          if (status === 'live') handlers.onError?.('')
          // 伪报文模式下状态保持 MOCK，别让界面显示成「实时」。
          handlers.onStatus?.(status === 'live' && source === 'mock' ? 'mock' : status)
        },
        onError(message) {
          handlers.onError?.(message)
          if (HARD_FAIL.test(message)) fail(message)
        },
      }),
    handlers,
  )
}

/** 自选行情会话：同样跟着数据源切换。 */
export function createWatchlistSession(
  symbols: string[],
  handlers: WatchlistHandlers,
): () => void {
  return createSwitcher(
    (fail) =>
      createBinanceWatchlist(symbols, {
        onTickers: handlers.onTickers,
        onTicker: handlers.onTicker,
        onError(message) {
          handlers.onError?.(message)
          if (HARD_FAIL.test(message)) fail(message)
        },
      }),
    { onStatus: handlers.onStatus, onError: handlers.onError },
  )
}
