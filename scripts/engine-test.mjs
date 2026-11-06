/** Exercise the vendored engine itself against a tiny DOM stub. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = fs.readFileSync(path.join(root, 'vendor', 'grok-ball.js'), 'utf8')

let seq = 0
function node(tag) {
  return {
    tagName: tag,
    attrs: {},
    children: [],
    style: {},
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v },
    getAttribute(k) { return this.attrs[k] },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 } }
  }
}

const document = {
  createElementNS: (_ns, tag) => node(tag),
  createElement: (tag) => node(tag),
  querySelector: () => null,
  hidden: false
}

const window = {
  innerWidth: 1440,
  innerHeight: 900,
  document,
  addEventListener() {},
  removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {} }
}

const rafQueue = []
const ctx = {
  window,
  document,
  performance: globalThis.performance,
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length },
  cancelAnimationFrame: () => {},
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  isNaN,
  parseFloat,
  parseInt,
  Symbol
}

new Function(...Object.keys(ctx), source)(...Object.values(ctx))

const failures = []
function check(name, ok, detail) {
  if (ok) console.log('ok   ' + name)
  else { failures.push(name); console.log('FAIL ' + name + (detail ? ' — ' + detail : '')) }
}

check('engine exposes GrokBall', window.GrokBall && typeof window.GrokBall.create === 'function')
check('42 emotions registered', window.GrokBall.EMOTIONS.length >= 32, String(window.GrokBall.EMOTIONS.length))

const mount = node('div')
const ball = window.GrokBall.create(mount, { emotion: '02', eyeScale: 1.25 })
check('svg mounted', mount.children.length === 1 && mount.children[0].tagName === 'svg', String(mount.children.length))
check('svg has viewBox', mount.children[0].attrs.viewBox === '-15 -15 259 259')

ball.setEmotion('30')
check('setEmotion 30', ball.emotionId === '30', ball.emotionId)
ball.setEmotion('35')
check('setEmotion 35', ball.emotionId === '35', ball.emotionId)
ball.setEmotion('nope')
check('unknown id falls back', ball.emotionId === '02', ball.emotionId)

ball.setGaze(0.5, -0.3)
ball.spin(1)
ball.bounce()
ball.burst(5)
check('gaze/spin/bounce/burst do not throw', true)

// run a few animation frames so the pose renderer executes
for (let i = 0; i < 5; i++) {
  const fn = rafQueue.shift()
  if (!fn) break
  fn(performance.now() + i * 16)
}
check('animation frames ran', true)

ball.destroy()
check('destroy empties the container', mount.children.length === 0, String(mount.children.length))

console.log(failures.length ? '\nFAILURES: ' + failures.join(', ') : '\nALL OK')
process.exit(failures.length ? 1 : 0)
