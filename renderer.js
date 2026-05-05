'use strict'

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  entries: [],
  filtered: [],
  selected: null,
  filter: 'all',
  search: '',
  activeDetailTab: 'request',
  insights: null,
  filename: ''
}

// ── Init ───────────────────────────────────────────────────────────────────
let searchTimer = null

document.addEventListener('DOMContentLoaded', () => {
  // Theme
  const themeBtn = document.getElementById('theme-toggle')
  const applyTheme = dark => {
    document.body.classList.toggle('dark-theme', dark)
    themeBtn.textContent = dark ? 'Light' : 'Dark'
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }
  applyTheme(localStorage.getItem('theme') === 'dark')
  themeBtn.addEventListener('click', () => applyTheme(!document.body.classList.contains('dark-theme')))

  document.getElementById('open-btn').addEventListener('click', openFile)
  document.getElementById('search').addEventListener('input', e => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      state.search = e.target.value.toLowerCase()
      applyFilter()
    }, 150)
  })
  document.querySelectorAll('.ftab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.filter = btn.dataset.filter
      applyFilter()
    })
  })
  document.querySelectorAll('.dtab').forEach(btn => {
    btn.addEventListener('click', () => switchDetailTab(btn.dataset.tab))
  })
  document.body.addEventListener('dragover', e => {
    e.preventDefault()
    document.body.classList.add('dragover')
  })
  document.body.addEventListener('dragleave', () => document.body.classList.remove('dragover'))
  document.body.addEventListener('drop', async e => {
    e.preventDefault()
    document.body.classList.remove('dragover')
    const file = e.dataTransfer.files[0]
    if (!file) return
    const text = await file.text()
    loadHAR(text, file.name, file.size)
  })
})

// ── File loading ───────────────────────────────────────────────────────────
async function openFile() {
  const result = await window.electronAPI.openFile()
  if (!result) return
  loadHAR(result.content, result.name, result.size)
}

function loadHAR(text, name, size) {
  let har
  try {
    har = JSON.parse(text)
  } catch {
    alert('Failed to parse HAR file — not valid JSON.')
    return
  }
  state.entries = (har.log?.entries || []).map((e, i) => cacheEntryMeta(e, i))
  state.filename = name || 'unknown.har'
  state.filter = 'all'
  state.search = ''
  state.selected = null
  document.getElementById('search').value = ''
  document.querySelectorAll('.ftab').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === 'all')
  })
  state.insights = analyzeHAR(state.entries)
  renderInsights(size)
  applyFilter()
  hideDetail()
  document.getElementById('empty-state').style.display = 'none'
  document.getElementById('file-info').textContent =
    `${name}  ·  ${formatBytes(size)}  ·  ${state.entries.length} entries`
}

// ── Filtering ──────────────────────────────────────────────────────────────
function applyFilter() {
  const { filter, search, entries } = state
  state.filtered = entries.filter(e => {
    if (filter === 'http' && e._isWS) return false
    if (filter === 'ws' && !e._isWS) return false
    if (filter === 'api' && (e._isWS || !e._url.includes('/api/'))) return false
    if (search && !e._searchText.includes(search)) return false
    return true
  })
  renderEntryList()
  const countEl = document.getElementById('entry-count')
  countEl.classList.remove('hidden')
  countEl.textContent = `${state.filtered.length} of ${state.entries.length} entries`
}

// ── Entry list ─────────────────────────────────────────────────────────────
function renderEntryList() {
  const list = document.getElementById('entries-list')
  if (state.filtered.length === 0 && state.entries.length > 0) {
    list.innerHTML = `<div class="no-results">No entries match your filter</div>`
    return
  }
  list.innerHTML = state.filtered.map(e => entryRowHTML(e)).join('')
}

// Single delegated listener — set up once after the DOM loads, not per-render
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('entries-list').addEventListener('click', ev => {
    const row = ev.target.closest('.entry-row')
    if (!row) return
    selectEntry(parseInt(row.dataset.idx, 10))
  })
})

