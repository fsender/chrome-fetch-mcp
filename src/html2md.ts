const SKIP_TAGS = new Set([
  "script", "style", "noscript", "link", "meta", "head",
  "img", "picture", "source", "svg", "canvas",
  "video", "audio", "iframe", "embed", "object", "applet",
  "map", "area", "track", "wbr",
]);

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico|tiff|tif|avif)(\?|#|$)/i;

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "aside", "header", "footer",
  "nav", "figure", "figcaption", "details", "summary", "fieldset", "form",
  "blockquote", "pre", "hr", "br", "table", "tr", "td", "th", "thead",
  "tbody", "tfoot", "caption", "colgroup", "col", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "address",
]);

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

interface Token {
  type: "open" | "close" | "selfclose" | "text";
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    if (html[i] === "<") {
      if (html[i + 1] === "!" && html[i + 2] === "-" && html[i + 3] === "-") {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (html[i + 1] === "!" || html[i + 1] === "?") {
        const end = html.indexOf(">", i + 2);
        i = end === -1 ? len : end + 1;
        continue;
      }

      i++;
      const isClose = html[i] === "/";
      if (isClose) i++;

      const mStart = i;
      while (i < len && /[\s>/]/.test(html[i]) === false) i++;
      const tag = html.slice(mStart, i).toLowerCase();
      if (!tag) { continue; }

      const attrs: Record<string, string> = {};
      while (i < len && html[i] !== ">" && html[i] !== "/") {
        while (i < len && /\s/.test(html[i])) i++;
        if (i >= len || html[i] === ">" || html[i] === "/") break;
        const aStart = i;
        while (i < len && /[\s=>/]/.test(html[i]) === false) i++;
        const aName = html.slice(aStart, i).toLowerCase();
        if (!aName) break;
        while (i < len && /\s/.test(html[i])) i++;
        if (i < len && html[i] === "=") {
          i++;
          while (i < len && /\s/.test(html[i])) i++;
          if (i < len && (html[i] === '"' || html[i] === "'")) {
            const q = html[i]; i++;
            const vStart = i;
            while (i < len && html[i] !== q) i++;
            attrs[aName] = decodeEntities(html.slice(vStart, i));
            if (i < len) i++;
          } else {
            const vStart = i;
            while (i < len && /[\s>]/.test(html[i]) === false) i++;
            attrs[aName] = decodeEntities(html.slice(vStart, i));
          }
        } else {
          attrs[aName] = "";
        }
      }

      let selfClose = false;
      if (i < len && html[i] === "/") { selfClose = true; i++; }
      if (i < len && html[i] === ">") i++;
      if (VOID_TAGS.has(tag)) selfClose = true;

      if (isClose) {
        tokens.push({ type: "close", tag });
      } else if (selfClose) {
        tokens.push({ type: "selfclose", tag, attrs });
      } else {
        tokens.push({ type: "open", tag, attrs });
      }
    } else {
      const tStart = i;
      while (i < len && html[i] !== "<") i++;
      const text = html.slice(tStart, i);
      if (text) tokens.push({ type: "text", text: decodeEntities(text) });
    }
  }

  return tokens;
}

function isDataUri(v: string): boolean {
  return v != null && v.startsWith("data:");
}

function hasDataUri(attrs: Record<string, string>): boolean {
  for (const k of ["src", "href", "data", "poster"]) {
    if (isDataUri(attrs[k] || "")) return true;
  }
  return false;
}

