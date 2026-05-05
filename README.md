# HAR Analyzer

A desktop app for inspecting HAR (HTTP Archive) files. Built to make it easy to find the API calls behind a page — including data delivered over WebSocket — and decode authentication tokens and compressed payloads.

---

## Features

- **Request list** — all HTTP and WebSocket entries in one filterable list with method, status, and domain
- **Filter tabs** — quickly narrow to All / HTTP / WebSocket / API-only entries
- **Search** — filter by URL, method, or status code
- **WebSocket message viewer** — full send/receive conversation with per-message expand/collapse
- **Payload decoder** — one-click base64 + zlib decompression for compressed WebSocket payloads, with a **Copy** button for the decoded output
- **Auth inspector** — automatically detects JWT tokens and auth headers (`x-client-id`, `x-tenant`, etc.), decodes JWT claims, and flags expiry
- **Insights bar** — on file load, surfaces key findings at a glance: WebSocket count, compressed payloads, JWT users, API resources
- **Syntax-highlighted JSON** — request/response bodies and decoded payloads are pretty-printed with colour
- **Light / Dark theme** — toggle in the toolbar, preference saved across sessions
- **Drag & drop** — drop a `.har` file anywhere on the window to open it

---

## Requirements

| Dependency | Version |
|------------|---------|
| Node.js    | ≥ 22.12.0 |
| npm        | ≥ 10 |

> electron-builder 26.x requires Node 22 via its `@electron/rebuild` dependency. Node 20 will produce engine warnings and may fail at build time.

---

## Getting Started

```bash
git clone https://github.com/your-org/har-analyzer.git
cd har-analyzer
npm install
npm start
```

To open a HAR file: click **Open HAR** in the toolbar, or drag and drop a `.har` file onto the window.

---

## Capturing a HAR File

In Chrome or Edge:

1. Open DevTools → **Network** tab
2. Reproduce the action you want to inspect
3. Right-click any request → **Save all as HAR with content**

---

## Building

Builds are produced in the `dist/` folder.

```bash
# Current platform only
npm run build

# Specific platforms
npm run build:linux   # AppImage + .deb (x64)
npm run build:win     # NSIS installer + portable .exe (x64)
npm run build:mac     # .dmg + .zip (x64 + arm64)
```

### Output formats

| Platform | Formats |
|----------|---------|
| Linux    | `.AppImage`, `.deb` |
| Windows  | NSIS installer, portable `.exe` |
| macOS    | `.dmg`, `.zip` (universal: x64 + Apple Silicon) |

---

## CI / Releases

GitHub Actions builds all three platforms in parallel on every push to a `v*` tag and on manual dispatch.

**To publish a release:**

```bash
git tag v1.2.0
git push origin v1.2.0
```

The workflow will:
1. Build Linux on `ubuntu-latest`, Windows on `windows-latest`, macOS on `macos-latest`
2. Upload all build artifacts
3. Create a GitHub Release with auto-generated release notes and all artifacts attached

To trigger a build without a release, use **Actions → Build → Run workflow** in the GitHub UI.

> macOS builds are unsigned. To enable code signing, add your certificate as a `CSC_LINK` / `CSC_KEY_PASSWORD` secret in the repository settings.

---

## Project Structure

```
har-analyzer/
├── main.js        # Electron main process — window creation, file dialog
├── preload.js     # Context bridge — exposes openFile() to renderer
├── index.html     # App shell
├── styles.css     # Light/dark theme via CSS variables
└── renderer.js    # All UI logic — parsing, filtering, decoding, rendering
```

---

## How It Works

HAR files record every network request made by a browser tab. Most data loads over standard HTTP, but some apps (including Epicor Retail Cloud) stream data through WebSocket connections using a custom `api_call` message protocol with zlib-compressed, base64-encoded payloads. Standard browser DevTools makes these hard to inspect. HAR Analyzer surfaces WebSocket messages directly, auto-detects compressed payloads, and decodes them in one click.
