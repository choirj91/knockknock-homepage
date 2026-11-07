/**
 * Judging rules specific to this site: a Next.js static export on Azure Static Web Apps with
 * AdSense and one stylesheet from jsDelivr. No network here; check.mjs fetches. Rules that are
 * not about this site (TLS, name servers, reading the audit report) come from lib.mjs.
 */
import { readAudit } from "./lib.mjs";

// Only next: its advisories are about the server it ships. react/react-dom run in the visitor's
// browser on a static site too, so their advisories (XSS) keep their normal weight.
const FRAMEWORK = new Set(["next"]);

const floorOf = (advisories) => {
  const floors = advisories.map((a) => String(a.patched_versions).match(/>=\s*(\d+)\.(\d+)\.(\d+)/)).filter(Boolean);
  if (!floors.length) return null;
  const best = floors.map((m) => m.slice(1).map(Number)).reduce((a, b) => ((a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0 ? a : b));
  return best.join(".");
};

/**
 * `pnpm audit --prod --json` output → items. A report that is not there to judge (registry down,
 * no output, counts without advisories) is unknown, never clean: lib.mjs readAudit. On a static
 * export no Next.js server runs: the framework's high/critical advisories (server actions, image
 * optimizer, middleware) cannot be reached on the live site, so they are an upgrade warning with
 * the version that clears them, not a daily red. A critical advisory anywhere else stays danger.
 */
export function auditItems(raw, { staticExport }) {
  const { audit, item } = readAudit(raw);
  if (item) return [item];
  const items = [];
  const advisories = Object.values(audit.advisories);
  const severe = (a) => a.severity === "critical" || a.severity === "high";
  const framework = advisories.filter((a) => FRAMEWORK.has(a.module_name) && severe(a));
  const critical = advisories.filter((a) => !FRAMEWORK.has(a.module_name) && a.severity === "critical");
  const otherHigh = advisories.filter((a) => !FRAMEWORK.has(a.module_name) && a.severity === "high");
  if (framework.length) {
    const floor = floorOf(framework);
    const fix = floor ? `${floor} 이상으로 업그레이드` : "업그레이드";
    items.push(
      staticExport
        ? { status: "warn", text: `Next.js high·critical ${framework.length}건 — 정적 사이트라 서버 쪽 취약점은 운영에서 실행되지 않지만 ${fix} 권장` }
        : { status: "danger", text: `Next.js high·critical ${framework.length}건 — ${fix} 필요` },
    );
  }
  if (critical.length) {
    const names = critical.slice(0, 4).map((a) => `${a.module_name} ${a.title}`).join(" / ");
    items.push({ status: "danger", text: `즉시 조치할 critical 취약점 ${critical.length}건: ${names}` });
  }
  if (otherHigh.length) {
    const modules = [...new Set(otherHigh.map((a) => a.module_name))].join(", ");
    items.push({ status: "warn", text: `간접 의존성 high ${otherHigh.length}건 (${modules}) — 정기 업데이트 때 정리` });
  }
  if (!items.length) {
    const moderate = audit.metadata.vulnerabilities.moderate ?? 0;
    items.push(moderate > 0 ? { status: "warn", text: `중간 위험 취약점 ${moderate}건` } : { status: "ok", text: "운영 의존성 알려진 취약점 없음 (pnpm audit)" });
  }
  return items;
}

const sellerLines = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

/**
 * Served /ads.txt against public/ads.txt. A changed seller line sends AdSense revenue to someone
 * else — the cheapest tampering to profit from on a content site.
 */
export function adsTxtIssue(status, served, committed) {
  if (status === 0 || status >= 500) return { status: "unknown", text: `ads.txt 확인 불가 (${status ? `HTTP ${status}` : "응답 없음"})` };
  if (status !== 200) return { status: "warn", text: `ads.txt 응답 ${status} — AdSense 판매자 확인이 안 됨` };
  if (sellerLines(served) !== sellerLines(committed)) {
    return { status: "danger", text: "배포된 ads.txt 가 저장소(public/ads.txt)와 다름 — 광고 수익을 가로채는 판매자 ID 변경 의심" };
  }
  return null;
}

/**
 * Outside stylesheets by URL → SRI-style hash of the body when it was pinned. The pinned URL is
 * version-tagged and served `immutable`, so any change means the CDN or the tag was tampered with.
 * Changing the font version in app/layout.tsx needs a new pin (site.test.mjs checks the URL).
 */
export const PINNED_STYLES = {
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css":
    "sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j",
};

export function styleIssue(url, sri, pinned = PINNED_STYLES) {
  let host = "?";
  try {
    host = new URL(url).host;
  } catch {
    // keep "?"
  }
  if (!(url in pinned)) return { status: "warn", text: `고정(해시 등록)되지 않은 외부 스타일시트: ${host} — site.mjs PINNED_STYLES 에 추가` };
  if (pinned[url] !== sri) return { status: "danger", text: `외부 스타일시트 내용이 바뀜 (${host}) — CDN·태그 변조 의심` };
  return null;
}

/** Security headers on the home page; CSP frame-ancestors stands in for X-Frame-Options. */
export function missingHeaders(headers) {
  const csp = headers.get("content-security-policy");
  const missing = [];
  if (!csp) missing.push("CSP");
  if (!headers.get("strict-transport-security")) missing.push("HSTS");
  if (!headers.get("x-content-type-options")) missing.push("X-Content-Type-Options");
  if (!headers.get("x-frame-options") && !/frame-ancestors/i.test(csp ?? "")) missing.push("X-Frame-Options");
  return missing;
}

/** CNAME answers against the hosting the record should point at; text when something is off. */
export function cnameIssue(cnames, allowedSuffixes) {
  if (!cnames?.length) return "CNAME 없음 — 레코드가 지워졌거나 바뀜";
  const odd = cnames.filter((c) => !allowedSuffixes.some((s) => c.toLowerCase().endsWith(s)));
  return odd.length ? `CNAME 이 예상 밖 주소를 가리킴: ${odd.join(", ")}` : null;
}

/** Permanent redirect (301/308) to exactly `host`. */
export function redirectsTo(status, location, host) {
  if (status !== 301 && status !== 308) return false;
  try {
    return new URL(location).host === host;
  } catch {
    return false;
  }
}
