# chrome-fetch-mcp

MCP server that fetches web content through your local Chrome/Chromium browser, inheriting all cookies and login sessions. Built for LLM tools that need authenticated access to web pages.

## Why?

Most fetch MCP servers use raw HTTP requests, which lose browser cookies and get blocked by anti-bot protections. This server connects to your running Chrome via the DevTools Protocol, so every request carries your existing login state — no re-authentication needed.

## How It Works

1. You start Chrome with `--remote-debugging-port=9222`
2. The MCP server opens a temporary tab in **your browser** for each request
3. The page loads with all your cookies/sessions intact
4. Content is extracted, cleaned (CSS/JS/images/base64 removed, links preserved), and returned
5. The temporary tab is auto-closed

## Installation

### Prerequisites

- Node.js >= 18
- Chrome or Chromium installed

### Install

```bash
git clone https://github.com/<your-username>/chrome-fetch-mcp.git
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

Add to your MCP client config (e.g. Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "chrome-fetch": {
      "command": "node",
      "args": ["/path/to/chrome-fetch-mcp/dist/index.js"],
      "env": {
        "CHROME_DEBUG_PORT": "9222",
        "DEFAULT_FORMAT": "markdown",
        "DEFAULT_TIMEOUT": "30000",
        "DEFAULT_MAX_BYTES": "500000",
        "DEFAULT_REMOVE_REDUNDANT": "true",
        "DEFAULT_WAIT_AFTER_LOAD": "1000"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_DEBUG_PORT` | `9222` | Chrome remote debugging port |
| `DEFAULT_FORMAT` | `markdown` | Default output format: `markdown`, `html`, or `json` |
| `DEFAULT_TIMEOUT` | `30000` | Navigation timeout in milliseconds |
| `DEFAULT_MAX_BYTES` | `500000` | Maximum response size in bytes (truncated if exceeded) |
| `DEFAULT_REMOVE_REDUNDANT` | `true` | Remove CSS/JS/images/base64 by default |
| `DEFAULT_WAIT_AFTER_LOAD` | `1000` | Wait after page load for dynamic content (ms) |

## Tool: `web-url-fetch`

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | **Yes** | — | URL to fetch (must start with `http://` or `https://`) |
| `format` | string | No | `markdown` | Output format: `markdown`, `html`, `json` |
| `removeRedundant` | boolean | No | `true` | Strip images, CSS, JS, base64; preserve clickable links |
| `timeout` | number | No | `30000` | Navigation timeout (ms) |
| `maxBytes` | number | No | `500000` | Max response size in bytes |
| `waitAfterLoad` | number | No | `1000` | Wait for dynamic content after page load (ms) |

### Output Formats

**markdown** (default) — Clean Markdown with clickable `[text](url)` links. All redundant content removed.

```markdown
# Page Title

> URL: https://example.com

Page content here with [preserved link](https://example.com/page).
```

**html** — Cleaned HTML with redundant tags/attributes stripped, links preserved.

```html
<!-- Title: Page Title | URL: https://example.com -->
<div><p>Content with <a href="https://example.com/page">preserved link</a></p></div>
```

**json** — Structured JSON with content and links array.

```json
{
  "title": "Page Title",
  "url": "https://example.com",
  "content": "Page content with [preserved link](https://example.com/page)",
  "links": [
    { "text": "preserved link", "href": "https://example.com/page" }
  ]
}
```

### What Gets Removed (removeRedundant=true)

| Category | Removed |
|----------|---------|
| JavaScript | `<script>` tags, all `on*` event attributes |
| CSS | `<style>` tags, `<link rel="stylesheet">`, inline `style` attributes |
| Images | `<img>`, `<picture>`, `<source>`, `<a>` links to image files |
| Media | `<video>`, `<audio>`, `<iframe>`, `<embed>`, `<object>` |
| Graphics | `<svg>`, `<canvas>` |
| Base64 | All elements with `data:` URI sources |
| Noise | `class`, ARIA, `tabindex`, `data-test*`, icon font chars |

**Preserved:** All clickable hyperlinks (`<a>` with http/https href), converted to `[text](url)` in Markdown.

## Development

```bash
npm install
npm run build
```

## License

MIT
