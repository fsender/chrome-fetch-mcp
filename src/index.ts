#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import CDP from "chrome-remote-interface";
import { HtmlToMarkdown } from "./html2md.js";

type Format = "html" | "json" | "markdown";

interface FetchConfig {
  chromePort: number;
  defaultFormat: Format;
  defaultTimeout: number;
  defaultMaxBytes: number;
  defaultRemoveRedundant: boolean;
  defaultWaitAfterLoad: number;
}

const CONFIG: FetchConfig = {
  chromePort: parseInt(process.env.CHROME_DEBUG_PORT || "9222", 10),
  defaultFormat: (process.env.DEFAULT_FORMAT || "markdown") as Format,
  defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || "30000", 10),
  defaultMaxBytes: parseInt(process.env.DEFAULT_MAX_BYTES || "500000", 10),
  defaultRemoveRedundant: process.env.DEFAULT_REMOVE_REDUNDANT !== "false",
  defaultWaitAfterLoad: parseInt(process.env.DEFAULT_WAIT_AFTER_LOAD || "1000", 10),
};

const converter = new HtmlToMarkdown();

const BROWSER_EXTRACT = `(() => {
  try {
    var title = document.title || '';
    var url = location.href;
    if (!document.body) return JSON.stringify({title:title, url:url, html:'', links:[]});
    var links = Array.from(document.querySelectorAll('a[href]'))
      .filter(function(a) { return a.href.startsWith('http://') || a.href.startsWith('https://'); })
      .map(function(a) { return {text: (a.textContent || '').trim().substring(0, 200), href: a.href}; })
      .filter(function(l) { return l.text; });
    var clone = document.body.cloneNode(true);
    var baseUrl = location.href;
    clone.querySelectorAll('a[href]').forEach(function(el) {
      var href = el.getAttribute('href') || '';
      if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('#') && !href.startsWith('data:') && !href.startsWith('javascript:')) {
        try { el.setAttribute('href', new URL(href, baseUrl).href); } catch(e) {}
      }
    });
    return JSON.stringify({title: title, url: url, html: clone.innerHTML, links: links});
  } catch(e) {
    return JSON.stringify({title:'', url:'', html:'', links:[], error: e.message});
  }
})()`;

const TOOL_DESCRIPTION = `Fetch web page content through local Chrome/Chromium browser, inheriting all cookies and login sessions. Markdown format output by default.

Config via env: CHROME_DEBUG_PORT, DEFAULT_FORMAT, DEFAULT_TIMEOUT, DEFAULT_MAX_BYTES, DEFAULT_REMOVE_REDUNDANT, DEFAULT_WAIT_AFTER_LOAD.`;

