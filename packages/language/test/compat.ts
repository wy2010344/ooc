/**
 * vitest 兼容层，跑在 Node 内置的 node:test 上。
 * 背景：vitest 4 依赖 rolldown、vite 依赖 rollup，二者都要 dlopen 原生 .node，
 * 在 Android/Termux 的 linker namespace 下无法加载（esbuild 因为是子进程所以能用）。
 * 本文件用 node:test + node:assert 复刻测试里用到的 vitest API（describe/test/expect 等）。
 */
import assert from 'node:assert'
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  test,
} from 'node:test'

export { after, afterEach, before, beforeEach, describe, it, test }

/** node:test 没有 beforeAll，用顶层 before 等价 */
export const beforeAll = before

type MatchFn = () => unknown
type Thenable = { then: (...args: never[]) => unknown }

function isMatchFn(value: unknown): value is MatchFn {
  return typeof value === 'function'
}

function isThenable(value: unknown): value is Thenable {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * 复刻 vitest toEqual 语义：递归等值，忽略对象里值为 undefined 的属性；
 * 数组逐位比较（长度也必须一致）；不做原型/类实例检查。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    return (
      a.length === b.length && a.every((item, i) => deepEqual(item, (b as unknown[])[i]))
    )
  }
  if (Array.isArray(b)) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra).filter((key) => ra[key] !== undefined)
  const kb = Object.keys(rb).filter((key) => rb[key] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((key) => key in rb && deepEqual(ra[key], rb[key]))
}

function format(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type ExpectedError = string | RegExp | Error | (new (...args: never[]) => Error)

export function expect(value: unknown) {
  const actual = value
  const asPromise = () => value as Promise<unknown>
  const toEqual = (expected: unknown) =>
    assert.ok(
      deepEqual(actual, expected),
      `expected ${format(actual)} to deeply equal ${format(expected)}`,
    )
  const toContain = (expected: unknown) => {
    if (Array.isArray(actual)) {
      assert.ok(
        (actual as unknown[]).includes(expected),
        `expected ${format(actual)} to contain ${format(expected)}`,
      )
    } else if (typeof actual === 'string') {
      assert.ok(
        (actual as string).includes(String(expected)),
        `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(String(expected))}`,
      )
    } else {
      assert.fail(`cannot toContain on ${typeof actual}`)
    }
  }
  const notContain = (expected: unknown) => {
    if (Array.isArray(actual)) {
      assert.ok(
        !(actual as unknown[]).includes(expected),
        `expected ${format(actual)} not to contain ${format(expected)}`,
      )
    } else if (typeof actual === 'string') {
      assert.ok(
        !(actual as string).includes(String(expected)),
        `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(String(expected))}`,
      )
    } else {
      assert.fail(`cannot toContain on ${typeof actual}`)
    }
  }
  const toThrow = (expected?: ExpectedError) => {
    if (!isMatchFn(value)) {
      assert.fail('expect(fn).toThrow 需要传入函数')
    }
    assert.throws(
      value,
      expected as Parameters<typeof assert.throws>[1],
    )
  }
  const rejectsToThrow = (expected?: ExpectedError) => {
    if (!isThenable(value)) {
      assert.fail('expect(...).rejects 需要传入 Promise')
    }
    return assert.rejects(
      asPromise(),
      expected as Parameters<typeof assert.rejects>[1],
    )
  }
  return {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected)
    },
    toEqual,
    toBeUndefined() {
      assert.strictEqual(actual, undefined)
    },
    toBeTypeOf(type: string) {
      assert.strictEqual(typeof actual, type)
    },
    toBeGreaterThan(expected: number) {
      assert.ok(
        (actual as number) > expected,
        `expected ${String(actual)} > ${expected}`,
      )
    },
    toContain,
    toHaveLength(length: number) {
      assert.strictEqual(
        (actual as { length: number }).length,
        length,
        `expected length ${length}, got ${String((actual as { length: number }).length)}`,
      )
    },
    toThrow,
    not: {
      toBe(expected: unknown) {
        assert.notStrictEqual(actual, expected)
      },
      toEqual(expected: unknown) {
        assert.ok(
          !deepEqual(actual, expected),
          `expected ${format(actual)} not to deeply equal ${format(expected)}`,
        )
      },
      toContain: notContain,
    },
    rejects: {
      toThrow: rejectsToThrow,
    },
    resolves: {
      async toBe(expected: unknown) {
        if (!isThenable(value)) {
          assert.fail('expect(...).resolves 需要传入 Promise')
        }
        assert.strictEqual(await asPromise(), expected)
      },
      async toEqual(expected: unknown) {
        if (!isThenable(value)) {
          assert.fail('expect(...).resolves 需要传入 Promise')
        }
        const resolved = await asPromise()
        assert.ok(
          deepEqual(resolved, expected),
          `expected ${format(resolved)} to deeply equal ${format(expected)}`,
        )
      },
    },
  }
}