export class HtmlToMarkdown {
  convert(html: string): string {
    const tokens = tokenize(html);
    const out: string[] = [];
    const skipStack: string[] = [];
    let listDepth = 0;
    const listOrdered: boolean[] = [];
    const listCounters: number[] = [];
    let inAnchor = false;
    let anchorHref = "";
    let anchorTextStart = -1;
    let anchorTextBuf: string[] = [];
    const inPreStack: boolean[] = [];

    for (const tok of tokens) {
      if (tok.type === "text") {
        if (skipStack.length > 0) continue;
        let t = tok.text!;
        if (inPreStack.length > 0) {
          out.push(t);
        } else {
          t = t.replace(/[\t ]+/g, " ");
          if (inAnchor) {
            anchorTextBuf.push(t);
          } else {
            out.push(t);
          }
        }
        continue;
      }

      const tag = tok.tag!;

      if (tok.type === "open") {
        if (SKIP_TAGS.has(tag)) { skipStack.push(tag); continue; }
        if (tag === "script" || tag === "style") { skipStack.push(tag); continue; }
        if (skipStack.length > 0) continue;
        if (hasDataUri(tok.attrs || {})) { skipStack.push(tag); continue; }

        if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") {
          skipStack.push(tag); continue;
        }

        if (tag === "a") {
          const href = (tok.attrs && tok.attrs.href) || "";
          if (!href || isDataUri(href) || href.startsWith("javascript:") || IMAGE_EXT_RE.test(href)) {
            skipStack.push(tag); continue;
          }
          inAnchor = true;
          anchorHref = href;
          anchorTextBuf = [];
          anchorTextStart = out.length;
          continue;
        }

        if (tag === "pre") { out.push("\n\n```\n"); inPreStack.push(true); continue; }

        if (tag.match(/^h[1-6]$/)) {
          const level = parseInt(tag[1]);
          out.push("\n\n" + "#".repeat(level) + " ");
          continue;
        }
        if (tag === "p") { out.push("\n\n"); continue; }
        if (tag === "br") { out.push("\n"); continue; }
        if (tag === "hr") { out.push("\n\n---\n\n"); continue; }
        if (tag === "blockquote") { out.push("\n\n> "); continue; }

        if (tag === "ul" || tag === "ol") {
          listDepth++;
          listOrdered.push(tag === "ol");
          listCounters.push(1);
          out.push("\n\n");
          continue;
        }
        if (tag === "li") {
          const indent = "  ".repeat(Math.max(0, listDepth - 1));
          if (listOrdered[listOrdered.length - 1]) {
            out.push(`\n${indent}${listCounters[listCounters.length - 1]++}. `);
          } else {
            out.push(`\n${indent}- `);
          }
          continue;
        }

        if (tag === "code") {
          if (inPreStack.length > 0) continue;
          out.push("`");
          continue;
        }
        if (tag === "strong" || tag === "b") { out.push("**"); continue; }
        if (tag === "em" || tag === "i") { out.push("*"); continue; }
        if (tag === "del" || tag === "s") { out.push("~~"); continue; }

        if (tag === "table") { out.push("\n\n"); continue; }
        if (tag === "tr") { out.push("\n"); continue; }
        if (tag === "td" || tag === "th") { out.push(" "); continue; }
        if (tag === "thead" || tag === "tbody" || tag === "tfoot") continue;

        if (tag === "dl") { out.push("\n\n"); continue; }
        if (tag === "dt") { out.push("\n**"); continue; }
        if (tag === "dd") { out.push("**: "); continue; }

        if (BLOCK_TAGS.has(tag)) { out.push("\n\n"); continue; }
        continue;
      }

      if (tok.type === "selfclose") {
        if (skipStack.length > 0) continue;
        if (SKIP_TAGS.has(tag)) continue;
        if (tag === "br") { out.push("\n"); continue; }
        if (tag === "hr") { out.push("\n\n---\n\n"); continue; }
        if (tag === "img" || tag === "source" || tag === "track" || tag === "area") continue;
        continue;
      }

      if (tok.type === "close") {
        if (skipStack.length > 0 && skipStack[skipStack.length - 1] === tag) {
          skipStack.pop();
          continue;
        }
        if (skipStack.length > 0) continue;

        if (tag === "a" && inAnchor) {
          const linkText = anchorTextBuf.join("").replace(/[\uE000-\uF8FF\uF000-\uFFFF]/g, "").trim().replace(/\s+/g, " ");
          if (linkText) {
            out.push(`[${linkText}](${anchorHref})`);
          }
          inAnchor = false;
          anchorHref = "";
          anchorTextBuf = [];
          continue;
        }

        if (tag === "strong" || tag === "b") { out.push("**"); continue; }
        if (tag === "em" || tag === "i") { out.push("*"); continue; }
        if (tag === "del" || tag === "s") { out.push("~~"); continue; }
        if (tag === "code") {
          if (inPreStack.length > 0) continue;
          out.push("`");
          continue;
        }
        if (tag === "pre") { out.push("\n```"); inPreStack.pop(); continue; }
        if (tag === "dt") { out.push("**"); continue; }

        if (tag === "ul" || tag === "ol") {
          listDepth--;
          listOrdered.pop();
          listCounters.pop();
          out.push("\n\n");
          continue;
        }
        if (tag === "li") { continue; }

        if (tag === "p" || tag === "blockquote") { out.push("\n\n"); continue; }
        if (tag === "tr") { out.push("\n"); continue; }
        if (tag.match(/^h[1-6]$/)) { out.push("\n\n"); continue; }

        if (BLOCK_TAGS.has(tag)) { out.push("\n"); continue; }
        continue;
      }
    }

