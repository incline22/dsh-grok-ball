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
 *   idle > 10 minutes     -> 00 睡眠
 *   otherwise             -> 02 待机放空
 *   click                 -> 10 开心 (800ms) + spin + bounce
 *   manual pick (panel)   -> any emotion, overrides the mapping until reset
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
    var SIZE_KEY = 'dsh-grok-ball:size'
    var HIDE_KEY = 'dsh-grok-ball:hide-menu'
    var EMOTION_KEY = 'dsh-grok-ball:emotion'
    var SNAP_KEY = 'dsh-grok-ball:snap'
    var EDGE = 8
    var SNAP = 24
    var SIZE_MIN = 64
    var SIZE_MAX = 160
    var SIZE_DEFAULT = 92
    var CLICK_MS = 800
    var START_MS = 650
    var DONE_MS = 2600
    var MENU_MS = 3200
    var SLEEP_MS = 10 * 60 * 1000

    function warn(message) {
      try { console.warn(LOG + message) } catch (err) { /* console may be gone */ }
    }

    function readRaw(key) {
      try { return window.localStorage.getItem(key) } catch (err) { return null }
    }

    function writeRaw(key, value) {
      try { window.localStorage.setItem(key, value) } catch (err) { /* ignore */ }
    }

    function readNumber(key, fallback, min, max) {
      var value = Number.parseFloat(readRaw(key))
      if (!Number.isFinite(value)) return fallback
      return Math.min(Math.max(min, value), max)
    }

    function readBool(key, fallback) {
      var raw = readRaw(key)
      if (raw === null) return fallback
      return raw === '1'
    }

    var SNAP_SIDES = ['top', 'right', 'bottom', 'left']
    var SNAP_PX_MAX = 160
    var SNAP_RATIO_MAX = 30

    function clampSnapValue(value, mode) {
      var max = mode === 'ratio' ? SNAP_RATIO_MAX : SNAP_PX_MAX
      return Math.round(Math.min(Math.max(0, value), max))
    }

    function readSnapCfg() {
      var fallback = { mode: 'px', top: 24, right: 24, bottom: 24, left: 24 }
      var raw = readRaw(SNAP_KEY)
      if (!raw) return fallback
      try {
        var parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return fallback
        var mode = parsed.mode === 'ratio' ? 'ratio' : 'px'
        var out = { mode: mode }
        for (var i = 0; i < SNAP_SIDES.length; i++) {
          var side = SNAP_SIDES[i]
          var value = Number(parsed[side])
          out[side] = Number.isFinite(value) ? clampSnapValue(value, mode) : 24
        }
        return out
      } catch (err) {
        return fallback
      }
    }

    function readPos() {
      try {
        var raw = readRaw(POS_KEY)
        if (!raw) return null
        var parsed = JSON.parse(raw)
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed
      } catch (err) { /* storage blocked: fall back to the default corner */ }
      return null
    }

    function writePos(pos) {
      writeRaw(POS_KEY, JSON.stringify({ x: pos.x, y: pos.y }))
    }

    /** Visible viewport height, preferring the visual viewport when the host has one. */
    function viewHeight() {
      var vv = window.visualViewport
      if (vv && typeof vv.height === 'number' && vv.height > 0) return Math.min(window.innerHeight, vv.height + (vv.offsetTop || 0))
      return window.innerHeight
    }

    /** Keep the ball inside the window; the drag range's lower bound is the window bottom. */
    function clampPos(pos, size) {
      var maxX = Math.max(EDGE, window.innerWidth - size - EDGE)
      var maxY = Math.max(EDGE, viewHeight() - size - EDGE)
      return {
        x: Math.min(Math.max(EDGE, pos.x), maxX),
        y: Math.min(Math.max(EDGE, pos.y), maxY)
      }
    }

    /** Snap to a window edge when a drag ends within that side's own range. */
    function snapPos(pos, size, cfg) {
      var next = { x: pos.x, y: pos.y }
      var vw = window.innerWidth
      var vh = viewHeight()
      function limit(side) {
        var value = cfg[side]
        if (!(value > 0)) return 0
        if (cfg.mode === 'ratio') {
          var dim = side === 'left' || side === 'right' ? vw : vh
          return (value / 100) * dim
        }
        return value
      }
      var leftLimit = limit('left')
      var rightLimit = limit('right')
      var topLimit = limit('top')
      var bottomLimit = limit('bottom')
      if (leftLimit > 0 && pos.x <= leftLimit) next.x = EDGE
      else if (rightLimit > 0 && vw - (pos.x + size) <= rightLimit) next.x = vw - size - EDGE
      if (topLimit > 0 && pos.y <= topLimit) next.y = EDGE
      else if (bottomLimit > 0 && vh - (pos.y + size) <= bottomLimit) next.y = vh - size - EDGE
      return clampPos(next, size)
    }

    function defaultPos(size) {
      return clampPos({ x: window.innerWidth - size - 24, y: window.innerHeight - size - 168 }, size)
    }

    /** Small DOM helper: create an element with inline CSS and optional text. */
    function el(tag, css, text) {
      var node = document.createElement(tag)
      if (css) node.style.cssText = css
      if (text !== undefined) node.textContent = text
      return node
    }

    function emotionCatalog() {
      var engine = window.GrokBall
      var emotions = engine && Array.isArray(engine.EMOTIONS) ? engine.EMOTIONS : []
      var groups = engine && Array.isArray(engine.GROUPS) ? engine.GROUPS : []
      return { emotions: emotions, groups: groups }
    }

    function findEmotion(id) {
      var catalog = emotionCatalog()
      for (var i = 0; i < catalog.emotions.length; i++) {
        if (catalog.emotions[i].id === id) return catalog.emotions[i]
      }
      return null
    }

    /**
     * Build the ball inside `host` (a React-rendered, fixed-position div) and
     * return the disposer. Never throws: a cosmetic widget must not be able to
     * take the GUI down.
     */
    function createGrokBallWidget(host, uiSession) {
      var size = readNumber(SIZE_KEY, SIZE_DEFAULT, SIZE_MIN, SIZE_MAX)
      var hideMenu = readBool(HIDE_KEY, false)
      var snapCfg = readSnapCfg()
      var pinned = readRaw(EMOTION_KEY)
      if (pinned !== null && pinned !== '' && !findEmotion(pinned)) pinned = null
      if (pinned === '') pinned = null

      var pos = clampPos(readPos() || defaultPos(size), size)
      var ball = null
      var disposed = false
      var wakeTimer = 0
      var menuTimer = 0
      var menuHideTimer = 0
      var placementTimer = 0
      var dragging = null
      var idleSince = Date.now()

      // --- session status -------------------------------------------------
      var statusSource = uiSession && uiSession.sessionStatus
      var currentSource = uiSession && uiSession.adapter && uiSession.adapter.current
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
        return map.get(id) || null
      }

      // --- look & feel ----------------------------------------------------
      var menuButton = null
      var panel = null
      var panelOpen = false
      var chips = Object.create(null)
      var sizeSlider = null
      var sizeValue = null
      var hideInput = null
      var followChip = null
      var snapModeButtons = null
      var snapRows = null

      function applyPos() {
        host.style.left = pos.x + 'px'
        host.style.top = pos.y + 'px'
      }

      function applySize(next, persist) {
        var value = Math.round(Math.min(Math.max(SIZE_MIN, next), SIZE_MAX) / 4) * 4
        size = value
        host.style.width = value + 'px'
        host.style.height = value + 'px'
        layoutBall()
        pos = clampPos(pos, size)
        applyPos()
        if (persist !== false) writeRaw(SIZE_KEY, String(value))
        placePanel()
      }

      function savePinned(id) {
        pinned = id
        if (id === null) {
          try { window.localStorage.removeItem(EMOTION_KEY) } catch (err) { /* ignore */ }
        } else {
          writeRaw(EMOTION_KEY, id)
        }
        render()
        updateChips()
      }

      function writeSnap() {
        writeRaw(SNAP_KEY, JSON.stringify(snapCfg))
      }

      /** Switch between absolute pixels and a percentage of the window's width/height. */
      function setSnapMode(mode) {
        if ((mode !== 'ratio' && mode !== 'px') || mode === snapCfg.mode) return
        var vw = window.innerWidth
        var vh = viewHeight()
        SNAP_SIDES.forEach(function (side) {
          var dim = side === 'left' || side === 'right' ? vw : vh
          var value = mode === 'ratio' ? (snapCfg[side] / dim) * 100 : (snapCfg[side] / 100) * dim
          snapCfg[side] = clampSnapValue(value, mode)
        })
        snapCfg.mode = mode
        writeSnap()
        refreshSnapUI()
      }

      function refreshSnapUI() {
        if (!snapModeButtons || !snapRows) return
        var ratio = snapCfg.mode === 'ratio'
        Object.keys(snapModeButtons).forEach(function (key) {
          var on = (key === 'ratio') === ratio
          var button = snapModeButtons[key]
          button.style.background = on ? 'rgba(255,158,198,.2)' : 'rgba(255,255,255,.045)'
          button.style.borderColor = on ? 'rgba(255,158,198,.65)' : 'rgba(255,255,255,.12)'
        })
        SNAP_SIDES.forEach(function (side) {
          var row = snapRows[side]
          if (!row) return
          row.input.min = '0'
          row.input.max = String(ratio ? SNAP_RATIO_MAX : SNAP_PX_MAX)
          row.input.value = String(snapCfg[side])
          row.value.textContent = snapCfg[side] + (ratio ? '%' : 'px')
        })
      }

      // --- panel ----------------------------------------------------------
      function panelCss() {
        return [
          'position: fixed',
          'z-index: 2147483647',
          'width: 300px',
          'max-height: 72vh',
          'overflow: auto',
          'box-sizing: border-box',
          'padding: 14px 14px 12px',
          'border-radius: 16px',
          'background: #17181d',
          'color: #e8e8ee',
          'border: 1px solid rgba(255,255,255,.1)',
          'box-shadow: 0 18px 48px rgba(0,0,0,.45)',
          'font: 13px/1.5 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
          'user-select: none'
        ].join(';')
      }

      function ensurePanel() {
        if (panel !== null) return panel

        panel = el('div', panelCss())

        var head = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px')
        var title = el('div', 'font-weight:700;font-size:14px;letter-spacing:.02em', 'Grok Ball 设置')
        var close = el('button', 'border:0;background:transparent;color:#9aa0ab;font-size:18px;line-height:1;cursor:pointer;padding:2px 6px', '×')
        close.type = 'button'
        close.title = '关闭'
        close.addEventListener('click', closePanel)
        head.appendChild(title)
        head.appendChild(close)
        panel.appendChild(head)

        // size row
        var sizeRow = el('div', 'margin-bottom:12px')
        var sizeLabel = el('div', 'display:flex;align-items:center;justify-content:space-between;color:#b9bec9;font-size:12px;margin-bottom:6px')
        sizeLabel.appendChild(el('span', '', '大小'))
        sizeValue = el('span', 'color:#ffd7e6;font-variant-numeric:tabular-nums', size + 'px')
        sizeLabel.appendChild(sizeValue)
        sizeRow.appendChild(sizeLabel)

        sizeSlider = el('input', 'width:100%;accent-color:#ff9ec6;cursor:pointer')
        sizeSlider.type = 'range'
        sizeSlider.min = String(SIZE_MIN)
        sizeSlider.max = String(SIZE_MAX)
        sizeSlider.step = '4'
        sizeSlider.value = String(size)
        sizeSlider.addEventListener('input', function () {
          applySize(Number(sizeSlider.value))
          if (sizeValue) sizeValue.textContent = size + 'px'
        })
        sizeRow.appendChild(sizeSlider)
        panel.appendChild(sizeRow)

        // snap section
        var snapBox = el('div', 'margin-bottom:12px')
        snapBox.appendChild(el('div', 'color:#b9bec9;font-size:12px;margin-bottom:6px', '吸附'))
        var modeRow = el('div', 'display:flex;gap:6px;margin-bottom:8px')
        snapModeButtons = {}
        var modeDefs = [['px', '绝对吸附'], ['ratio', '比例吸附']]
        modeDefs.forEach(function (pair) {
          var modeButton = el('button', 'flex:1;padding:6px 8px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);color:#dfe2e8;font:inherit;font-size:12px;cursor:pointer', pair[1])
          modeButton.type = 'button'
          modeButton.setAttribute('data-mode', pair[0])
          modeButton.addEventListener('click', function () { setSnapMode(pair[0]) })
          snapModeButtons[pair[0]] = modeButton
          modeRow.appendChild(modeButton)
        })
        snapBox.appendChild(modeRow)

        var sideNames = { top: '上', right: '右', bottom: '下', left: '左' }
        snapRows = {}
        SNAP_SIDES.forEach(function (side) {
          var row = el('div', 'display:flex;align-items:center;gap:8px;margin:6px 0')
          row.appendChild(el('span', 'width:28px;color:#b9bec9;font-size:12px', sideNames[side]))
          var input = el('input', 'flex:1;accent-color:#ff9ec6;cursor:pointer')
          input.type = 'range'
          input.setAttribute('data-side', side)
          input.addEventListener('input', function () {
            snapCfg[side] = clampSnapValue(Number(input.value), snapCfg.mode)
            writeSnap()
            refreshSnapUI()
          })
          row.appendChild(input)
          var out = el('span', 'width:40px;text-align:right;color:#ffd7e6;font-size:11px;font-variant-numeric:tabular-nums')
          row.appendChild(out)
          snapRows[side] = { input: input, value: out }
          snapBox.appendChild(row)
        })
        snapBox.appendChild(el('div', 'font-size:11px;color:#7f8590;line-height:1.45', '范围 0 = 关闭该边；比例吸附按窗口宽/高的百分比计算'))
        panel.appendChild(snapBox)
        refreshSnapUI()

        // emotion section
        var catalog = emotionCatalog()
        var emoTitle = el('div', 'color:#b9bec9;font-size:12px;margin:2px 0 8px', '表情')
        panel.appendChild(emoTitle)

        followChip = el('button', 'display:block;width:100%;text-align:center;margin-bottom:10px;padding:7px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e8e8ee;font:inherit;cursor:pointer', '跟随 DSH 状态')
        followChip.type = 'button'
        followChip.addEventListener('click', function () { savePinned(null) })
        panel.appendChild(followChip)

        var groupNames = { life: '生命周期', emotion: '情绪反应', agent: '代理状态' }
        catalog.groups.forEach(function (group) {
          var list = catalog.emotions.filter(function (emotion) { return emotion.group === group.key })
          if (!list.length) return
          panel.appendChild(el('div', 'color:#7f8590;font-size:11px;letter-spacing:.08em;margin:10px 0 6px', groupNames[group.key] || group.name))
          var grid = el('div', 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px')
          list.forEach(function (emotion) {
            var chip = el('button', 'padding:6px 2px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.045);color:#dfe2e8;font:inherit;font-size:11px;line-height:1.25;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', emotion.id + ' ' + emotion.name)
            chip.type = 'button'
            chip.title = emotion.name + '（' + emotion.id + '）'
            chip.addEventListener('click', function () { savePinned(emotion.id) })
            chips[emotion.id] = chip
            grid.appendChild(chip)
          })
          panel.appendChild(grid)
        })

        // hide-menu toggle
        var toggleRow = el('label', 'display:flex;align-items:flex-start;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);cursor:pointer')
        hideInput = el('input', 'margin-top:2px;accent-color:#ff9ec6')
        hideInput.type = 'checkbox'
        hideInput.checked = hideMenu
        hideInput.addEventListener('change', function () {
          hideMenu = hideInput.checked === true
          writeRaw(HIDE_KEY, hideMenu ? '1' : '0')
          if (hideMenu) hideMenuButton()
        })
        toggleRow.appendChild(hideInput)
        var toggleText = el('div', '')
        toggleText.appendChild(el('div', 'font-size:12px;color:#e8e8ee', '隐藏菜单按钮'))
        toggleText.appendChild(el('div', 'font-size:11px;color:#7f8590;margin-top:2px', '开启后：左键正常交互，右键唤出本面板'))
        toggleRow.appendChild(toggleText)
        panel.appendChild(toggleRow)

        document.body.appendChild(panel)
        panel.addEventListener('pointerdown', function (event) { event.stopPropagation() })
        return panel
      }

      function placePanel() {
        if (panel === null || !panelOpen) return
        var rect = host.getBoundingClientRect()
        var width = panel.offsetWidth || 300
        var height = panel.offsetHeight || 420
        var x = rect.left + rect.width + 12
        if (x + width > window.innerWidth - EDGE) x = rect.left - width - 12
        x = Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE))
        var y = Math.max(EDGE, Math.min(rect.top - 8, viewHeight() - height - EDGE))
        panel.style.left = x + 'px'
        panel.style.top = y + 'px'
      }

      function updateChips() {
        var active = ball !== null ? ball.emotionId : pinned
        var catalog = emotionCatalog()
        catalog.emotions.forEach(function (emotion) {
          var chip = chips[emotion.id]
          if (!chip) return
          var on = emotion.id === active
          chip.style.background = on ? 'rgba(255,158,198,.22)' : 'rgba(255,255,255,.045)'
          chip.style.borderColor = on ? 'rgba(255,158,198,.7)' : 'rgba(255,255,255,.1)'
          chip.style.color = on ? '#ffe3ee' : '#dfe2e8'
        })
        if (followChip !== null) {
          var follow = pinned === null
          followChip.style.background = follow ? 'rgba(255,158,198,.18)' : 'rgba(255,255,255,.06)'
          followChip.style.borderColor = follow ? 'rgba(255,158,198,.6)' : 'rgba(255,255,255,.14)'
        }
      }

      function openPanel() {
        if (disposed) return
        ensurePanel()
        panelOpen = true
        panel.style.display = 'block'
        placePanel()
        updateChips()
        hideMenuButton()
        idleSince = Date.now()
        render()
        document.addEventListener('pointerdown', onDocDown, true)
        document.addEventListener('keydown', onKeyDown, true)
      }

      function closePanel() {
        if (panel === null || !panelOpen) return
        panelOpen = false
        panel.style.display = 'none'
        document.removeEventListener('pointerdown', onDocDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
      }

      function togglePanel() {
        if (panelOpen) closePanel()
        else openPanel()
      }

      function onDocDown(event) {
        if (!panelOpen) return
        var target = event.target
        if (panel !== null && panel.contains(target)) return
        if (host.contains(target)) return
        closePanel()
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') closePanel()
      }

      // --- menu button ----------------------------------------------------
      function ensureMenuButton() {
        if (menuButton !== null) return menuButton
        menuButton = el('button', [
          'position: absolute',
          'top: -6px',
          'right: -6px',
          'width: 22px',
          'height: 22px',
          'padding: 0',
          'border-radius: 50%',
          'border: 1px solid rgba(255,255,255,.25)',
          'background: rgba(23,24,29,.92)',
          'color: #f3d7e4',
          'font: 700 13px/1 "Segoe UI", system-ui, sans-serif',
          'display: none',
          'align-items: center',
          'justify-content: center',
          'cursor: pointer',
          'box-shadow: 0 4px 10px rgba(0,0,0,.3)',
          'opacity: 0',
          'transition: opacity 140ms ease'
        ].join(';'), '⋯')
        menuButton.type = 'button'
        menuButton.title = '打开面板'
        menuButton.setAttribute('aria-label', 'Grok Ball 设置')
        menuButton.addEventListener('pointerdown', function (event) {
          event.stopPropagation()
          event.preventDefault()
        })
        menuButton.addEventListener('click', function (event) {
          event.stopPropagation()
          openPanel()
        })
        host.appendChild(menuButton)
        return menuButton
      }

      function showMenuButton() {
        if (hideMenu) return
        var button = ensureMenuButton()
        if (menuHideTimer) { clearTimeout(menuHideTimer); menuHideTimer = 0 }
        button.style.display = 'flex'
        // force a style flush so the opacity transition runs
        void button.offsetWidth
        button.style.opacity = '1'
        menuTimer = setTimeout(hideMenuButton, MENU_MS)
      }

      function hideMenuButton() {
        if (menuTimer) { clearTimeout(menuTimer); menuTimer = 0 }
        if (menuButton === null) return
        menuButton.style.opacity = '0'
        if (menuHideTimer) clearTimeout(menuHideTimer)
        menuHideTimer = setTimeout(function () {
          if (menuButton !== null && !panelOpen) menuButton.style.display = 'none'
        }, 160)
      }

      // --- state mapping --------------------------------------------------
      function scheduleWake(at) {
        if (wakeTimer) clearTimeout(wakeTimer)
        var delay = Math.max(40, at - Date.now() + 30)
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
        var running = !!(row && row.running)
        var waiting = !!(row && row.pendingInteraction)
        if (running && !prevRunning) {
          startUntil = ts + START_MS
          idleSince = ts
        }
        if (running || waiting) idleSince = ts
        if (!running && prevRunning) {
          startUntil = 0
          doneUntil = ts + DONE_MS
          if (!document.hidden) {
            try { ball.burst(14) } catch (err) { /* particles are best-effort */ }
          }
        }
        prevRunning = running

        var sleeping = !running && !waiting && ts - idleSince > SLEEP_MS
        var emotion = '02'
        if (ts < clickUntil) emotion = '10'
        else if (pinned !== null) emotion = pinned
        else if (waiting) emotion = '35'
        else if (running) emotion = ts < startUntil ? '31' : '30'
        else if (ts < doneUntil) emotion = '33'
        else if (sleeping) emotion = '00'

        if (ball.emotionId !== emotion) {
          try { ball.setEmotion(emotion) } catch (err) { warn('setEmotion failed: ' + err) }
          updateChips()
        }

        // Arm the next timer only when a deadline is still open.
        var deadlines = []
        if (ts < clickUntil) deadlines.push(clickUntil)
        if (ts < startUntil) deadlines.push(startUntil)
        if (ts < doneUntil) deadlines.push(doneUntil)
        if (!running && !waiting && !sleeping && pinned === null) deadlines.push(idleSince + SLEEP_MS)
        if (deadlines.length) {
          scheduleWake(Math.min.apply(null, deadlines))
        } else if (wakeTimer) {
          clearTimeout(wakeTimer)
          wakeTimer = 0
        }
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
        idleSince = Date.now()
        try {
          ball.spin(1)
          ball.bounce()
        } catch (err) { warn('click feedback failed: ' + err) }
        render()
        showMenuButton()
      }

      // --- drag -----------------------------------------------------------
      function onPointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (event.target === menuButton) return
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
        pos = clampPos({ x: dragging.originX + dx, y: dragging.originY + dy }, size)
        applyPos()
      }

      function onPointerUp(event) {
        if (dragging === null || event.pointerId !== dragging.id) return
        var moved = dragging.moved
        dragging = null
        host.style.cursor = 'grab'
        try { host.releasePointerCapture(event.pointerId) } catch (err) { /* ignore */ }
        if (moved) {
          pos = snapPos(pos, size, snapCfg)
          applyPos()
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

      function onContextMenu(event) {
        event.preventDefault()
        idleSince = Date.now()
        openPanel()
      }

      // --- placement ------------------------------------------------------
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
        pos = clampPos({ x: pos.x + dx, y: pos.y + dy }, size)
        applyPos()
        writePos(pos)
      }

      function checkPlacement() {
        if (disposed) return
        var next = clampPos(pos, size)
        if (next.x !== pos.x || next.y !== pos.y) {
          pos = next
          applyPos()
        }
        ensureInView()
        placePanel()
      }

      function onResize() {
        checkPlacement()
        if (panelOpen) placePanel()
      }

      // --- mount ----------------------------------------------------------
      host.style.position = 'fixed'
      host.style.pointerEvents = 'auto'
      host.style.width = size + 'px'
      host.style.height = size + 'px'
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

      var clip = document.createElement('div')
      clip.style.position = 'absolute'
      clip.style.overflow = 'hidden'
      clip.style.pointerEvents = 'none'
      host.appendChild(clip)

      var child = document.createElement('div')
      child.style.position = 'absolute'
      child.style.pointerEvents = 'auto'
      clip.appendChild(child)

      /** Ball stays its own size; the clip box is a bit larger so trails and the jump stay whole. */
      function layoutBall() {
        var pad = Math.max(6, Math.round(size * 0.18))
        clip.style.width = (size + pad * 2) + 'px'
        clip.style.height = (size + pad * 2) + 'px'
        clip.style.left = (-pad) + 'px'
        clip.style.top = (-pad) + 'px'
        child.style.width = size + 'px'
        child.style.height = size + 'px'
        child.style.left = pad + 'px'
        child.style.top = pad + 'px'
      }
      layoutBall()

      try {
        ball = window.GrokBall.create(child, { emotion: '02', eyeScale: 1.25, label: 'Grok Ball' })
      } catch (err) {
        warn('create failed: ' + err)
        return function () {}
      }

      // The clip box above bounds the engine's overflow: trails, halo and the
      // jump stay whole inside it, and nothing leaves the widget.
      var svg = child.firstElementChild
      if (svg !== null && svg !== undefined && svg.style) svg.style.overflow = 'visible'

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
      host.addEventListener('contextmenu', onContextMenu)
      host.addEventListener('pointerenter', function () { host.style.transform = 'scale(1.05)' })
      host.addEventListener('pointerleave', function () { host.style.transform = '' })

      checkPlacement()
      placementTimer = setInterval(checkPlacement, 2000)

      var unsubStatus = null
      var unsubCurrent = null
      try {
        if (statusSource && typeof statusSource.subscribe === 'function') {
          unsubStatus = statusSource.subscribe(function () {
            idleSince = Date.now()
            render()
          })
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
        if (menuTimer) { clearTimeout(menuTimer); menuTimer = 0 }
        if (menuHideTimer) { clearTimeout(menuHideTimer); menuHideTimer = 0 }
        if (placementTimer) { clearInterval(placementTimer); placementTimer = 0 }
        closePanel()
        document.removeEventListener('pointerdown', onDocDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
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
        host.removeEventListener('contextmenu', onContextMenu)
        try { if (typeof unsubStatus === 'function') unsubStatus() } catch (err) { /* ignore */ }
        try { if (typeof unsubCurrent === 'function') unsubCurrent() } catch (err) { /* ignore */ }
        try { if (ball !== null) ball.destroy() } catch (err) { /* ignore */ }
        ball = null
        if (panel !== null && panel.parentNode) panel.parentNode.removeChild(panel)
        panel = null
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
