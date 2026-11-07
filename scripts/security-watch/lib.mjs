/**
 * Pure helpers for the daily security watch (no network, no child processes) so the
 * parsing and judging rules can be unit tested. check.mjs does the fetching.
 *
 * Statuses: "ok" | "warn" | "danger" | "unknown" (the check could not run).
 */

const RANK = { ok: 0, unknown: 1, warn: 2, danger: 3 };
export const EMOJI = { ok: "🟢", unknown: "⚪", warn: "🟡", danger: "🔴" };
export const LABEL = { ok: "정상", unknown: "확인 불가", warn: "주의", danger: "위험" };

export function worst(statuses) {
  return statuses.reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "ok");
}

export function category(key, title, items) {
  const unique = [...new Map(items.map((i) => [i.text, i])).values()];
  const sorted = unique.sort((a, b) => RANK[b.status] - RANK[a.status]);
  return { key, title, status: worst(sorted.map((i) => i.status)), items: sorted };
}

const isSpace = (c) => c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const [SLASH, EQUALS, GT] = [47, 61, 62];

/**
 * Reads start-tag attributes the way the HTML tokenizer does: `/` separates attributes like a
 * space (`<script/src=…>`), a `>` inside a quoted value does not end the tag, the first `src`
 * wins. `firstSrc(i)` → `{ value, quoted }` of the first src after the tag name ending at `i`,
 * or null. Every `<script` is read, overlapping ones too, so a decoy inside an inline script
 * string cannot hide a real tag. Linear in the text: walks that reach the same attribute share
 * the answer from there, and the ends of names and unquoted values are precomputed (a page of
 * `<script/n=x` repeated would otherwise rescan to the end once per tag).
 */
function srcReader(text) {
  const n = text.length;
  const nameEnd = new Int32Array(n + 1).fill(n);
  const valueEnd = new Int32Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) {
    const c = text.charCodeAt(i);
    nameEnd[i] = isSpace(c) || c === SLASH || c === GT || c === EQUALS ? i : nameEnd[i + 1];
    valueEnd[i] = isSpace(c) || c === GT ? i : valueEnd[i + 1];
  }
  const skip = (i, slashToo) => {
    while (i < n && (isSpace(text.charCodeAt(i)) || (slashToo && text.charCodeAt(i) === SLASH))) i++;
    return i;
  };
  const memo = new Map(); // attribute start → first src from there to the end of the tag
  return function firstSrc(start) {
    const chain = [];
    let found = null;
    for (let i = skip(start, true); i < n && text.charCodeAt(i) !== GT; i = skip(i, true)) {
      if (memo.has(i)) {
        found = memo.get(i);
        break;
      }
      chain.push(i);
      const nameStop = nameEnd[i + 1]; // the first character, even "=", belongs to the name
      const isSrc = nameStop - i === 3 && text.slice(i, nameStop).toLowerCase() === "src";
      let j = skip(nameStop, false);
      if (text.charCodeAt(j) !== EQUALS) {
        if (isSrc) {
          found = { value: "", quoted: false };
          break;
        }
        i = j;
        continue;
      }
      j = skip(j + 1, false);
      const quote = text[j];
      let value;
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        const stop = close === -1 ? n : close;
        value = { from: j + 1, to: stop, quoted: true };
        i = stop + 1;
      } else {
        value = { from: j, to: valueEnd[j], quoted: false };
        i = value.to;
      }
      if (isSrc) {
        // Unquoted values that end at the same place are one value read from different starts
        // (`<script/src=x<script/src=x…>` is one tag to the browser): key them by their end.
        const key = value.quoted ? `q${value.from}` : `u${value.to}`;
        found = { value: text.slice(value.from, value.to), quoted: value.quoted, key };
        break;
      }
    }
    for (const at of chain) memo.set(at, found);
    return found;
  };
}

