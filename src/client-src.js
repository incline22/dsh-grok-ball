/**
 * dsh-grok-ball — browser half.
 *
 * Hand-written in the exact `window.__ModuleLoader__.load({ id, factory })`
 * shape @deepseek-ai/dsh-client-modules expects from a package's
 * `exports["./client"]` bundle (the same shape tsdown emits for dsh-boot-animation),
 * so this plugin needs no build toolchain — only scripts/build.mjs, which pastes
 * the vendored Grok Ball engine into the placeholder below.
 *
 * Mounting rules learned from dsh-boot-animation (see its ARCHITECTURE.md):
 *   - register into `shell.overlay`, a list slot: an added cell, never a replacement;
 *   - resolve `slots` + `uiSession` through cordis DYNAMIC injection, never a static
 *     `inject` export — a pending fiber is fatal to the whole web boot;
 *   - the overlay only listens on the ball itself (`pointer-events: none` elsewhere),
 *     so the chat stays clickable.
 *
 * State mapping (uiSession.sessionStatus -> emotionId):
 *   pendingInteraction    -> 35 等待输入
 *   running (first 650ms) -> 31 接收任务
 *   running               -> 30 思考中
 *   just finished         -> 33 任务完成 (2.6s) + confetti
 *   otherwise             -> 02 待机放空
 *   click                 -> 10 开心 (800ms) + spin + bounce
 */
