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

/** `<script src>` values, and whether the attribute was quoted. React always quotes. */
export function scriptTags(html) {
  const out = [];
  for (const m of (html ?? "").matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    const quoted = attrs.match(/\ssrc\s*=\s*(["'])(.*?)\1/i);
    if (quoted) {
      out.push({ src: quoted[2], quoted: true });
      continue;
    }
    const bare = attrs.match(/\ssrc\s*=\s*([^\s"'>]+)/i);
    if (bare) out.push({ src: bare[1], quoted: false });
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