// Named references that spell URL punctuation; numeric references cover every other character.
const NAMED_REFS = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", sol: "/", colon: ":", period: ".", quest: "?", num: "#", equals: "=", percnt: "%", commat: "@", bsol: "\\", Tab: "\t", NewLine: "\n" };

/** Character references in an attribute value, decoded as the browser does before it fetches the URL. */
function decodeRefs(value) {
  return value.replace(/&(?:#x([0-9a-f]{1,6});?|#(\d{1,7});?|([a-z]{2,8});)/gi, (ref, hex, dec, name) => {
    if (name) return Object.hasOwn(NAMED_REFS, name) ? NAMED_REFS[name] : ref;
    const code = hex ? Number.parseInt(hex, 16) : Number(dec);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  });
}

/**
 * `<script src>` values (the first `src`, as the browser uses, character references decoded) and
 * whether the value was quoted. React always quotes. Also reads `<script` inside inline script
 * strings (document.write loaders); a src that overlapping reads share is listed once, the
 * earliest reading, which is the one the browser sees.
 */
export function scriptTags(html) {
  const text = String(html ?? "");
  const out = [];
  const seen = new Set();
  let firstSrc = null;
  for (const m of text.matchAll(/<script(?=[\t\n\f\r />])/gi)) {
    firstSrc ??= srcReader(text);
    const src = firstSrc(m.index + m[0].length);
    if (!src?.value || seen.has(src.key)) continue;
    seen.add(src.key);
    out.push({ src: decodeRefs(src.value), quoted: src.quoted });
  }
  return out;
}

