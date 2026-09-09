#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
  defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || "15000", 10),
  defaultMaxBytes: parseInt(process.env.DEFAULT_MAX_BYTES || "500000", 10),
  defaultRemoveRedundant: process.env.DEFAULT_REMOVE_REDUNDANT !== "false",
  defaultWaitAfterLoad: parseInt(process.env.DEFAULT_WAIT_AFTER_LOAD || "1000", 10),
};

const converter = new HtmlToMarkdown();

function buildExtractScript(opts: {
  clean: boolean;
  fullPage: boolean;
  keepImageLinks: boolean;
  reddit?: boolean;
}): string {
  const { clean, fullPage, keepImageLinks, reddit } = opts;
  return `(() => {
  var CLEAN = ${clean ? 1 : 0};
  var FULL_PAGE = ${fullPage ? 1 : 0};
  var KEEP_IMG = ${keepImageLinks ? 1 : 0};
  var REDDIT = ${reddit ? 1 : 0};
  var baseUrl = location.href;

  function removeSel(root, sel) {
    var ls = root.querySelectorAll(sel);
    for (var i = ls.length - 1; i >= 0; i--) {
      var el = ls[i];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }
  function absUrl(h) {
    try { return new URL(h, baseUrl).href; } catch (e) { return ''; }
  }
  function textNorm(s) {
    return (s || '').replace(/[\\uE000-\\uF8FF\\uF000-\\uFFFF]/g, '').replace(/\\s+/g, ' ').trim();
  }
  function elText(el) {
    return textNorm(el.textContent);
  }
  var TRACK = {};
  var trkNames = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
    'fbclid','gclid','msclkid','mc_cid','mc_eid','igshid','dclid','gbraid','wbraid','yclid',
    '_hsenc','_hsmi','mkt_tok','epik','spm','spm_id_from','scm',
    'tn','rsv_idx','rsv_dl','rsv_sug','rsv_bp','rsv_spt','hisfilter','fr','from','cl','sa',
    'pd','setype','isShowHello','extParams','refer','ref','track',
    'form','oq','aqs','ved','ei','gs_l','sclient','sgt','ocid','msclkidid','as_src','as_eq'];
  for (var z = 0; z < trkNames.length; z++) TRACK[trkNames[z]] = 1;
  function stripTracking(u) {
    try {
      var x = new URL(u);
      var dels = [];
      x.searchParams.forEach(function (v, k) {
        var lk = k.toLowerCase();
        if (TRACK[lk] || /^utm_/.test(lk)) dels.push(k);
      });
      for (var i = 0; i < dels.length; i++) x.searchParams.delete(dels[i]);
      x.search = x.search;
      return x.href;
    } catch (e) { return u; }
  }
  function normalizeLinks(root) {
    var as = root.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      var h = a.getAttribute('href') || '';
      if (!h || h.charAt(0) === '#') { a.removeAttribute('href'); continue; }
      var abs = absUrl(h);
      if (!abs || /^(data|javascript|mailto|tel):/i.test(abs)) { a.removeAttribute('href'); continue; }
      a.setAttribute('href', stripTracking(abs));
    }
  }
  function dropUrlTextAnchors(root) {
    var as = root.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (!a.parentNode) continue;
      var h = a.getAttribute('href') || '';
      var t = elText(a);
      if (!t) { if (a.parentNode) a.parentNode.removeChild(a); continue; }
      if (t === h || (/^https?:\\/\\//i.test(t) && h.indexOf(t) !== -1) || (/^https?:\\/\\//i.test(t) && t.length < 120 && t === h.replace(/\\/$/, ''))) {
        if (a.parentNode) a.parentNode.removeChild(a);
      }
    }
  }
  function dedupeAnchors(root) {
    var seen = {};
    var as = root.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (!a.parentNode) continue;
      var h = a.getAttribute('href') || '';
      if (!h) continue;
      var t = elText(a);
      if (!t) { if (a.parentNode) a.parentNode.removeChild(a); continue; }
      if (seen[h]) {
        if (seen[h] === t) {
          if (a.parentNode) a.parentNode.removeChild(a);
        } else {
          var parent = a.parentNode;
          while (a.firstChild) parent.insertBefore(a.firstChild, a);
          parent.removeChild(a);
        }
      } else {
        seen[h] = t;
      }
    }
  }
  function dropSelfTabLinks(root) {
    var cur = location.href;
    var curQ = '';
    try { curQ = new URL(cur).searchParams.get('q') || ''; } catch (e) {}
    if (!curQ) return;
    var as = root.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (!a.parentNode) continue;
      var t = elText(a);
      if (!t || t.length > 30) continue;
      var h = a.getAttribute('href') || '';
      try {
        var u = new URL(h, baseUrl);
        var sameSite = u.origin === new URL(cur, baseUrl).origin;
        var sameQ = (u.searchParams.get('q') || '') === curQ;
        var qp = u.searchParams.get('wd');
        var sameW = qp && qp === curQ;
        if (sameSite && (sameQ || sameW)) {
          if (a.parentNode) a.parentNode.removeChild(a);
        }
      } catch (e) {}
    }
  }
  function pruneEmpty(root) {
    var guard = 0;
    while (guard++ < 40) {
      var changed = false;
      var els = root.querySelectorAll('div,section,article,li,ul,ol,td,th,tr,table,p,span,a,figure,figcaption,h1,h2,h3,h4,h5,h6,dl,dt,dd,blockquote,main');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.parentNode || el === root) continue;
        var t = (el.textContent || '').replace(/[\\uE000-\\uF8FF\\uF000-\\uFFFF\\s]/g, '');
        if (t) continue;
        if (el.querySelector('br')) continue;
        el.parentNode.removeChild(el);
        changed = true;
      }
      if (!changed) break;
    }
  }
  function hasToken(el, list) {
    var id = (el.id || '').toLowerCase();
    var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    var parts = cls.split(/[^a-z0-9]+/);
    for (var i = 0; i < list.length; i++) {
      var tk = list[i];
      if (id === tk) return true;
      for (var j = 0; j < parts.length; j++) if (parts[j] === tk) return true;
    }
    return false;
  }
  var HARD_NOISE = ['cookie','consent','banner','advert','ads','ad','advertisement','adsbygoogle',
    'breadcrumb','crumb','copyright','icp','beian','license','licence','footer','header','nav',
    'menu','toolbar','login','register','signin','signup','qrcode','backtop','scrolltop','gotop',
    'friendlink','friend-link','pagination','pager','sidebar','modal','popup','overlay','toast',
    'float','fixed','searchbox','search-bar','share','social'];
  var SOFT_NOISE = ['related','recommend','recommendation','widget'];
  var BOILER_RE = /(ICP证|ICP备|公网安备|Copyright\\s*©|©\\s*\\d{4}|All Rights Reserved|网络文化经营许可|信息网络传播视听|互联网宗教信息|增值电信业务|\\d{2,}许可证|备字[0-9]{4})/i;
  function removeChrome(root) {
    var total = (root.textContent || '').replace(/\\s+/g, '').length;
    var els = root.querySelectorAll('div,section,header,footer,nav,aside,ul,table,form,main,article,dl,address');
    var doomed = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.parentNode || el === root) continue;
      var raw = el.textContent || '';
      var t = raw.replace(/\\s+/g, '').length;
      if (!t) continue;
      var text = raw.replace(/\\s+/g, ' ').trim();
      var isSoft = hasToken(el, SOFT_NOISE);
      var isHard = hasToken(el, HARD_NOISE);
      var isBoiler = BOILER_RE.test(text);
      var maxSafe = Math.min(4000, Math.max(1200, total * 0.4));
      if (isSoft && t < total * 0.5) { doomed.push(el); continue; }
      if ((isHard || isBoiler) && t <= maxSafe) { doomed.push(el); continue; }
    }
    for (var j = 0; j < doomed.length; j++) {
      var d = doomed[j];
      if (d.parentNode) d.parentNode.removeChild(d);
    }
  }
  function findMain(body) {
    var total = (body.textContent || '').replace(/\\s+/g, '').length;
    if (total < 200) return body;
    var strongSel = 'main,article,[role="main"],#main,#content,#js_content,#doc-content,#article,#content_left,#content_right,#pagelet_search-result,#content_l,#rso,#search,#b_results,#links';
    var STRONG_CLS = ['main-content','content-main','article-content','article_body','rich_media_content',
      'js_content','entry-content','post-content','page-content','content-body','article-body',
      'post-body','doc-content','news-content','detail-content','chapter-content'];
    var cand = [];
    body.querySelectorAll(strongSel).forEach(function (el) { cand.push(el); });
    body.querySelectorAll('div,section').forEach(function (el) {
      var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase().split(/[^a-z0-9]+/);
      for (var i = 0; i < STRONG_CLS.length; i++) {
        if (cls.indexOf(STRONG_CLS[i]) !== -1) { cand.push(el); break; }
      }
    });
    var strong = [];
    for (var c = 0; c < cand.length; c++) {
      var candEl = cand[c];
      if (!candEl.parentNode) continue;
      var t = (candEl.textContent || '').replace(/\\s+/g, '').length;
      if (t < 300) continue;
      var nested = false;
      for (var d = 0; d < cand.length; d++) {
        if (cand[d] !== candEl && cand[d].contains(candEl)) { nested = true; break; }
      }
      if (nested) continue;
      strong.push({ el: candEl, t: t });
    }
    var bestStrong = null;
    for (var s = 0; s < strong.length; s++) {
      if (!bestStrong || strong[s].t > bestStrong.t) bestStrong = strong[s];
    }
    if (bestStrong && bestStrong.t >= total * 0.4) return bestStrong.el;
    var best = null, bestScore = 0;
    var divs = body.querySelectorAll('div,section');
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      if (!el.parentNode) continue;
      var t = (el.textContent || '').replace(/\\s+/g, '').length;
      if (t < 400) continue;
      var paras = el.querySelectorAll('p').length;
      var links = el.querySelectorAll('a').length;
      var score = t + Math.min(paras * 80, 800);
      var density = links / Math.max(1, t / 60);
      if (density > 0.6) score *= 0.4;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (best && bestScore >= total * 0.6) return best;
    return body;
  }
  function imgToLink(el) {
    var u = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original') || el.getAttribute('data-lazy-src') || el.getAttribute('data-url') || '';
    if (!u && el.currentSrc) u = el.currentSrc;
    if (!u) {
      var s = el.getAttribute('srcset');
      if (s) u = s.split(',')[0].trim().split(/\\s+/)[0] || '';
    }
    if (u && !/^data:/i.test(u)) {
      var abs = absUrl(u);
      if (abs && !/^data:/i.test(abs)) {
        var a = document.createElement('a');
        a.setAttribute('href', stripTracking(abs));
        var alt = (el.getAttribute('alt') || '').trim().substring(0, 120);
        a.textContent = alt ? ('Image: ' + alt) : 'Image';
        if (el.parentNode) el.parentNode.replaceChild(a, el);
        return;
      }
    }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  function removeAttrs(root) {
    var all = root.querySelectorAll('*');
    var drop = ['id','class','style','role','align','width','height','border','cellpadding',
      'cellspacing','bgcolor','valign','tabindex','title','target','rel','onclick','onload',
      'onerror','onmouseover','onmouseout','onfocus','onblur','aria-label','aria-hidden',
      'aria-expanded','aria-haspopup','data-testid','data-test','data-cy'];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      for (var j = 0; j < drop.length; j++) {
        if (el.hasAttribute(drop[j])) el.removeAttribute(drop[j]);
      }
      if (el.tagName === 'A') {
        var names = [];
        for (var k = 0; k < el.attributes.length; k++) names.push(el.attributes[k].name);
        for (var n = 0; n < names.length; n++) {
          if (names[n] !== 'href') el.removeAttribute(names[n]);
        }
      }
    }
  }
  function deepClone(n) {
    var c = n.cloneNode(false);
    if (n.shadowRoot && n.shadowRoot.mode === 'open') {
      var kids = [];
      for (var i = 0; i < n.childNodes.length; i++) kids.push(n.childNodes[i]);
      for (var s = 0; s < n.shadowRoot.childNodes.length; s++) kids.push(n.shadowRoot.childNodes[s]);
      for (var a = 0; a < kids.length; a++) c.appendChild(deepClone(kids[a]));
    } else {
      for (var b = 0; b < n.childNodes.length; b++) c.appendChild(deepClone(n.childNodes[b]));
    }
    return c;
  }

  try {
    var title = document.title || '';
    var url = location.href;
    var docEl = document.documentElement ? deepClone(document.documentElement) : null;
    if (!docEl) return JSON.stringify({ title: title, url: url, html: '', links: [] });
    var body = docEl.querySelector('body') || docEl;
    if (!body) return JSON.stringify({ title: title, url: url, html: '', links: [] });

    if (!CLEAN) {
      normalizeLinks(body);
      var anchors = body.querySelectorAll('a[href]');
      var linksRaw = [];
      for (var i = 0; i < anchors.length; i++) {
        var tt = elText(anchors[i]);
        if (tt) linksRaw.push({ text: tt.substring(0, 200), href: anchors[i].getAttribute('href') });
      }
      return JSON.stringify({ title: title, url: url, html: body.innerHTML, links: linksRaw });
    }

    removeSel(body, 'script,style,noscript,link,meta,title,base,template');
    removeSel(body, 'svg,canvas,video,audio,iframe,embed,object,applet,map,area,track,form,button,input,select,textarea');

    var pics = body.querySelectorAll('picture');
    for (var p = pics.length - 1; p >= 0; p--) {
      var pic = pics[p];
      if (!pic.parentNode) continue;
      var parent = pic.parentNode;
      while (pic.firstChild) parent.insertBefore(pic.firstChild, pic);
      parent.removeChild(pic);
    }
    removeSel(body, 'picture,source');

    if (KEEP_IMG) {
      var imgs = body.querySelectorAll('img');
      for (var g = imgs.length - 1; g >= 0; g--) {
        if (imgs[g].parentNode) imgToLink(imgs[g]);
      }
    } else {
      removeSel(body, 'img');
    }

    if (!FULL_PAGE) {
      removeSel(body, 'header,footer,nav,aside');
      removeChrome(body);
    }

    pruneEmpty(body);
    normalizeLinks(body);
    dropSelfTabLinks(body);
    dropUrlTextAnchors(body);
    dedupeAnchors(body);
    pruneEmpty(body);

    var main;
    if (REDDIT && !FULL_PAGE) {
      var isComments = location.pathname.indexOf('/comments/') !== -1;
      var isSearch = location.pathname.indexOf('/search') !== -1;
      var isOldHost = location.hostname.indexOf('old.reddit.com') === 0;
      if (isSearch && !isOldHost) {
        var sw = body.ownerDocument.createElement('div');
        var seenS = {};
        var asS = body.querySelectorAll('a[href*="/comments/"]');
        for (var s1 = 0; s1 < asS.length; s1++) {
          var aa = asS[s1];
          var hrefS = aa.getAttribute('href') || '';
          if (!hrefS || seenS[hrefS]) continue;
          seenS[hrefS] = 1;
          var titleS = elText(aa);
          if (!titleS) {
            var hd = aa.closest('h1,h2,h3,h4');
            if (hd) titleS = elText(hd);
          }
          if (!titleS || titleS.length < 6 || titleS.length > 300) continue;
          var seg = body.ownerDocument.createElement('p');
          var ln = body.ownerDocument.createElement('a');
          ln.setAttribute('href', hrefS);
          ln.textContent = titleS;
          seg.appendChild(ln);
          var card = aa;
          for (var up = 0; up < 6 && card && card !== body; up++) {
            card = card.parentElement;
            if (!card) break;
            var px = card.querySelectorAll('p');
            var sn2 = '';
            for (var q2 = 0; q2 < px.length; q2++) {
              var tx2 = elText(px[q2]);
              if (tx2.length >= 20 && tx2 !== titleS && tx2.indexOf('/comments/') === -1) { sn2 = tx2; break; }
            }
            if (sn2) {
              var brk = body.ownerDocument.createElement('br');
              seg.appendChild(brk);
              seg.appendChild(body.ownerDocument.createTextNode(sn2.substring(0, 260)));
              break;
            }
          }
          sw.appendChild(seg);
        }
        main = sw.childNodes.length ? sw : body;
      } else {
        main = isComments ? body : findMain(body);
      }
    } else {
      main = (!FULL_PAGE) ? findMain(body) : body;
    }
    var outRoot = main && main.parentNode ? main : body;

    removeAttrs(outRoot);
    var html = outRoot.innerHTML;

    var as = outRoot.querySelectorAll('a[href]');
    var links = [];
    for (var a = 0; a < as.length; a++) {
      var at = elText(as[a]);
      if (at) links.push({ text: at.substring(0, 200), href: as[a].getAttribute('href') });
    }
    return JSON.stringify({ title: title, url: url, html: html, links: links });
  } catch (e) {
    return JSON.stringify({ title: '', url: '', html: '', links: [], error: e.message });
  }
})()`;
}

