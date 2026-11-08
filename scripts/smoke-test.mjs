/**
 * Headless smoke test for lib/client.js.
 *
 * No browser: a tiny DOM stub is enough because the vendored Grok Ball engine
 * touches exactly createElementNS / querySelector / requestAnimationFrame /
 * performance.now. The test drives the plugin's own apply() -> slot registration
 * -> React mount path, then asserts state mapping, dragging, composer clamping,
 * the menu button and the settings panel.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const code = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

const failures = []
function check(name, condition, detail) {
  if (condition) console.log('ok   ' + name)
  else {
    failures.push(name)
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''))
  }
}

// ---------------------------------------------------------------- DOM stub
function makeNode(tag) {
  const node = {
    tagName: tag,
    attrs: Object.create(null),
    children: [],
    style: {},
    textContent: '',
    value: '',
    type: '',
    checked: false,
    title: '',
    classList: { add() {}, remove() {}, contains() { return false } },
    setAttribute(k, v) { this.attrs[k] = v },
    getAttribute(k) { return this.attrs[k] },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
      return child
    },
    addEventListener(type, fn) {
      if (!this.__listeners) this.__listeners = new Map()
      if (!this.__listeners.has(type)) this.__listeners.set(type, [])
      this.__listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const list = this.__listeners && this.__listeners.get(type)
      if (!list) return
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    },
    fire(type, event) {
      const list = this.__listeners && this.__listeners.get(type)
      for (const fn of list ? [...list] : []) fn(event)
    },
    contains(other) {
      let n = other
      while (n) {
        if (n === this) return true
        n = n.parentNode
      }
      return false
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      const left = Number.parseFloat(this.style.left ?? '500')
      const top = Number.parseFloat(this.style.top ?? '600')
      return { left, top, width: 92, height: 92, right: left + 92, bottom: top + 92 }
    }
  }
  return node
}

const document = {
  hidden: false,
  createElementNS(_ns, tag) { return makeNode(tag) },
  createElement(tag) { return makeNode(tag) },
  querySelector() { return null },
  querySelectorAll() { return [] },
  body: makeNode('body'),
  documentElement: makeNode('html'),
  addEventListener() {},
  removeEventListener() {}
}

const windowListeners = new Map()
const window = {
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  document,
  performance: globalThis.performance,
  localStorage: (() => {
    const store = new Map()
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k)
    }
  })(),
  addEventListener(type, fn) {
    if (!windowListeners.has(type)) windowListeners.set(type, [])
    windowListeners.get(type).push(fn)
  },
  removeEventListener(type, fn) {
    const list = windowListeners.get(type)
    if (!list) return
    const i = list.indexOf(fn)
    if (i >= 0) list.splice(i, 1)
  }
}

// ---------------------------------------------------------------- React stub
const react = {
  createElement(type, props) { return { type, props: props ?? {} } },
  useRef(initial) { return { current: initial ?? null } },
  useEffect(fn) {
    const cleanup = fn()
    react.__cleanup = typeof cleanup === 'function' ? cleanup : null
  }
}

// ---------------------------------------------------------------- loader
let registration = null
window.__ModuleLoader__ = { load(reg) { registration = reg } }

const hostEvents = new Map()
function withHostEvents(node) {
  node.addEventListener = (type, fn) => {
    if (!hostEvents.has(node)) hostEvents.set(node, new Map())
    const map = hostEvents.get(node)
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(fn)
  }
  node.removeEventListener = () => {}
  return node
}

const fakeRequire = (spec) => {
  if (spec === 'react') return react
  throw new Error('unexpected require: ' + spec)
}

// run the bundle as a classic script
new Function('window', 'document', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', code)(
  window,
  document,
  globalThis.performance,
  () => 1, // never actually tick: the engine's rAF loop is irrelevant here
  () => {}
)

check('bundle registered itself', registration !== null)
check('bundle id', registration && registration.id === 'dsh-grok-ball', registration && registration.id)

const exportsObj = registration.factory(fakeRequire)
check('exports.apply is a function', typeof exportsObj.apply === 'function')
check('engine installed on window', window.GrokBall && typeof window.GrokBall.create === 'function')

// ---------------------------------------------------------------- state fixtures
const sid = 'session-1'
const statusMap = new Map([[sid, { running: false, pendingInteraction: undefined, completionUnread: false }]])
const statusListeners = new Set()
const currentListeners = new Set()
const statusSource = {
  getSnapshot: () => statusMap,
  subscribe: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn) }
}
const currentSource = {
  getSnapshot: () => ({ key: sid, props: { sessionId: sid } }),
  subscribe: (fn) => { currentListeners.add(fn); return () => currentListeners.delete(fn) }
}
const uiSession = { sessionStatus: statusSource, adapter: { current: currentSource } }

const emotions = []
const engine = {
  emotionId: '02',
  setEmotion(id) { this.emotionId = id; emotions.push(id); return true },
  setGaze() {},
  clearGaze() {},
  spin() {},
  bounce() {},
  burst() {},
  destroy() { emotions.push('destroy') }
}
window.GrokBall = {
  create: () => engine,
  EMOTIONS: [
    { id: '00', name: '睡眠', group: 'life' },
    { id: '02', name: '待机放空', group: 'life' },
    { id: '10', name: '开心', group: 'emotion' },
    { id: '30', name: '思考中', group: 'agent' },
    { id: '35', name: '等待输入', group: 'agent' }
  ],
  GROUPS: [
    { key: 'life', name: '生命周期' },
    { key: 'emotion', name: '情绪反应' },
    { key: 'agent', name: '代理状态' }
  ]
}

let slotRegister = null
const slots = {
  inject: (name, fn) => { check('slot name is shell.overlay', name === 'shell.overlay', name); return fn() },
  register: (options, component) => { slotRegister = { options, component }; return () => {} }
}
let effectRan = false
const ctx = {
  slots,
  uiSession,
  inject: (deps, cb) => { cb({ slots, uiSession, effect: (fn) => { effectRan = true; return fn() } }) }
}

exportsObj.apply(ctx)
check('effect ran', effectRan)
check('slot registered', slotRegister !== null)
check('slot id', slotRegister && slotRegister.options.id === 'dsh-grok-ball')

// Render the registered component exactly like the slot would.
const element = slotRegister.component()
check('component returns an element', element && element.type && typeof element.type === 'function')

// The component is a function component; drive its hooks by hand.
const hostNode = withHostEvents(makeNode('div'))
react.useRef = () => ({ current: hostNode })
react.useEffect = (fn) => { react.__cleanup = fn() }

const rendered = element.type(element.props)
check('component renders a div', rendered && rendered.type === 'div')
check('host positioned fixed', hostNode.style.position === 'fixed', hostNode.style.position)
check('default size applied', hostNode.style.width === '92px', hostNode.style.width)
check('ball box clips overflow', hostNode.children[0].style.overflow === 'hidden', hostNode.children[0].style.overflow)
check('clip box is larger than the ball', hostNode.children[0].style.width !== '92px', hostNode.children[0].style.width)

// idle state
check('idle maps to 02', engine.emotionId === '02', engine.emotionId)

// running
statusMap.set(sid, { running: true, pendingInteraction: undefined, completionUnread: false })
for (const fn of statusListeners) fn()
check('running maps to 31 or 30', engine.emotionId === '31' || engine.emotionId === '30', engine.emotionId)

// pending interaction
statusMap.set(sid, { running: false, pendingInteraction: { kind: 'ask' }, completionUnread: false })
for (const fn of statusListeners) fn()
check('pending interaction maps to 35', engine.emotionId === '35', engine.emotionId)

// finished (running true -> false) celebrates
statusMap.set(sid, { running: true })
for (const fn of statusListeners) fn()
statusMap.set(sid, { running: false })
for (const fn of statusListeners) fn()
check('finish maps to 33', engine.emotionId === '33', engine.emotionId)

// click feedback + menu button
const hostListeners = hostEvents.get(hostNode)
check('host has pointerdown/up listeners', hostListeners && hostListeners.has('pointerdown') && hostListeners.has('pointerup'))
const down = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 540, clientY: 640, preventDefault() {} }
const up = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 540, clientY: 640 }
for (const fn of hostListeners.get('pointerdown')) fn(down)
for (const fn of hostListeners.get('pointerup')) fn(up)
check('click maps to 10', engine.emotionId === '10', engine.emotionId)
const menuButton = hostNode.children.find((c) => c.tagName === 'button')
check('menu button appears after click', !!menuButton && menuButton.style.display === 'flex', menuButton && menuButton.style.display)

// drag persists position
const down2 = { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 540, clientY: 640, preventDefault() {} }
const move2 = { pointerId: 2, clientX: 440, clientY: 540 }
const up2 = { pointerId: 2, clientX: 440, clientY: 540 }
for (const fn of hostListeners.get('pointerdown')) fn(down2)
for (const fn of hostListeners.get('pointermove')) fn(move2)
for (const fn of hostListeners.get('pointerup')) fn(up2)
const saved = JSON.parse(window.localStorage.getItem('dsh-grok-ball:pos') || 'null')
check('drag persisted position', saved && saved.x === 1224 && saved.y === 540, JSON.stringify(saved))

// menu button opens the panel
menuButton.fire('click', { stopPropagation() {} })
const panel = document.body.children.find((c) => c.tagName === 'div' && c.style.display === 'block')
check('panel opens into document.body', !!panel)
check('panel has close button', !!panel && panel.children.some((c) => c.tagName === 'div'))

const findDeep = (node, pred) => {
  for (const child of node.children ?? []) {
    if (pred(child)) return child
    const hit = findDeep(child, pred)
    if (hit) return hit
  }
  return null
}
const slider = findDeep(panel, (n) => n.tagName === 'input' && n.type === 'range')
check('size slider exists', !!slider && slider.value === '92', slider && slider.value)
if (slider) {
  slider.value = '128'
  slider.fire('input', { target: slider })
  check('size change resizes host', hostNode.style.width === '128px', hostNode.style.width)
  check('size persisted', window.localStorage.getItem('dsh-grok-ball:size') === '128')
}

const chip30 = findDeep(panel, (n) => n.tagName === 'button' && n.textContent === '30 思考中')
check('emotion chip exists', !!chip30)
if (chip30) {
  await new Promise((resolve) => setTimeout(resolve, 900)) // let the click flash expire
  chip30.fire('click', {})
  check('chip pins emotion', engine.emotionId === '30', engine.emotionId)
  check('pinned persisted', window.localStorage.getItem('dsh-grok-ball:emotion') === '30')
}

const followChip = findDeep(panel, (n) => n.tagName === 'button' && n.textContent === '跟随 DSH 状态')
check('follow-state chip exists', !!followChip)
if (followChip) {
  followChip.fire('click', {})
  check('follow clears pinned', window.localStorage.getItem('dsh-grok-ball:emotion') === null)
}

const hideBox = findDeep(panel, (n) => n.tagName === 'input' && n.type === 'checkbox')
check('hide-menu toggle exists', !!hideBox)
if (hideBox) {
  hideBox.checked = true
  hideBox.fire('change', {})
  check('hide-menu persisted', window.localStorage.getItem('dsh-grok-ball:hide-menu') === '1')
}

// right click opens the panel directly
for (const fn of hostListeners.get('contextmenu') ?? []) fn({ preventDefault() {} })
check('right click opens panel', panel.style.display === 'block')

// the drag range's lower bound is the window bottom (size is 128 now)
const maxY = 900 - 128 - 8
const maxX = 1440 - 128 - 8

const dragTo = (targetX, targetY) => {
  const left = Number.parseFloat(hostNode.style.left)
  const top = Number.parseFloat(hostNode.style.top)
  const start = { pointerId: 9, pointerType: 'mouse', button: 0, clientX: left + 46, clientY: top + 46, preventDefault() {} }
  const move = { pointerId: 9, clientX: start.clientX + (targetX - left), clientY: start.clientY + (targetY - top) }
  for (const fn of hostListeners.get('pointerdown')) fn(start)
  for (const fn of hostListeners.get('pointermove')) fn(move)
  for (const fn of hostListeners.get('pointerup')) fn(move)
  return { left: Number.parseFloat(hostNode.style.left), top: Number.parseFloat(hostNode.style.top) }
}

const atBottom = dragTo(500, 5000)
check('drag reaches the window bottom', atBottom.top === maxY, String(atBottom.top))
check('bottom edge snaps', atBottom.top === maxY, String(atBottom.top))

const atLeft = dragTo(2, 300)
check('left edge snaps', atLeft.left === 8, String(atLeft.left))

const atRight = dragTo(5000, 300)
check('right edge snaps', atRight.left === maxX, String(atRight.left))

const atTop = dragTo(700, 2)
check('top edge snaps', atTop.top === 8, String(atTop.top))

// middle of the screen must NOT snap
const middle = dragTo(600, 400)
check('middle drag stays free', middle.left === 600 && middle.top === 400, JSON.stringify(middle))

// snap settings live in the panel
const snapTop = findDeep(panel, (n) => n.tagName === 'input' && n.attrs['data-side'] === 'top')
check('snap sliders exist', !!snapTop && snapTop.value === '24', snapTop && snapTop.value)
if (snapTop) {
  snapTop.value = '60'
  snapTop.fire('input', {})
  const cfg = JSON.parse(window.localStorage.getItem('dsh-grok-ball:snap') || '{}')
  check('snap range persisted', cfg.top === 60, JSON.stringify(cfg))
  const nearTop = dragTo(700, 40)
  check('custom top range snaps', nearTop.top === 8, String(nearTop.top))
}

const ratioButton = findDeep(panel, (n) => n.tagName === 'button' && n.textContent === '比例吸附')
check('ratio mode button exists', !!ratioButton)
if (ratioButton) {
  ratioButton.fire('click', {})
  const cfg = JSON.parse(window.localStorage.getItem('dsh-grok-ball:snap') || '{}')
  check('ratio mode persisted', cfg.mode === 'ratio', JSON.stringify(cfg))
  check('px values converted to percent', cfg.top > 0 && cfg.top <= 30, String(cfg.top))
  const ratioTop = dragTo(700, 40)
  check('ratio range snaps too', ratioTop.top === 8, String(ratioTop.top))
}

const leftInput = findDeep(panel, (n) => n.tagName === 'input' && n.attrs['data-side'] === 'left')
if (leftInput) {
  leftInput.value = '0'
  leftInput.fire('input', {})
  const at20 = dragTo(20, 400)
  check('left range 0 disables left snap', at20.left === 20, String(at20.left))
}

// cleanup
if (react.__cleanup) react.__cleanup()
check('cleanup destroys the engine', emotions.includes('destroy'))
check('cleanup removes the panel', !document.body.children.includes(panel))

console.log(failures.length ? '\nFAILURES: ' + failures.join(', ') : '\nALL OK')
process.exit(failures.length ? 1 : 0)