export function stylesheetHrefs(html) {
  const out = [];
  for (const tag of (html ?? "").match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/\shref\s*=\s*["']?([^"'\s>]+)/i);
    if (href) out.push(href[1]);
  }
  return out;
}

export function hostOf(url, base) {
  try {
    return new URL(url, base).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * One `scriptTags` entry on a page at `base` → item, or null when it is fine. A src that is not
 * http(s) has no host for the allow list to judge: `data:` carries the code itself and `blob:`
 * names code made inside the page. React never renders either. The URL parser lower-cases the
 * scheme and drops the spaces, tabs and newlines browsers drop (`" DA\tTA:…"` is `data:`). A src
 * the parser rejects is skipped: the browser cannot load it either.
 */
export function scriptSrcItem({ src, quoted }, { base, allowHosts }) {
  let url;
  try {
    url = new URL(src, base);
  } catch {
    return null;
  }
  const host = url.host.toLowerCase();
  if (url.protocol === "data:") return { status: "danger", text: "코드를 src 에 직접 담은 스크립트 (data:) — 호스트 허용 목록을 거치지 않음" };
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { status: "danger", text: `http(s) 가 아닌 스크립트 주소 (${url.protocol.slice(0, 20)}) — 이 사이트가 만드는 형태가 아님` };
  }
  if (!quoted && /^https?:/i.test(src)) return { status: "danger", text: `React 가 만들지 않은 형태의 외부 스크립트(따옴표 없는 src): ${host}` };
  if (host && !allowHosts.has(host)) return { status: "danger", text: `허용 목록 밖 외부 스크립트: ${host}` };
  return null;
}

/** Signatures of the fake-CAPTCHA (ClickFix) / EtherHiding campaigns seen in October 2026. */
const MARKERS = [
  {
    id: "gtm",
    label: "외부 Google Tag Manager 컨테이너 (이 사이트는 GTM을 쓰지 않음)",
    re: /gtm\.js\?id=GTM-[A-Z0-9]+/i,
  },
  {
    id: "etherhiding",
    label: "블록체인 RPC로 코드를 받아오는 로더 (EtherHiding)",
    re: /bsc-dataseed|bnbchain\.org|binance\.org:8545|\beth_call\b/i,
  },
  {
    id: "clickfix-text",
    label: "가짜 캡차 문구",
    re: /I am not a robot|reCAPTCHA Verification ID/i,
  },
  {
    id: "clipboard-command",
    label: "클립보드에 실행 명령어를 복사하는 코드",
    re: /clipboard\.writeText\([^)]{0,300}?(powershell|mshta|cmd(?:\.exe)?\s*\/c|\biex\b|Invoke-)/i,
  },
];

export function findMarkers(text) {
  return MARKERS.filter((m) => m.re.test(text ?? "")).map(({ id, label }) => ({ id, label }));
}

/** Next.js writes `version:"x.y.z"` into a client chunk. */
export function nextVersionIn(js) {
  return (js ?? "").match(/version:"(\d+\.\d+\.\d+)"/)?.[1] ?? null;
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? "");
  return m ? m.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** Highest stable release on the same major.minor line as `current`. */
export function latestPatch(versions, current) {
  const cur = parse(current);
  if (!cur) return null;
  return versions
    .filter((v) => {
      const p = parse(v);
      return p && p[0] === cur[0] && p[1] === cur[1];
    })
    .reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const vulnerabilityCount = (counts) => Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);

/**
 * `pnpm audit --json` output → `{ audit }`, or `{ item }` (unknown) when there is no report to
 * judge. A failed audit prints `{"error": …}` (registry down) or nothing at all (pnpm missing);
 * neither means "no vulnerabilities". Neither do counts without the advisories behind them.
 */
export function readAudit(raw) {
  let audit = null;
  try {
    audit = JSON.parse(raw ?? "");
  } catch {
    audit = null;
  }
  const unknown = (why) => ({ item: { status: "unknown", text: `pnpm audit 확인 불가 (${why})` } });
  if (isRecord(audit) && audit.error == null && isRecord(audit.advisories) && isRecord(audit.metadata?.vulnerabilities)) {
    const listed = Object.keys(audit.advisories).length;
    if (!listed && vulnerabilityCount(audit.metadata.vulnerabilities) > 0) return unknown("취약점 개수와 목록이 맞지 않음");
    return { audit };
  }
  // Only the error code: pnpm's message quotes the registry URL.
  const code = isRecord(audit?.error) ? audit.error.code : undefined;
  return unknown(code ? String(code).replace(/[^\w.-]/g, "?").slice(0, 40) : raw ? "결과 형식이 다름" : "결과 없음");
}

const CERT_DANGER_DAYS = 7;
const CERT_WARN_DAYS = 21;
// Errors Node raises when the certificate itself is bad (expired, wrong name, untrusted chain),
// as opposed to the connection failing: visitors' browsers show the same warning. Handshake
// errors (ERR_SSL_*) stay unknown: an App Service restart or a proxy can cause them for a minute.
const CERT_ERROR = /^(CERT_|ERR_TLS_CERT|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/;

/** TLS probe result (`{ days }` until expiry, or `{ error: code }`) → item, or null when the certificate is fine. */
export function tlsItem({ days, error } = {}) {
  if (error && CERT_ERROR.test(error)) return { status: "danger", text: `TLS 인증서 오류 (${error}) — 방문자 브라우저도 같은 경고를 띄움` };
  if (error || !Number.isFinite(days)) return { status: "unknown", text: `TLS 인증서 확인 실패${error ? ` (${error})` : ""}` };
  if (days < CERT_DANGER_DAYS) return { status: "danger", text: `TLS 인증서 만료 ${days}일 전` };
  if (days < CERT_WARN_DAYS) return { status: "warn", text: `TLS 인증서 만료 ${days}일 전` };
  return null;
}

/** Azure DNS name servers (ns1-01.azure-dns.com …), and nothing that merely contains the word. */
export const AZURE_NS = /\.azure-dns\.(com|net|org|info)\.?$/i;

/**
 * True when there is an answer and every name server is Azure DNS, or sits under `suffix` for a
 * site on another DNS host. The suffix matches whole labels: "ns.cloudflare.com" is not
 * "evilns.cloudflare.com". One unexpected server in the set is enough to take over the zone.
 */
export function nameServersExpected(ns, suffix) {
  const want = String(suffix ?? "").toLowerCase().replace(/^\.+|\.+$/g, "");
  const ok = (n) => {
    const host = String(n).toLowerCase().replace(/\.+$/, "");
    return want ? host === want || host.endsWith(`.${want}`) : AZURE_NS.test(host);
  };
  return Array.isArray(ns) && ns.length > 0 && ns.every(ok);
}

/** App Insights dependency target (host or host:port) against allow entries: exact, "*.suffix", bare IP any port. */
export function isAllowedOutbound(target, allow) {
  const host = String(target ?? "").toLowerCase().replace(/:\d+$/, "");
  return allow.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith("*.")) return host.endsWith(e.slice(1));
    return host === e;
  });
}