async function runScript(
  url: string,
  script: string,
  opts: { timeout?: number; waitAfterLoad?: number; foreground?: boolean } = {}
): Promise<string> {
  const timeout = opts.timeout || CONFIG.defaultTimeout;
  const waitAfterLoad = opts.waitAfterLoad || CONFIG.defaultWaitAfterLoad;
  let targetId: string | null = null;
  let client: { close: () => Promise<void> } | null = null;
  try {
    let version: Record<string, string>;
    try {
      version = await CDP.Version({ port: CONFIG.chromePort });
    } catch {
      throw new Error(
        `Cannot connect to Chrome on port ${CONFIG.chromePort}. Make sure Chrome/Chromium is running with:\n  chromium --remote-debugging-port=${CONFIG.chromePort}`
      );
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
      Page.loadEventFired(() => resolve());
    });
    await Page.navigate({ url });
    if (opts.foreground) {
      try { await Page.bringToFront(); } catch {}
    }
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Navigation timeout after ${timeout}ms`)), timeout);
    });
    await Promise.race([loadPromise, timeoutPromise]);
    await new Promise((r) => setTimeout(r, waitAfterLoad));

    const evalResult = await Runtime.evaluate({
      expression: script,
      returnByValue: true,
      awaitPromise: false,
    });
    if (evalResult.exceptionDetails) {
      const exc = evalResult.exceptionDetails;
      throw new Error(
        exc.exception?.description || exc.text || "Script execution failed in page"
      );
    }
    return String(evalResult.result.value);
  } finally {
    try { if (client) await client.close(); } catch {}
    try { if (targetId) await CDP.Close({ id: targetId, port: CONFIG.chromePort }); } catch {}
  }
}

const SEARCH_ENGINES = [
  "google",
  "bing",
  "duckduckgo",
  "wikipedia",
  "wikidata",
  "reddit",
] as const;
type SearchEngine = (typeof SEARCH_ENGINES)[number];

function searchUrl(engine: SearchEngine, query: string, page: number): string {
  const q = encodeURIComponent(query);
  const p = Math.max(1, page);
  switch (engine) {
    case "google":
      return `https://www.google.com/search?q=${q}&num=10&start=${(p - 1) * 10}`;
    case "bing":
      return `https://www.bing.com/search?q=${q}&count=10&first=${(p - 1) * 10 + 1}`;
    case "duckduckgo":
      return `https://html.duckduckgo.com/html/?q=${q}&s=${(p - 1) * 30}`;
    case "wikipedia":
      return `https://en.wikipedia.org/w/index.php?search=${q}&fulltext=1&limit=20&offset=${(p - 1) * 20}`;
    case "wikidata":
      return `https://www.wikidata.org/w/index.php?search=${q}&fulltext=1&uselang=en&limit=20&offset=${(p - 1) * 20}`;
    case "reddit":
      return `https://old.reddit.com/search?q=${q}`;
  }
}

