import { createContext } from 'mve-core'
import { createSignal, memo, addEffect } from 'wy-helper'
import { delegate, js, storage } from 'object-oriented-c-language'
import { dom, text, html } from './dom.js'
import { fc, forEach } from './fc.js'

/** 运行时的完整桥接 globals 集合（含 storage/js/delegate、视图组件与响应式信号）。
 *  example/sandbox 等宿主一行注入：`createInterpretAction(..., createBridgeGlobals())`，
 *  不再逐个显式 import 桥接对象。类型侧用 createBridgeGlobalsTypes()（Route A）。
 */
export function createBridgeGlobals() {
  return {
    storage,
    js,
    delegate,
    fc,
    createContext,
    dom,
    html,
    text,
    createSignal,
    memo,
    addEffect,
    forEach,
  }
}

export type { Globals } from 'object-oriented-c-language'