function entryRowHTML(e) {
  const isSelected = state.selected === e._idx
  return `
    <div class="entry-row${isSelected ? ' selected' : ''}" data-idx="${e._idx}">
      <span class="method-pill ${e._methodClass}">${e._method}</span>
      <span class="entry-url" title="${escHtml(e._url)}">${escHtml(e._path)}</span>
      ${e._badgeHtml}
      <span class="status-pill ${e._statusClass}">${e._status || ''}</span>
    </div>`
}

// ── Selection / Detail ─────────────────────────────────────────────────────
function selectEntry(idx) {
  // Update selection highlight without rebuilding the list
  if (state.selected !== null) {
    document.querySelector(`.entry-row[data-idx="${state.selected}"]`)?.classList.remove('selected')
  }
  state.selected = idx
  document.querySelector(`.entry-row[data-idx="${idx}"]`)?.classList.add('selected')
  const e = state.entries[idx]
  if (e) showDetail(e)
}

function hideDetail() {
  document.getElementById('detail-placeholder').style.display = 'flex'
  document.getElementById('detail-content').classList.add('hidden')
}

function showDetail(e) {
  document.getElementById('detail-placeholder').style.display = 'none'
  document.getElementById('detail-content').classList.remove('hidden')

  const { _isWS: isWS, _method: method, _status: status, _url: url, _statusClass } = e

  const methodEl = document.getElementById('detail-method')
  methodEl.textContent = method
  methodEl.className = `method-badge method-pill ${e._methodClass}`

  document.getElementById('detail-url').textContent = url

  const statusEl = document.getElementById('detail-status')
  statusEl.textContent = status || (isWS ? 'WS' : '')
  statusEl.className = `status-badge ${_statusClass}`

  // Show/hide WS and Auth tabs
  const wsTab = document.getElementById('ws-dtab')
  const authTab = document.getElementById('auth-dtab')
  wsTab.style.display = isWS ? '' : 'none'
  authTab.style.display = e._hasAuth ? '' : 'none'

  renderRequestTab(e)
  renderResponseTab(e)
  if (isWS) renderWSTab(e)
  if (e._hasAuth) renderAuthTab(e)

  // Default tab: messages for WS, request otherwise
  switchDetailTab(isWS ? 'ws' : 'request')
}