function buildSearchParseScript(engine: SearchEngine): string {
  return `(() => {
    var ENGINE = ${JSON.stringify(engine)};
    function clean(s) { return (s || '').replace(/[\\uE000-\\uF8FF\\uF000-\\uFFFF]/g, '').replace(/\\s+/g, ' ').trim(); }
    var TRK = {};
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','fbclid','gclid','msclkid','mc_cid','mc_eid','igshid','ved','ei','oq','aqs','sclient','gs_l','form','sxsrf','sca_esv','cshid','source','as_src','ntc','ictx'].forEach(function (k) { TRK[k.toLowerCase()] = 1; });
    function norm(u) {
      try {
        var x = new URL(u, location.href);
        var dels = [];
        x.searchParams.forEach(function (v, k) { var lk = k.toLowerCase(); if (TRK[lk] || /^utm_/.test(lk)) dels.push(k); });
        dels.forEach(function (k) { x.searchParams.delete(k); });
        return x.href;
      } catch (e) { return u; }
    }
    var results = [];
    var seen = {};
    function isAd(el) {
      if (!el || !el.className) return false;
      var c = String(el.className);
      return /(^|[\\s_-])(ad|ads|advert|advertise|sponsored|promoted|commercial)([\\s_-]|$)/i.test(c);
    }
    function add(title, url, snip, container) {
      if (container && isAd(container)) return;
      title = clean(title); url = norm(url); snip = clean(snip);
      if (!title || !url) return;
      if (title.length < 5 || title.length > 300) return;
      if (/^https?:\\/\\//i.test(title) && title === url) return;
      if (/^data:/i.test(url) || /googleusercontent|^blob:/i.test(url)) return;
      var key = title + '|' + url;
      if (seen[key]) return;
      seen[key] = 1;
      for (var i = 0; i < results.length; i++) if (results[i].url === url) return;
      results.push({ title: title, url: url, snippet: snip.substring(0, 300) });
    }
    if (ENGINE === 'google') {
      var heads = document.querySelectorAll('a h3');
      for (var i = 0; i < heads.length; i++) {
        var h3 = heads[i];
        var a = h3.closest ? h3.closest('a[href]') : null;
        if (!a || !a.parentNode) continue;
        if (a.closest('header,footer,nav,aside,form')) continue;
        var title = clean(h3.textContent);
        var href = a.getAttribute('href') || '';
        if (!/^https?:\\/\\//i.test(href)) continue;
        var cell = a.closest('[data-hveid],[jsname],[jscontroller],.g') || a.parentElement;
        if (isAd(cell) || isAd(a)) continue;
        var snip = '';
        if (cell) {
          var ps = cell.querySelectorAll('p, div, span');
          var best = '';
          for (var p = 0; p < ps.length; p++) {
            var tx = clean(ps[p].textContent);
            if (tx.length < 25) continue;
            if (tx.indexOf(title) === 0 || tx === title) continue;
            if (ps[p].querySelector('h3') || ps[p].querySelector('a')) continue;
            if (tx.length > best.length) best = tx;
          }
          snip = best;
        }
        add(title, href, snip, cell);
      }
    } else if (ENGINE === 'bing') {
      var lis = document.querySelectorAll('#b_results > li.b_algo, li.b_algo');
      for (var j = 0; j < lis.length; j++) {
        var li = lis[j];
        if (isAd(li)) continue;
        var a2 = li.querySelector('h2 a');
        if (!a2) continue;
        var t2 = clean(a2.textContent);
        var u2 = a2.getAttribute('href') || '';
        var s2 = '';
        var cps = li.querySelectorAll('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, .b_snippet');
        if (cps.length) s2 = clean(cps[0].textContent);
        add(t2, u2, s2, li);
      }
    } else if (ENGINE === 'duckduckgo') {
      var ddgA = document.querySelectorAll('.result__a, .result-link, a.result-link, .results .result a');
      var seenD = {};
      for (var dg = 0; dg < ddgA.length; dg++) {
        var ad = ddgA[dg];
        var ud = ad.getAttribute('href') || '';
        if (!ud || seenD[ud]) continue;
        seenD[ud] = 1;
        var box = ad.closest('.result') || ad.parentElement;
        if (!box) continue;
        var td = clean(ad.textContent);
        var sde = '';
        var spd = box.querySelector('.result__snippet, .result-snippet, .result__snippet');
        if (spd) sde = clean(spd.textContent);
        add(td, ud, sde, box);
      }
    } else if (ENGINE === 'wikipedia' || ENGINE === 'wikidata') {
      var rows = document.querySelectorAll('ul.mw-search-results > li');
      for (var w = 0; w < rows.length; w++) {
        var row = rows[w];
        if (isAd(row)) continue;
        var head = row.querySelector('.mw-search-result-heading a, a');
        if (!head) continue;
        var t4 = clean(head.textContent);
        var u4 = head.getAttribute('href') || '';
        var s4 = '';
        var sn = row.querySelector('.searchresult, .mw-search-result-content');
        if (sn) s4 = clean(sn.textContent);
        add(t4, u4, s4, row);
      }
    } else if (ENGINE === 'reddit') {
      var seenR = {};
      function grabOne(container) {
        var titleA = container.querySelector('.search-result-header a, a.title');
        if (!titleA) return;
        var href = titleA.getAttribute('href') || '';
        if (!href || href.indexOf('/comments/') === -1) return;
        if (seenR[href]) return;
        seenR[href] = 1;
        var t = clean(titleA.textContent);
        var s = '';
        var snip = container.querySelector('.search-result-body, .search-result-snippet');
        if (!snip) {
          var ps2 = container.querySelectorAll('.expando .md p, .md p');
          for (var x = 0; x < ps2.length && !s; x++) { var px2 = clean(ps2[x].textContent); if (px2.length > 15) s = px2; }
        } else { s = clean(snip.textContent); }
        add(t, href, s || '', container);
      }
      var cnts = document.querySelectorAll('.search-result, .search-result-container');
      var hasCompact = false;
      for (var c1 = 0; c1 < cnts.length; c1++) { if (cnts[c1].querySelector('.search-result-header a')) hasCompact = true; grabOne(cnts[c1]); }
      if (!hasCompact) {
        var things = document.querySelectorAll('.thing.link, div.thing');
        for (var c2 = 0; c2 < things.length; c2++) grabOne(things[c2]);
      }
    }
    return JSON.stringify({ results: results });
  })()`;
}