window.__ModuleLoader__.load({
  id: 'dsh-grok-ball',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')
    var LOG = '[dsh-grok-ball] '

    // A broken vendored copy must degrade to "no widget", never to a failed boot.
    try {
/*__GROK_BALL_ENGINE__*/
    } catch (bootError) {
      try { console.error(LOG + 'engine failed to initialize', bootError) } catch (err) { /* ignore */ }
    }

    // =====================================================================
    // widget
    // =====================================================================

    var POS_KEY = 'dsh-grok-ball:pos'
    var SIZE = 92
    var EDGE = 8
    var CLICK_MS = 800
    var START_MS = 650
    var DONE_MS = 2600

    function warn(message) {
      try { console.warn(LOG + message) } catch (err) { /* console may be gone */ }
    }

    function readPos() {
      try {
        var raw = window.localStorage.getItem(POS_KEY)
        if (!raw) return null
        var parsed = JSON.parse(raw)
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed
      } catch (err) { /* storage blocked: fall back to the default corner */ }
      return null
    }

    function writePos(pos) {
      try { window.localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.x, y: pos.y })) } catch (err) { /* ignore */ }
    }

    /** Visible viewport height, preferring the visual viewport when the host has one. */
    function viewHeight() {
      var vv = window.visualViewport
      if (vv && typeof vv.height === 'number' && vv.height > 0) return Math.min(window.innerHeight, vv.height + (vv.offsetTop || 0))
      return window.innerHeight
    }

    /**
     * Top edge of the chat composer, so the ball stops above it instead of
     * vanishing behind the input box. Detection is structural and best-effort:
     * any contenteditable/textarea sitting in the lower half of the window.
     */
    function composerTop() {
      try {
        if (typeof document.querySelectorAll !== 'function') return 0
        var best = 0
        var nodes = document.querySelectorAll('[contenteditable="true"], textarea')
        for (var i = 0; i < nodes.length; i++) {
          var rect = nodes[i].getBoundingClientRect()
          if (rect.height < 12) continue
          if (rect.bottom < window.innerHeight * 0.5) continue
          if (rect.top > best) best = rect.top
        }
        return best
      } catch (err) {
        return 0
      }
    }

    function clampPos(pos) {
      var maxX = Math.max(EDGE, window.innerWidth - SIZE - EDGE)
      var bottom = viewHeight() - EDGE
      var composer = composerTop()
      if (composer > 0 && composer < bottom - 24) bottom = Math.min(bottom, composer - EDGE)
      var maxY = Math.max(EDGE, bottom - SIZE)
      return {
        x: Math.min(Math.max(EDGE, pos.x), maxX),
        y: Math.min(Math.max(EDGE, pos.y), maxY)
      }
    }

    /** Bottom-right, lifted above the balance-whale widget's corner. */
    function defaultPos() {
      return clampPos({ x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 168 })
    }

    /**
     * Build the ball inside `host` (a React-rendered, fixed-position div) and
     * return the disposer. Never throws: a cosmetic widget must not be able to
     * take the GUI down.
     */
    function createGrokBallWidget(host, uiSession) {
      var now = Date.now()
      var pos = clampPos(readPos() || defaultPos())
      var ball = null
      var disposed = false
      var wakeTimer = 0
      var dragging = null

      // --- session status -------------------------------------------------
      var statusSource = uiSession && uiSession.sessionStatus
      var currentSource = uiSession && uiSession.adapter && uiSession.adapter.current
      var statusSnapshot = null
      var sid = null
      var prevRunning = false
      var startUntil = 0
      var doneUntil = 0
      var clickUntil = 0

      function currentSid() {
        if (!currentSource || typeof currentSource.getSnapshot !== 'function') return null
        var binding = null
        try { binding = currentSource.getSnapshot() } catch (err) { return null }
        if (!binding) return null
        if (typeof binding.key === 'string' && binding.key) return binding.key
        try {
          var face = binding.hooks && binding.hooks.session
          var snap = face && typeof face.getSnapshot === 'function' ? face.getSnapshot() : null
          if (snap && typeof snap.sessionId === 'string' && snap.sessionId) return snap.sessionId
        } catch (err) { /* nested face may throw: fall through */ }
        if (binding.props && typeof binding.props.sessionId === 'string') return binding.props.sessionId
        return null
      }

      function readStatus(id) {
        if (!id || !statusSource || typeof statusSource.getSnapshot !== 'function') return null
        var map = null
        try { map = statusSource.getSnapshot() } catch (err) { return null }
        if (!map || typeof map.get !== 'function') return null
        var row = map.get(id)
        return row || null
      }

      function scheduleWake(at) {
        var delay = Math.max(40, at - Date.now() + 30)
        if (wakeTimer) clearTimeout(wakeTimer)
        wakeTimer = setTimeout(function () {
          wakeTimer = 0
          render()
        }, delay)
      }

      function render() {
        if (disposed || ball === null) return
        var ts = Date.now()
        var id = currentSid()
        if (id !== sid) {
          sid = id
          prevRunning = false
          startUntil = 0
          doneUntil = 0
        }
        var row = readStatus(id)
        statusSnapshot = row
        var running = !!(row && row.running)
        if (running && !prevRunning) startUntil = ts + START_MS
        if (!running && prevRunning) {
          startUntil = 0
          doneUntil = ts + DONE_MS
          if (!document.hidden) {
            try { ball.burst(14) } catch (err) { /* particles are best-effort */ }
          }
        }
        prevRunning = running

        var emotion = '02'
        if (ts < clickUntil) emotion = '10'
        else if (row && row.pendingInteraction) emotion = '35'
        else if (running) emotion = ts < startUntil ? '31' : '30'
        else if (ts < doneUntil) emotion = '33'

        if (ball.emotionId !== emotion) {
          try { ball.setEmotion(emotion) } catch (err) { warn('setEmotion failed: ' + err) }
        }

        // Arm the next timer only when a transient window is still open.
        var next = 0
        if (ts < clickUntil) next = clickUntil
        if (ts < startUntil) next = next === 0 ? startUntil : Math.min(next, startUntil)
        if (ts < doneUntil) next = next === 0 ? doneUntil : Math.min(next, doneUntil)
        if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0 }
        if (next !== 0) scheduleWake(next)
      }

      // --- gaze -----------------------------------------------------------
      function onPointerMove(event) {
        if (disposed || ball === null) return
        if (dragging !== null) return
        var rect = host.getBoundingClientRect()
        var halfW = Math.max(rect.width, 80) / 2
        var halfH = Math.max(rect.height, 80) / 2
        var nx = (event.clientX - (rect.left + rect.width / 2)) / halfW
        var ny = (event.clientY - (rect.top + rect.height / 2)) / halfH
        try { ball.setGaze(nx, ny) } catch (err) { /* ignore */ }
      }

      function onBlur() {
        if (ball !== null) try { ball.clearGaze() } catch (err) { /* ignore */ }
      }

      function onClick() {
        if (disposed || ball === null) return
        clickUntil = Date.now() + CLICK_MS
        try {
          ball.spin(1)
          ball.bounce()
        } catch (err) { warn('click feedback failed: ' + err) }
        render()
      }

      // --- drag -----------------------------------------------------------
      function applyPos() {
        host.style.left = pos.x + 'px'
        host.style.top = pos.y + 'px'
      }

      function onPointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        dragging = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: pos.x,
          originY: pos.y,
          moved: false
        }
        try { host.setPointerCapture(event.pointerId) } catch (err) { /* ignore */ }
        host.style.cursor = 'grabbing'
        event.preventDefault()
      }

      function onDragMove(event) {
        if (dragging === null || event.pointerId !== dragging.id) return
        var dx = event.clientX - dragging.startX
        var dy = event.clientY - dragging.startY
        if (!dragging.moved && Math.abs(dx) + Math.abs(dy) > 5) dragging.moved = true
        if (!dragging.moved) return
        pos = clampPos({ x: dragging.originX + dx, y: dragging.originY + dy })
        applyPos()
      }

      function onPointerUp(event) {
        if (dragging === null || event.pointerId !== dragging.id) return
        var moved = dragging.moved
        dragging = null
        host.style.cursor = 'grab'
        try { host.releasePointerCapture(event.pointerId) } catch (err) { /* ignore */ }
        if (moved) {
          checkPlacement()
          writePos(pos)
        } else {
          onClick()
        }
      }

      function onPointerCancel() {
        if (dragging === null) return
        dragging = null
        host.style.cursor = 'grab'
      }

      function onResize() {
        var next = clampPos(pos)
        if (next.x !== pos.x || next.y !== pos.y) {
          pos = next
          applyPos()
        }
        ensureInView()
      }

      /**
       * Measure where the ball actually landed and push it back inside the
       * visible area. Clamping from window.innerHeight alone assumes the fixed
       * containing block IS the viewport; measuring the rendered rect is
       * correct no matter what the overlay slot's ancestors do.
       */
      function ensureInView() {
        if (disposed) return
        var rect = host.getBoundingClientRect()
        var vw = window.innerWidth
        var vh = viewHeight()
        var dx = 0
        var dy = 0
        if (rect.right > vw - EDGE) dx -= rect.right - (vw - EDGE)
        if (rect.left < EDGE) dx += EDGE - rect.left
        if (rect.bottom > vh - EDGE) dy -= rect.bottom - (vh - EDGE)
        if (rect.top < EDGE) dy += EDGE - rect.top
        if (dx === 0 && dy === 0) return
        pos = clampPos({ x: pos.x + dx, y: pos.y + dy })
        applyPos()
        writePos(pos)
      }

      /** Keep the ball clear of the composer even when the composer grows (multiline input). */
      function checkPlacement() {
        if (disposed || dragging !== null) return
        var next = clampPos(pos)
        if (next.x !== pos.x || next.y !== pos.y) {
          pos = next
          applyPos()
        }
        ensureInView()
      }

      // --- mount ----------------------------------------------------------
      host.style.position = 'fixed'
      host.style.pointerEvents = 'auto'
      host.style.width = SIZE + 'px'
      host.style.height = SIZE + 'px'
      host.style.zIndex = '60'
      host.style.touchAction = 'none'
      host.style.userSelect = 'none'
      host.style.cursor = 'grab'
      host.style.filter = 'drop-shadow(0 10px 18px rgba(0, 0, 0, 0.18))'
      host.style.transition = 'transform 160ms ease'
      host.style.willChange = 'left, top'
      host.setAttribute('role', 'img')
      host.setAttribute('aria-label', 'Grok Ball 表情球')
      applyPos()

      var child = document.createElement('div')
      child.style.width = '100%'
      child.style.height = '100%'
      host.appendChild(child)

      try {
        ball = window.GrokBall.create(child, { emotion: '02', eyeScale: 1.25, label: 'Grok Ball' })
      } catch (err) {
        warn('create failed: ' + err)
        return function () {}
      }

      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('blur', onBlur)
      window.addEventListener('resize', onResize)
      if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
        window.visualViewport.addEventListener('resize', onResize)
      }
      host.addEventListener('pointerdown', onPointerDown)
      host.addEventListener('pointermove', onDragMove)
      host.addEventListener('pointerup', onPointerUp)
      host.addEventListener('pointercancel', onPointerCancel)
      host.addEventListener('pointerenter', function () { host.style.transform = 'scale(1.05)' })
      host.addEventListener('pointerleave', function () { host.style.transform = '' })
      host.addEventListener('contextmenu', function (event) { event.preventDefault() })

      checkPlacement()
      var placementTimer = setInterval(checkPlacement, 2000)

      var unsubStatus = null
      var unsubCurrent = null
      try {
        if (statusSource && typeof statusSource.subscribe === 'function') {
          unsubStatus = statusSource.subscribe(render)
        }
        if (currentSource && typeof currentSource.subscribe === 'function') {
          unsubCurrent = currentSource.subscribe(render)
        }
      } catch (err) {
        warn('subscribe failed: ' + err)
      }

      render()

      return function dispose() {
        if (disposed) return
        disposed = true
        if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0 }
        if (placementTimer) { clearInterval(placementTimer); placementTimer = 0 }
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('resize', onResize)
        if (window.visualViewport && typeof window.visualViewport.removeEventListener === 'function') {
          window.visualViewport.removeEventListener('resize', onResize)
        }
        host.removeEventListener('pointerdown', onPointerDown)
        host.removeEventListener('pointermove', onDragMove)
        host.removeEventListener('pointerup', onPointerUp)
        host.removeEventListener('pointercancel', onPointerCancel)
        try { if (typeof unsubStatus === 'function') unsubStatus() } catch (err) { /* ignore */ }
        try { if (typeof unsubCurrent === 'function') unsubCurrent() } catch (err) { /* ignore */ }
        try { if (ball !== null) ball.destroy() } catch (err) { /* ignore */ }
        ball = null
      }
    }

    function GrokBallMount(props) {
      var hostRef = react.useRef(null)
      var uiSession = props ? props.uiSession : null
      react.useEffect(function () {
        var host = hostRef.current
        if (!host) return undefined
        if (!window.GrokBall || typeof window.GrokBall.create !== 'function') {
          warn('engine missing; widget not mounted')
          return undefined
        }
        return createGrokBallWidget(host, uiSession)
      }, [uiSession])
      return react.createElement('div', { ref: hostRef })
    }

    // =====================================================================
    // plugin entry
    // =====================================================================

    function apply(ctx) {
      var wire = function (ready) {
        var register = function () {
          try {
            ready.slots.inject('shell.overlay', function () {
              return ready.slots.register(
                { name: 'shell.overlay', id: 'dsh-grok-ball', order: 950 },
                function () { return react.createElement(GrokBallMount, { uiSession: ready.uiSession }) }
              )
            })
          } catch (err) {
            warn('slot registration failed: ' + err)
          }
        }
        if (typeof ready.effect === 'function') ready.effect(register, 'dsh-grok-ball: mounts')
        else register()
      }

      // Dynamic injection: the wait happens in a child fiber, so this entry still
      // reaches ACTIVE on hosts that never provide the services.
      if (typeof ctx.inject === 'function') {
        ctx.inject(['slots', 'uiSession'], wire)
        return
      }
      if (ctx.slots !== undefined && ctx.uiSession !== undefined) {
        wire(ctx)
      } else {
        warn('idle: host offers no dynamic injection and no uiSession')
      }
    }

    exports.apply = apply
    return module.exports
  }
})