function switchDetailTab(tab) {
  state.activeDetailTab = tab
  document.querySelectorAll('.dtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${tab}`))
}

// ── Request tab ────────────────────────────────────────────────────────────
function renderRequestTab(e) {
  const req = e.request
  let html = ''

  html += `<div class="headers-section"><div class="section-title">Request Headers</div>`
  html += (req.headers || []).map(h => `
    <div class="header-row">
      <span class="header-name">${escHtml(h.name)}</span>
      <span class="header-value${isAuthHeader(h.name) ? ' auth-highlight' : ''}">${escHtml(h.value)}</span>
    </div>`).join('')
  html += `</div>`

  if (req.queryString?.length) {
    html += `<div class="headers-section"><div class="section-title">Query Parameters</div>`
    html += req.queryString.map(q => `
      <div class="query-param-row">
        <span class="param-name">${escHtml(q.name)}</span>
        <span class="param-value">${escHtml(q.value)}</span>
      </div>`).join('')
    html += `</div>`
  }

  if (req.postData?.text) {
    html += `<div class="headers-section"><div class="section-title">Request Body</div>`
    html += bodyHTML(req.postData.text, req.postData.mimeType)
    html += `</div>`
  }

  document.getElementById('tab-request').innerHTML = html
}

// ── Response tab ───────────────────────────────────────────────────────────
function renderResponseTab(e) {
  const resp = e.response
  let html = ''

  html += `<div class="headers-section"><div class="section-title">Response Headers</div>`
  html += (resp.headers || []).map(h => `
    <div class="header-row">
      <span class="header-name">${escHtml(h.name)}</span>
      <span class="header-value">${escHtml(h.value)}</span>
    </div>`).join('')
  html += `</div>`

  const body = resp.content?.text
  if (body) {
    html += `<div class="headers-section"><div class="section-title">Response Body</div>`
    html += bodyHTML(body, resp.content?.mimeType)
    html += `</div>`
  }

  document.getElementById('tab-response').innerHTML = html
}

// ── WS messages tab ────────────────────────────────────────────────────────
function renderWSTab(e) {
  const msgs = e._webSocketMessages || []
  const compressed = msgs.filter(m => hasCompressedPayload(m)).length
  let html = `<div class="ws-summary">${msgs.length} messages · ${msgs.filter(m => m.type === 'send').length} sent · ${msgs.filter(m => m.type === 'receive').length} received${compressed ? ` · ${compressed} compressed` : ''}</div>`
  html += msgs.map((m, i) => wsMsgHTML(m, i)).join('')
  const pane = document.getElementById('tab-ws')
  pane.innerHTML = html
  // Bind expand toggles
  pane.querySelectorAll('.ws-msg-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling
      const toggle = hdr.querySelector('.ws-toggle')
      const open = !body.classList.contains('hidden')
      body.classList.toggle('hidden', open)
      if (toggle) toggle.textContent = open ? '▶' : '▼'
    })
  })
  // Bind decode buttons
  pane.querySelectorAll('.decode-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      const raw = btn.dataset.payload
      const target = document.getElementById(btn.dataset.target)
      btn.textContent = 'Decoding...'
      btn.disabled = true
      const result = await decodePayload(raw)
      const text = result.type === 'json' ? JSON.stringify(result.value, null, 2) : result.value
      target.className = 'ws-decoded'
      target.innerHTML = result.type === 'json' ? syntaxHighlight(text) : escHtml(text)
      target.classList.remove('hidden')

      // Replace decode button with copy button
      const copyBtn = document.createElement('button')
      copyBtn.className = 'copy-btn'
      copyBtn.textContent = 'Copy'
      copyBtn.addEventListener('click', ev => {
        ev.stopPropagation()
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied!'
          setTimeout(() => { copyBtn.textContent = 'Copy' }, 1500)
        })
      })
      btn.replaceWith(copyBtn)
    })
  })
}

function wsMsgHTML(m, idx) {
  const dir = m.type === 'send' ? 'send' : m.type === 'receive' ? 'receive' : 'error'
  const dirLabel = m.type === 'send' ? '▲ SEND' : m.type === 'receive' ? '▼ RECV' : 'ERR'
  let data = m.data || ''
  let parsed = null
  try { parsed = JSON.parse(data) } catch {}

  const stream = parsed?.stream
  const isCompressed = parsed && (parsed.raw_payload_compressed === true || (typeof parsed.raw_payload === 'string' && parsed.raw_payload.length > 50 && looksBase64(parsed.raw_payload)))
  const hasRawPayload = parsed?.raw_payload && typeof parsed.raw_payload === 'string' && parsed.raw_payload.length > 20
  const jwtInData = extractJWTs(data)
  const bodyId = `ws-body-${idx}`

  let badges = ''
  if (isCompressed) badges += `<span class="ws-badge compressed">compressed</span>`
  if (jwtInData.length) badges += `<span class="ws-badge jwt">JWT</span>`
  if (stream) badges += `<span class="ws-stream">${escHtml(stream)}</span>`
  if (parsed?.resource) badges += `<span class="ws-stream">${escHtml(parsed.resource)}</span>`
  if (parsed?.raw_payload?.resource) badges += `<span class="ws-stream">${escHtml(parsed.raw_payload.resource)}</span>`

  const preview = data.length > 120 ? data.slice(0, 120) + '…' : data

  // Build body content — always show the real envelope JSON including the raw base64 string
  let bodyContent = parsed ? syntaxHighlight(JSON.stringify(parsed, null, 2)) : escHtml(data)
  const decodeBtn = (isCompressed && hasRawPayload)
    ? `<button class="decode-btn" data-payload="${escHtml(parsed.raw_payload)}" data-target="${bodyId}-decoded">Decode payload</button>`
    : ''

  return `
    <div class="ws-msg ${dir}">
      <div class="ws-msg-header">
        <span class="ws-direction ${dir}">${dirLabel}</span>
        ${badges}
        <span class="ws-msg-preview">${escHtml(preview)}</span>
        ${decodeBtn}
        <span class="ws-toggle">▶</span>
      </div>
      <div class="ws-msg-body hidden" id="${bodyId}">
        ${bodyContent}
        ${isCompressed && hasRawPayload ? `<div class="ws-decoded hidden" id="${bodyId}-decoded"></div>` : ''}
      </div>
    </div>`
}