const TOOL_DESCRIPTION = `Fetch web page content via Chrome browser, inheriting all cookies and bypass bot detection.

Defaults: focuses on main body content (removed header and footer), strips tracking params from URLs, dedupes repeated links, and drops images/media by default. fullPage=true converts the entire page, including header, footer, URL, etc..

Config via env: CHROME_DEBUG_PORT, DEFAULT_FORMAT, DEFAULT_TIMEOUT, DEFAULT_MAX_BYTES, DEFAULT_REMOVE_REDUNDANT, DEFAULT_WAIT_AFTER_LOAD.`;

const SEARCH_TOOL_DESCRIPTION = `Search the web through browser and return structured organic results.

This tool is read-only and only return each result's title, snippet and target URL.

Pass the query as plain natural-language text. **Don't percent-encode it**.

Supported engines: google (default), bing, duckduckgo, wikipedia, wikidata and reddit.

Parameters: query (plain text), engine (optional), page (optional, 1-based; 2 opens the next results page via each engine's start/first/s/offset; reddit returns one results page).

Returns JSON: {"engine", "query", "page", "results": [{"title", "url", "snippet"}, ...]}. Use it to find candidate links, then open the most relevant ones with web-url-fetch.`;

const server = new Server(
  { name: "chrome-fetch-mcp", version: "1.2.2" },
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
              "Master switch for content cleaning. false returns near-raw text (default: true)",
          },
          fullPage: {
            type: "boolean",
            description:
              "When true, convert the entire page to markdown instead of focusing on main content (default: false)",
          },
          keepImageLinks: {
            type: "boolean",
            description:
              "When true, keep images/videos as clickable links instead of dropping them (default: false)",
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
    {
      name: "web-search",
      description: SEARCH_TOOL_DESCRIPTION,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Plain natural-language search query. Do NOT URL-encode it (server encodes automatically)",
          },
          engine: {
            type: "string",
            enum: ["google", "bing", "duckduckgo", "wikipedia", "wikidata", "reddit"],
            description:
              "Search engine: google (default), bing, duckduckgo, wikipedia, wikidata, reddit. wikipedia/wikidata return English results by default; reddit searches reddit via old.reddit.com; other engines follow the browser's language",
          },
          page: {
            type: "number",
            description:
              "Results page number starting at 1 (default 1). 2 = next page of results",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments || {}) as Record<string, unknown>;
  try {
    if (name === "web-url-fetch") return await handleFetch(args);
    if (name === "web-search") return await handleSearch(args);
    return {
      content: [{ type: "text" as const, text: `Error: Unknown tool '${name}'` }],
      isError: true,
    };
  } catch (error: any) {
    return {
      content: [
        { type: "text" as const, text: `Error: ${error.message || "Unknown error"}` },
      ],
      isError: true,
    };
  }
});

