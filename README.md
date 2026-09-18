# chrome-fetch-mcp

MCP server that fetches web content and performs web searches through your local Chrome/Chromium browser, inheriting all cookies and login sessions. Built for LLM tools that need authenticated, anti-bot-resistant access to web pages.

## Why?

Most fetch MCP servers use raw HTTP requests, which lose browser cookies and get blocked by anti-bot protections. This server connects to your running browser via the DevTools Protocol, so every request carries your existing login state — no re-authentication needed. All network traffic goes through a real Chromium tab (never curl/wget).

## How It Works

1. You start Chrome/Chromium with `--remote-debugging-port=9222`
2. For each request the server opens a **background tab** (created via `Target.createTarget({ background: true })`, no focus stealing), with all your cookies/sessions intact
3. The page loads, security-challenge pages are waited out (see below), content is extracted and cleaned
4. Output is returned in the requested format
5. The temporary tab is auto-closed

## Installation

### Prerequisites

- Node.js >= 18
- Chrome or Chromium installed

### Install

```bash
git clone https://github.com/fsender/chrome-fetch-mcp.git
cd chrome-fetch-mcp
npm install
npm run build
```

### Start Chrome with Debug Port

```bash
# Chromium
chromium --remote-debugging-port=9222

# Google Chrome
google-chrome --remote-debugging-port=9222

# Custom profile (keeps your default profile untouched)
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

## Configuration

Add to your MCP client config (Claude Desktop, opencode, Cursor, …):

```json
{
  "mcpServers": {
    "chrome-fetch": {
      "command": "node",
      "args": ["/path/to/chrome-fetch-mcp/dist/index.js"],
      "env": {
        "CHROME_DEBUG_PORT": "9222",
        "DEFAULT_FORMAT": "markdown",
        "DEFAULT_TIMEOUT": "20000",
        "DEFAULT_MAX_BYTES": "500000",
        "DEFAULT_REMOVE_REDUNDANT": "true",
        "DEFAULT_WAIT_AFTER_LOAD": "1000"
      }
    }
  }
}
```

Environment variables are read **once at server start**. After editing them, fully restart the MCP client (and any gateway/proxy in front of this server) so the new values take effect.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_DEBUG_PORT` | `9222` | Chrome remote debugging port |
| `DEFAULT_FORMAT` | `markdown` | Default output format: `markdown`, `html`, or `json` |
| `DEFAULT_TIMEOUT` | `20000` | Navigation timeout in milliseconds (20s) |
| `DEFAULT_MAX_BYTES` | `500000` | Maximum response size in bytes (truncated if exceeded) |
| `DEFAULT_REMOVE_REDUNDANT` | `true` | Remove CSS/JS/images/base64 by default |
| `DEFAULT_WAIT_AFTER_LOAD` | `1000` | Wait after page load for dynamic content (ms) |

## Tool: `web-url-fetch`

Fetches a single URL and returns its content.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | **Yes** | — | URL to fetch (`http://` or `https://`) |
| `format` | string | No | `markdown` | `markdown`, `html`, or `json` |
| `removeRedundant` | boolean | No | `true` | Master cleaning switch; `false` returns near-raw text |
| `fullPage` | boolean | No | `false` | Convert the entire page (incl. header/footer) instead of focusing on main content |
| `keepImageLinks` | boolean | No | `false` | Keep images/videos as clickable links instead of dropping them |
| `timeout` | number | No | `20000` | Navigation timeout (ms) |
| `maxBytes` | number | No | `500000` | Max response size in bytes |
| `waitAfterLoad` | number | No | `1000` | Wait after page load for dynamic content (ms) |

### Output Formats

**markdown** (default) — clean Markdown, main content focused, clickable `[text](url)` links preserved:

```markdown
# Page Title

> URL: https://example.com

Page content here with [preserved link](https://example.com/page).
```

**html** — cleaned HTML (redundant tags/attributes stripped, links preserved):

```html
<!-- Title: Page Title | URL: https://example.com -->
<div><p>Content with <a href="https://example.com/page">preserved link</a></p></div>
```

**json** — structured output:

```json
{
  "title": "Page Title",
  "url": "https://example.com",
  "content": "Markdown content with [link](https://example.com/page)",
  "links": [{ "text": "link", "href": "https://example.com/page" }],
  "captcha": false
}
```

### Cleaning (removeRedundant=true, default)

By default the extractor focuses on main body content and removes header/footer/nav/ICP/copyright boilerplate, link duplicates, tracking parameters (`utm_*`, `fbclid`, `gclid`, reddit/baidu `rsv_*`, …), and plain-URL-text links. Images/media are dropped unless `keepImageLinks=true`. Additionally removed:

| Category | Removed |
|----------|---------|
| JavaScript | `<script>` tags, all `on*` event attributes |
| CSS | `<style>` tags, `<link rel="stylesheet">`, inline `style` attributes |
| Images/media | `<img>`, `<picture>`, `<source>`, `<video>`, `<audio>`, `<iframe>`, image-file links |
| Graphics | `<svg>`, `<canvas>` |
| Base64 | All elements with `data:` URI sources |
| Noise | `class`, ARIA, `tabindex`, `data-test*`, icon-font chars, empty containers |

**Preserved:** every clickable hyperlink (`<a>` with http/https href) → `[text](url)` in Markdown. Shadow-DOM content (web components) is flattened so it is not missed.

## Tool: `web-search`

Runs a web search in the browser and returns structured results (title / url / snippet).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | **Yes** | — | **Plain-language query — do NOT URL-encode** (server encodes it) |
| `engine` | string | No | `google` | `google`, `bing`, `duckduckgo`, `wikipedia`, `wikidata`, `reddit` |
| `page` | number | No | `1` | Results page (1-based; uses each engine's `start`/`first`/`s`/`offset`; reddit returns a single page) |

### Engines

- `google` / `bing` / `duckduckgo` — general web search (results follow your browser language settings). DuckDuckGo falls back to `lite.duckduckgo.com` automatically if the HTML endpoint returns no results.
- `wikipedia` — English Wikipedia full-text search (English by default).
- `wikidata` — Wikidata search (English interface/labels by default).
- `reddit` — Reddit search via `old.reddit.com` (server-rendered, works with your login session).

### Output

```json
{
  "engine": "google",
  "query": "opencode MCP server",
  "page": 1,
  "results": [
    { "title": "MCP servers | OpenCode", "url": "https://opencode.ai/docs/mcp-servers/", "snippet": "…" }
  ]
}
```

Result count is whatever the engine shows on that page — there is no `count` parameter. Image results, ads, and page chrome are skipped; only each result's title, snippet, and target URL are kept. Use `web-search` to discover links, then open the best ones with `web-url-fetch`.

## Robustness Behaviors

### Timeout semantics (soft-fail)

Navigation timeout (default 20s) no longer hard-fails:

- **Content already rendered but page still loading** (spinner keeps spinning, load event never fires) → the loaded content is extracted and returned normally.
- **Page still completely blank** at timeout → returns a clear error:
  `Navigation timeout after 20000ms: page still blank (no content loaded) for <url>`

This works even when navigation itself hangs (server accepts but never responds): navigation and load waiting share the same timeout budget, and all in-page evaluations are time-bounded.

### Security / Cloudflare challenge pages

When a page shows a challenge interstitial (`Just a moment…`, `正在进行安全验证`, `正在检查您的浏览器`, Turnstile, …):

- The server waits (up to ~20s, separately budgeted from navigation timeout — the timer effectively resets once the page stabilizes) until the challenge clears and the page stays stable, then extracts the final content.
- Regular pages with no challenge markers are **not** delayed at all.

### CAPTCHA

CAPTCHAs are **never solved**. If a CAPTCHA is detected (e.g. `I am not a robot`, reCAPTCHA, `.g-recaptcha`, Turnstile widget):

- The page is still parsed and returned normally (many CAPTCHA pages carry readable content);
- A banner is prepended: `# This page includes CAPTCHA.` (markdown/html), or `"captcha": true` in json output.

## Development

```bash
npm install
npm run build
```

## License

MIT