const server = new Server(
  { name: "chrome-fetch-mcp", version: "1.0.2" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "web-url-fetch",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: "object" as const,
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch content from (must start with http:// or https://)",
          },
          format: {
            type: "string",
            enum: ["html", "json", "markdown"],
            description:
              "Output format: markdown (default, clean & readable), html (structural), json (structured with links array)",
          },
          removeRedundant: {
            type: "boolean",
            description:
              "Remove images, base64, CSS, JS, and noise while preserving clickable hyperlinks (default: true)",
          },
          timeout: {
            type: "number",
            description: "Navigation timeout in milliseconds (default: 30000)",
          },
          maxBytes: {
            type: "number",
            description: "Maximum response size in bytes (default: 500000)",
          },
          waitAfterLoad: {
            type: "number",
            description:
              "Wait time in ms after page load for dynamic/async content rendering (default: 1000)",
          },
        },
        required: ["url"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "web-url-fetch") {
    return {
      content: [
        { type: "text" as const, text: `Error: Unknown tool '${request.params.name}'` },
      ],
      isError: true,
    };
  }

  const args = (request.params.arguments || {}) as Record<string, unknown>;
  const url = args.url as string | undefined;
  const format = ((args.format as string) || CONFIG.defaultFormat) as Format;
  const removeRedundant =
    args.removeRedundant !== undefined
      ? Boolean(args.removeRedundant)
      : CONFIG.defaultRemoveRedundant;
  const timeout = (args.timeout as number) || CONFIG.defaultTimeout;
  const maxBytes = (args.maxBytes as number) || CONFIG.defaultMaxBytes;
  const waitAfterLoad =
    (args.waitAfterLoad as number) || CONFIG.defaultWaitAfterLoad;

  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Invalid URL. Must start with http:// or https://. Got: ${url || "(empty)"}`,
        },
      ],
      isError: true,
    };
  }

  let targetId: string | null = null;
  let client: { close: () => Promise<void> } | null = null;

  try {
    let version: Record<string, string>;
    try {
      version = await CDP.Version({ port: CONFIG.chromePort });
    } catch {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Cannot connect to Chrome on port ${CONFIG.chromePort}. Make sure Chrome/Chromium is running with:\n  chromium --remote-debugging-port=${CONFIG.chromePort}`,
          },
        ],
        isError: true,
      };
    }

    let browserClient: { close: () => Promise<void> } | null = null;
    try {
      const wsUrl = version.webSocketDebuggerUrl;
      if (wsUrl) {
        browserClient = await CDP({ target: wsUrl });
        const { Target: TargetDomain } = browserClient as any;
        const result = await TargetDomain.createTarget({
          url: "about:blank",
          background: true,
        });
        targetId = result.targetId;
        await (browserClient as any).close();
        browserClient = null;
      }
    } catch {
      try { if (browserClient) await browserClient.close(); } catch {}
    }

    if (!targetId) {
      const fallback = await CDP.New({ port: CONFIG.chromePort, url: "about:blank" });
      targetId = fallback.id;
    }

    const targets = await CDP.List({ port: CONFIG.chromePort });
    const pageTarget = targets.find((t: any) => t.id === targetId);
    client = await CDP({ target: pageTarget || targetId, port: CONFIG.chromePort });
    const { Page, Runtime } = client as any;

    await Page.enable();
    await Runtime.enable();

    const loadPromise = new Promise<void>((resolve) => {
      Page.loadEventFired(() => {
        resolve();
      });
    });

    await Page.navigate({ url });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Navigation timeout after ${timeout}ms`)),
        timeout
      );
    });
    await Promise.race([loadPromise, timeoutPromise]);

    await new Promise((r) => setTimeout(r, waitAfterLoad));

    const evalResult = await Runtime.evaluate({
      expression: BROWSER_EXTRACT,
      returnByValue: true,
      awaitPromise: false,
    });

    if (evalResult.exceptionDetails) {
      const exc = evalResult.exceptionDetails;
      const errMsg =
        exc.text || exc.exception?.description || "Script execution failed";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Failed to extract page content: ${errMsg}`,
          },
        ],
        isError: true,
      };
    }

    const rawData = JSON.parse(evalResult.result.value as string);
    const { title, url: finalUrl, html, links, error: extractError } = rawData;

    if (extractError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Content extraction failed in browser: ${extractError}`,
          },
        ],
        isError: true,
      };
    }

    let output: string;

    if (format === "html") {
      output = removeRedundant
        ? converter.toCleanHtml(html || "")
        : html || "";
      output = `<!-- Title: ${title} | URL: ${finalUrl} -->\n${output}`;
    } else if (format === "json") {
      const markdown = removeRedundant
        ? converter.convert(html || "")
        : converter.convertRaw(html || "");
      output = JSON.stringify(
        {
          title,
          url: finalUrl,
          content: markdown,
          links: deduplicateLinks(links).slice(0, 200),
        },
        null,
        2
      );
    } else {
      const markdown = removeRedundant
        ? converter.convert(html || "")
        : converter.convertRaw(html || "");
      output = `# ${title}\n\n> URL: ${finalUrl}\n\n${markdown}`;
    }

    if (Buffer.byteLength(output, "utf-8") > maxBytes) {
      const truncated = Buffer.from(output, "utf-8").slice(0, maxBytes).toString("utf-8");
      output =
        truncated +
        `\n\n... [Content truncated at ${maxBytes} bytes. Total size: ${Buffer.byteLength(output, "utf-8")} bytes]`;
    }

    return {
      content: [{ type: "text", text: output }],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error fetching ${url}: ${error.message || "Unknown error"}`,
        },
      ],
      isError: true,
    };
  } finally {
    try {
      if (client) await client.close();
    } catch {}
    try {
      if (targetId) await CDP.Close({ id: targetId, port: CONFIG.chromePort });
    } catch {}
  }
});

function deduplicateLinks(
  links: Array<{ text: string; href: string }>
): Array<{ text: string; href: string }> {
  const seen = new Set<string>();
  return links.filter((l) => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("chrome-fetch-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