const KQL_SAFE_PATH = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;

/**
 * KQL step keeping App Insights `requests` rows that are a POST to one of `paths` (relative to
 * the site root). App Insights logs the name in the case it was sent (`POST /AUTH/V1/signup`,
 * 2026-11-07), and Next's rewrite to GoTrue ignores case and decodes the path, so the name is
 * lower-cased and percent-decoded before the match; `url_decode` returns a malformed escape
 * unchanged. Whole paths only: `/signup/` is Next's 308, not a second request to GoTrue.
 * Paths are limited to letters, digits, `_`, `-` and `/` so nothing needs escaping in KQL.
 */
export function postPathFilter(paths) {
  const alts = (paths ?? []).map((p) => {
    const path = String(p).toLowerCase().replace(/^\/+|\/+$/g, "");
    if (!KQL_SAFE_PATH.test(path)) throw new Error(`postPathFilter: unsupported path ${JSON.stringify(String(p).slice(0, 40))}`);
    return path;
  });
  if (!alts.length) throw new Error("postPathFilter: no paths");
  return `where name startswith 'POST ' | extend secwatch_path = tolower(coalesce(url_decode(name), name)) | where secwatch_path matches regex @'^post /(${alts.join("|")})$'`;
}

const MAX_ITEMS = 6;
const MAX_ITEM_CHARS = 220;
// Item text can carry names from outside (committed file names, action paths): `<!channel>` would ping everyone.
const escapeMrkdwn = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s) => (s.length > MAX_ITEM_CHARS ? `${s.slice(0, MAX_ITEM_CHARS - 3)}…` : s);

/** Several projects post to one channel, so the header and the notification text carry the project name. */
export function buildSlackPayload({ projectName = "Tester Match", siteUrl, date, runUrl, categories }) {
  const counts = { danger: 0, warn: 0, unknown: 0, ok: 0 };
  for (const c of categories) counts[c.status]++;
  const overall = worst(categories.map((c) => c.status));
  const summary = `${EMOJI[overall]} *${LABEL[overall]}* — 위험 ${counts.danger} · 주의 ${counts.warn} · 확인 불가 ${counts.unknown} · 정상 ${counts.ok}`;
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🛡️ ${projectName} 보안 점검 ${date}` } },
    { type: "section", text: { type: "mrkdwn", text: summary } },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `${siteUrl}${runUrl ? ` · <${runUrl}|실행 기록>` : ""}` },
      ],
    },
    { type: "divider" },
  ];
  for (const c of categories) {
    const lines = c.items
      .slice(0, MAX_ITEMS)
      .map((i) => `• ${EMOJI[i.status]} ${escapeMrkdwn(clip(String(i.text)))}`);
    if (c.items.length > MAX_ITEMS) lines.push(`• … 외 ${c.items.length - MAX_ITEMS}건 (실행 기록 참고)`);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${EMOJI[c.status]} *${c.title}* — ${LABEL[c.status]}\n${lines.join("\n")}` },
    });
  }
  return { text: `${EMOJI[overall]} ${projectName} 보안 점검 ${date}: ${LABEL[overall]}`, blocks };
}