interface SearchItem {
  title: string;
  url: string;
  snippet: string;
}

async function handleFetch(args: Record<string, unknown>): Promise<CallToolResult> {
  const url = args.url as string | undefined;
  const format = ((args.format as string) || CONFIG.defaultFormat) as Format;
  const removeRedundant =
    args.removeRedundant !== undefined
      ? Boolean(args.removeRedundant)
      : CONFIG.defaultRemoveRedundant;
  const fullPage = Boolean(args.fullPage);
  const keepImageLinks = Boolean(args.keepImageLinks);
  const timeout = (args.timeout as number) || CONFIG.defaultTimeout;
  const maxBytes = (args.maxBytes as number) || CONFIG.defaultMaxBytes;
  const waitAfterLoad =
    (args.waitAfterLoad as number) || CONFIG.defaultWaitAfterLoad;

  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid URL. Must start with http:// or https://. Got: ${url || "(empty)"}`,
        },
      ],
      isError: true,
    };
  }

  const reddit = /(^|\.)reddit\.com$/i.test(new URL(url).hostname);
  const redditSearch = reddit && new URL(url).pathname.indexOf("/search") !== -1;
  const redditWait = reddit ? Math.max(waitAfterLoad, 2500) : waitAfterLoad;
  const isOldUrl = url.includes("old.reddit.com");

  let targetUrl = url;
  if (redditSearch && !isOldUrl) {
    targetUrl = url.replace(/https?:\/\/(www\.|new\.)?reddit\.com/i, "https://old.reddit.com");
  }

  const script = buildExtractScript({
    clean: removeRedundant,
    fullPage,
    keepImageLinks,
    reddit,
  });
  let value = await runScript(targetUrl, script, {
    timeout,
    waitAfterLoad: redditWait,
  });
  let rawData = JSON.parse(value);

  if (
    reddit &&
    !fullPage &&
    new URL(url).pathname.indexOf("/comments/") !== -1 &&
    !isOldUrl
  ) {
    const htmlLen = String(rawData.html || "").length;
    const text = String(rawData.html || "").toLowerCase();
    const looksEmpty =
      htmlLen < 600 ||
      text.indexOf("couldn't load") !== -1 ||
      text.indexOf("sorry, we couldn") !== -1;
    if (looksEmpty) {
      const oldUrl = url.replace(
        /https?:\/\/(www\.|new\.|old\.)?reddit\.com/i,
        "https://old.reddit.com"
      );
      if (oldUrl !== targetUrl) {
        value = await runScript(oldUrl, script, {
          timeout,
          waitAfterLoad: waitAfterLoad || CONFIG.defaultWaitAfterLoad,
        });
        rawData = JSON.parse(value);
      }
    }
  }
  const { title, url: finalUrl, html, links, error: extractError } = rawData;

  if (extractError) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Content extraction failed in browser: ${extractError}`,
        },
      ],
      isError: true,
    };
  }

  let output: string;
  if (format === "html") {
    output = removeRedundant ? converter.toCleanHtml(html || "") : html || "";
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

  return { content: [{ type: "text", text: output }] };
}

async function handleSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  const query = ((args.query as string) || "").trim();
  const engine = ((args.engine as string) || "google").toLowerCase() as string;
  let pageNum = Math.floor(Number(args.page));
  if (!Number.isFinite(pageNum) || pageNum < 1) pageNum = 1;

  if (!query) {
    return {
      content: [{ type: "text" as const, text: "Error: Missing 'query' parameter." }],
      isError: true,
    };
  }
  if (!(SEARCH_ENGINES as readonly string[]).includes(engine)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Unsupported engine '${engine}'. Supported: google, bing, duckduckgo, wikipedia, wikidata, reddit.`,
        },
      ],
      isError: true,
    };
  }

  const eng = engine as SearchEngine;
  let url = searchUrl(eng, query, pageNum);
  let script = buildSearchParseScript(eng);
  let value = await runScript(url, script, {
    waitAfterLoad: eng === "google" ? 1600 : CONFIG.defaultWaitAfterLoad,
  });
  let data: { results?: SearchItem[] };
  try {
    data = JSON.parse(value);
  } catch {
    data = { results: [] };
  }
  if (eng === "duckduckgo" && (!data.results || data.results.length === 0)) {
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    try {
      const v2 = await runScript(liteUrl, script, {
        waitAfterLoad: CONFIG.defaultWaitAfterLoad,
      });
      data = JSON.parse(v2);
    } catch {}
  }
  const payload = {
    engine: eng,
    query,
    page: pageNum,
    results: data.results || [],
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

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
