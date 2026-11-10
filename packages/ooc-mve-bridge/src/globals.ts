import { createContext } from 'mve-core'
import { hookTrackSignal } from 'mve-helper'
import { createSignal, memo, addEffect } from 'wy-helper'
import { createLateProxy } from './late-proxy.js'
import { merge, js, storage, union } from 'object-oriented-c-language'
import { dom, text, html } from './dom.js'
import { fc, forEach } from './fc.js'
import {
  canvas,
  canvasDraw,
  align,
  colorToCSS,
  flex,
  grow,
  ignoreFlex,
  layoutSize,
  layoutSizeDirection,
  rgba,
} from './canvas.js'
import {
  align as alignCanvas2,
  createScroll as createScroll2,
  flex as flexCanvas2,
  forEachNode as forEachNode2,
  grow as growCanvas2,
  ifNode as ifNode2,
  textDefaults as textDefaults2,
} from 'mve-dom-helper/canvasRender2'
import { readValue } from './args.js'
import { three } from './three.js'
import { bindSignal, bindRef, multiBind } from './multi-bind.js'
import { createPop, renderPop } from './pop.js'
import { floating } from './floating.js'
import { dark, toggleTheme } from './theme.js'
import {
  iconCheck,
  iconChevronDown,
  iconX,
  provideIconContext,
} from './icons.js'

// canvasRender2 原语在 OOC 侧用 *2 后缀区分 canvas v1（globals 里保持同一套名字）
const flex2 = flexCanvas2
const grow2 = growCanvas2
const align2 = alignCanvas2

/** 运行时的完整桥接 globals 集合（含 storage/js/merge/union、视图组件与响应式信号）。
 *  example/sandbox 等宿主一行注入：`createInterpretAction(..., createBridgeGlobals())`，
 *  不再逐个显式 import 桥接对象。类型侧用 createBridgeGlobalsTypes()（Route A）。
 */
export function createBridgeGlobals() {
  return {
    storage,
    js,
    merge,
    union,
    fc,
    createContext,
    dom,
    html,
    text,
    createSignal,
    lateProxy: createLateProxy,
    memo,
    addEffect,
    forEach,
    multiBind,
    bindSignal,
    bindRef,
    createPop,
    renderPop,
    floating,
    hookTrackSignal,
    canvas,
    canvasDraw,
    flex2,
    grow2,
    align2,
    createScroll2,
    forEachNode2,
    ifNode2,
    textDefaults2,
    three,
    flex,
    grow,
    align,
    ignoreFlex,
    rgba,
    colorToCSS,
    layoutSize,
    layoutSizeDirection,
    readValue,
    dark,
    toggleTheme,
    iconCheck,
    iconChevronDown,
    iconX,
    provideIconContext,
  }
}

export type { Globals } from 'object-oriented-c-language'