    return this.clean(out.join(""));
  }

  convertRaw(html: string): string {
    const tokens = tokenize(html);
    const out: string[] = [];
    const skipStack: string[] = [];

    for (const tok of tokens) {
      if (tok.type === "text") {
        if (skipStack.length > 0) continue;
        out.push(tok.text!);
        continue;
      }
      const tag = tok.tag!;
      if (tok.type === "open") {
        if (tag === "script" || tag === "style") { skipStack.push(tag); continue; }
        if (skipStack.length > 0) continue;
        continue;
      }
      if (tok.type === "selfclose") {
        if (skipStack.length > 0) continue;
        continue;
      }
      if (tok.type === "close") {
        if (skipStack.length > 0 && skipStack[skipStack.length - 1] === tag) {
          skipStack.pop(); continue;
        }
        if (skipStack.length > 0) continue;
        continue;
      }
    }

    return this.clean(out.join(""));
  }

  toCleanHtml(html: string): string {
    const tokens = tokenize(html);
    const out: string[] = [];
    const skipStack: string[] = [];
    const keepTags = new Set([
      "p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "table", "tr", "td", "th", "thead", "tbody", "tfoot",
      "blockquote", "pre", "code", "strong", "b", "em", "i", "del", "s",
      "br", "hr", "a", "section", "article", "main", "header", "footer",
      "nav", "aside", "dl", "dt", "dd", "figure", "figcaption",
    ]);

    for (const tok of tokens) {
      if (tok.type === "text") {
        if (skipStack.length > 0) continue;
        out.push(tok.text!);
        continue;
      }
      const tag = tok.tag!;

      if (tok.type === "open") {
        if (SKIP_TAGS.has(tag) && tag !== "a") { skipStack.push(tag); continue; }
        if (tag === "script" || tag === "style") { skipStack.push(tag); continue; }
        if (skipStack.length > 0) continue;
        if (hasDataUri(tok.attrs || {})) { skipStack.push(tag); continue; }

        if (tag === "a") {
          const href = (tok.attrs && tok.attrs.href) || "";
          if (!href || isDataUri(href) || href.startsWith("javascript:") || IMAGE_EXT_RE.test(href)) {
            skipStack.push(tag); continue;
          }
          out.push(`<a href="${href}">`);
          continue;
        }

        if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") {
          skipStack.push(tag); continue;
        }

        if (keepTags.has(tag)) { out.push(`<${tag}>`); }
        else { out.push(`<${tag}>`); }
        continue;
      }

      if (tok.type === "selfclose") {
        if (skipStack.length > 0) continue;
        if (SKIP_TAGS.has(tag)) continue;
        if (tag === "br") { out.push("<br>"); continue; }
        if (tag === "hr") { out.push("<hr>"); continue; }
        continue;
      }

      if (tok.type === "close") {
        if (skipStack.length > 0 && skipStack[skipStack.length - 1] === tag) {
          skipStack.pop(); continue;
        }
        if (skipStack.length > 0) continue;
        out.push(`</${tag}>`);
        continue;
      }
    }

    return out.join("");
  }

  private clean(md: string): string {
    return md
      .replace(/[\uE000-\uF8FF\uF000-\uFFFF]/g, "")
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (full, text, url) => {
        return text.trim() ? full : "";
      })
      .replace(/\*{3,}/g, "")
      .replace(/(?<!\w)\*{2}(?!\w)/g, "")
      .replace(/(?<!\w)~{2}(?!\w)/g, "")
      .replace(/`{2,}/g, "")
      .replace(/\n([ \t]*)- [ \t]*\n/g, "\n")
      .replace(/\n([ \t]*)\d+\. [ \t]*\n/g, "\n")
      .replace(/^[ \t]*- [ \t]*$/gm, "")
      .replace(/^[ \t]*\d+\. [ \t]*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^#+\s*$/gm, "")
      .replace(/\n{2,}(---)/g, "\n$1")
      .replace(/(---)\n{2,}/g, "$1\n")
      .replace(/\n{2,}(- |\d+\. )/g, "\n$1")
      .replace(/^[ \t]+$/gm, "")
      .replace(/(\|)\s{2,}(\|)/g, "$1 $2")
      .trim();
  }
}