// ── Auth tab ───────────────────────────────────────────────────────────────
function renderAuthTab(e) {
  let html = ''

  // Auth headers
  const authHdrs = (e.request?.headers || []).filter(h => isAuthHeader(h.name))
  if (authHdrs.length) {
    html += `<div class="auth-section"><div class="section-title">Auth Headers</div>
      <div class="auth-header-list">${authHdrs.map(h =>
        `<div class="auth-header-item"><span class="key">${escHtml(h.name)}</span><span class="value">${escHtml(h.value)}</span></div>`
      ).join('')}</div></div>`
  }

  // JWTs from WS messages
  const allText = JSON.stringify(e)
  const jwts = extractJWTs(allText)
  if (jwts.length) {
    html += `<div class="auth-section"><div class="section-title">JWT Tokens</div>`
    jwts.forEach(token => { html += jwtCardHTML(token) })
    html += `</div>`
  }

  document.getElementById('tab-auth').innerHTML = html
}

function jwtCardHTML(token) {
  const decoded = decodeJWT(token)
  if (!decoded) return ''
  const { payload } = decoded
  const now = Date.now() / 1000
  let expiryHtml = ''
  if (payload.exp) {
    const expired = payload.exp < now
    const dt = new Date(payload.exp * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    expiryHtml = `<span class="jwt-expiry ${expired ? 'expired' : 'active'}">${expired ? 'EXPIRED' : 'VALID'} · exp ${dt}</span>`
  }

  const claimRows = Object.entries(payload).map(([k, v]) => {
    const isDate = ['exp', 'iat', 'orig_iat', 'nbf'].includes(k) && typeof v === 'number'
    const display = isDate ? `${v} (${new Date(v * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC)` : JSON.stringify(v)
    return `<div class="jwt-claim-row">
      <span class="jwt-claim-key">${escHtml(k)}</span>
      <span class="jwt-claim-value${isDate ? ' date' : ''}">${escHtml(display)}</span>
    </div>`
  }).join('')

  return `
    <div class="jwt-card">
      <div class="jwt-card-header">
        <span>HS${decoded.header.alg?.replace('HS','') || '?'} JWT</span>
        ${expiryHtml}
      </div>
      <div class="jwt-section">
        <div class="jwt-section-title">Payload Claims</div>
        ${claimRows}
      </div>
      <div class="jwt-section">
        <div class="jwt-section-title">Raw Token</div>
        <div class="raw-token">${escHtml(token.slice(0, 80))}…</div>
      </div>
    </div>`
}

// ── Insights ───────────────────────────────────────────────────────────────
function analyzeHAR(entries) {
  const wsEntries = entries.filter(e => e._isWS)
  const apiEntries = entries.filter(e => !e._isWS && e._url.includes('/api/'))
  // Collect JWTs by scanning only headers and WS message data — not JSON.stringify(entries)
  const allJWTs = new Set()
  const authHdrs = {}
  entries.forEach(e => {
    ;(e.request?.headers || []).forEach(h => {
      if (isAuthHeader(h.name)) {
        if (!authHdrs[h.name]) authHdrs[h.name] = new Set()
        authHdrs[h.name].add(h.value)
      }
      extractJWTs(h.value).forEach(t => allJWTs.add(t))
    })
    ;(e._webSocketMessages || []).forEach(m => {
      extractJWTs(m.data || '').forEach(t => allJWTs.add(t))
    })
  })
  const apiResources = []
  wsEntries.forEach(e => {
    (e._webSocketMessages || []).forEach(m => {
      try {
        const p = JSON.parse(m.data)
        const res = p?.raw_payload?.resource
        if (res) apiResources.push(res)
      } catch {}
    })
  })
  const compressedCount = wsEntries.reduce((sum, e) =>
    sum + (e._webSocketMessages || []).filter(hasCompressedPayload).length, 0)

  return { wsEntries, apiEntries, allJWTs: [...allJWTs], authHdrs, apiResources: [...new Set(apiResources)], compressedCount }
}

function renderInsights(fileSize) {
  const ins = state.insights
  const el = document.getElementById('insights')
  const badges = []

  badges.push(`<span class="insight-badge good">&#9654; ${state.entries.length} entries</span>`)
  if (ins.wsEntries.length)
    badges.push(`<span class="insight-badge purple">&#9632; ${ins.wsEntries.length} WebSocket${ins.wsEntries.length > 1 ? 's' : ''}</span>`)
  if (ins.apiEntries.length)
    badges.push(`<span class="insight-badge">&#9670; ${ins.apiEntries.length} API calls</span>`)
  if (ins.compressedCount)
    badges.push(`<span class="insight-badge warn">&#9888; ${ins.compressedCount} compressed WS payload${ins.compressedCount > 1 ? 's' : ''}</span>`)
  if (ins.allJWTs.length) {
    const decoded = ins.allJWTs.map(decodeJWT).filter(Boolean)
    const users = [...new Set(decoded.map(d => d.payload.username || d.payload.email).filter(Boolean))]
    badges.push(`<span class="insight-badge warn">&#9670; JWT: ${users.join(', ') || 'found'}</span>`)
  }
  if (Object.keys(ins.authHdrs).length) {
    const names = Object.keys(ins.authHdrs).join(', ')
    badges.push(`<span class="insight-badge">&#9632; Auth headers: ${escHtml(names)}</span>`)
  }
  ins.apiResources.forEach(r => {
    badges.push(`<span class="insight-badge good">&#9679; WS resource: ${escHtml(r)}</span>`)
  })

  el.innerHTML = badges.join('<span class="insight-sep">|</span>')
  el.classList.remove('hidden')
}

// ── Entry metadata cache ───────────────────────────────────────────────────
// Pre-computed once at load so renderEntryList never does expensive work per-render
function cacheEntryMeta(e, i) {
  const isWS = e.request?.url?.startsWith('wss://') || e.request?.url?.startsWith('ws://')
  const url = e.request?.url || ''
  const method = isWS ? 'WS' : (e.request?.method || '?')
  const status = e.response?.status || 0
  const path = (() => {
    try { const u = new URL(url); return u.hostname + u.pathname + (u.search.length > 1 ? u.search.slice(0, 40) + (u.search.length > 40 ? '…' : '') : '') }
    catch { return url }
  })()
  const methodClass = `method-${['GET','POST','PUT','DELETE','WS'].includes(method) ? method : 'OTHER'}`
  const statusClass = status >= 500 ? 'status-5xx' : status >= 400 ? 'status-4xx' : status >= 300 ? 'status-3xx' : status >= 200 ? 'status-2xx' : 'status-0'

  // Badge HTML — computed once
  const badges = []
  if (isWS) {
    const msgs = e._webSocketMessages || []
    if (msgs.length) badges.push(`<span class="entry-icon icon-ws" title="${msgs.length} messages">&#9636; ${msgs.length}</span>`)
    if (msgs.some(m => hasCompressedPayload(m))) badges.push(`<span class="entry-icon icon-compressed" title="Compressed payloads">&#9632;</span>`)
  }
  const hasJWTFlag = (e.request?.headers || []).some(h => extractJWTs(h.value).length > 0) ||
    (e._webSocketMessages || []).some(m => extractJWTs(m.data || '').length > 0)
  if (hasJWTFlag) badges.push(`<span class="entry-icon icon-jwt" title="JWT found">&#9670;</span>`)

  const hasAuthFlag = (e.request?.headers || []).some(h => isAuthHeader(h.name))

  return {
    ...e,
    _idx: i,
    _isWS: isWS,
    _url: url,
    _method: method,
    _status: status,
    _path: path,
    _methodClass: methodClass,
    _statusClass: statusClass,
    _badgeHtml: badges.join(''),
    _hasAuth: hasJWTFlag || hasAuthFlag,
    // Lowercase searchable text — built once, reused on every keystroke
    _searchText: `${method} ${url} ${status}`.toLowerCase()
  }
}

// ── Decompression ──────────────────────────────────────────────────────────
async function decodePayload(raw) {
  // Try base64 decode
  let bytes
  try {
    const bin = atob(raw)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return { type: 'text', value: raw }
  }

  // Detect format from magic bytes
  const formats = []
  if (bytes[0] === 0x78) formats.push('deflate')          // zlib header
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) formats.push('gzip')
  formats.push('deflate', 'deflate-raw')                   // fallbacks

  for (const fmt of [...new Set(formats)]) {
    try {
      const ds = new DecompressionStream(fmt)
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()
      writer.write(bytes)
      writer.close()
      const chunks = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const total = chunks.reduce((a, c) => a + c.length, 0)
      const buf = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.length }
      const text = new TextDecoder().decode(buf)
      try { return { type: 'json', value: JSON.parse(text) } } catch { return { type: 'text', value: text } }
    } catch { /* try next format */ }
  }
  return { type: 'binary', value: raw }
}

// ── JWT ────────────────────────────────────────────────────────────────────
function decodeJWT(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const decode = s => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')))
    return { header: decode(parts[0]), payload: decode(parts[1]), signature: parts[2] }
  } catch { return null }
}

function extractJWTs(text) {
  return [...new Set((text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g) || []))]
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isAuthHeader(name) {
  const n = name.toLowerCase()
  return ['authorization', 'cookie', 'x-auth-token', 'x-api-key', 'x-client-id',
    'x-tenant', 'x-requestuser', 'x-session', 'x-token'].includes(n)
}

function hasCompressedPayload(m) {
  try {
    const p = JSON.parse(m.data)
    return p.raw_payload_compressed === true ||
      (typeof p.raw_payload === 'string' && p.raw_payload.length > 50 && looksBase64(p.raw_payload))
  } catch { return false }
}

function looksBase64(s) {
  return /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 40)) && s.length % 4 < 3
}

const HIGHLIGHT_LIMIT = 40 * 1024 // skip syntax highlighting above 40 KB

function bodyHTML(text, mimeType = '') {
  const isJSON = mimeType.includes('json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')
  let content
  if (isJSON && text.length < HIGHLIGHT_LIMIT) {
    try {
      content = syntaxHighlight(JSON.stringify(JSON.parse(text), null, 2))
    } catch {
      content = escHtml(text)
    }
  } else {
    content = escHtml(text.length > 200_000 ? text.slice(0, 200_000) + '\n… (truncated)' : text)
  }
  const size = formatBytes(text.length)
  return `
    <div class="body-container">
      <div class="body-toolbar">
        <span>${escHtml(mimeType || 'text')}</span>
        <span>${size}</span>
      </div>
      <div class="body-content">${content}</div>
    </div>`
}

function syntaxHighlight(str) {
  return escHtml(str).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      let cls = 'json-number'
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string'
      else if (/true|false/.test(match)) cls = 'json-bool'
      else if (/null/.test(match)) cls = 'json-null'
      return `<span class="${cls}">${match}</span>`
    }
  )
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
