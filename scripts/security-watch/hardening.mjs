/**
 * Pure judging rules for configuration seen from outside (③) or through the read-only Azure
 * identity (⑤). check.mjs fetches; these functions only decide ok/warn/danger.
 *
 * Items name resources and settings, never IP addresses or secret values: Actions logs of this
 * repository are public.
 */

// Keeps Korean, spaces and `#` so labels such as "DB #1" survive; markup and quotes become "?".
const safe = (v) => String(v ?? "?").replace(/[^\w.$/#\s가-힣-]/g, "?").slice(0, 63);

/**
 * CORS on an API route. Echoing an arbitrary Origin together with credentials lets any website
 * call the route as the signed-in visitor. `*` with credentials is refused by browsers, so it is
 * not flagged (GoTrue sends that and reads tokens from headers, not cookies).
 */
export function corsRisk(headers, probeOrigin) {
  const origin = headers.get("access-control-allow-origin");
  const credentials = (headers.get("access-control-allow-credentials") ?? "").toLowerCase() === "true";
  if (!credentials) return null;
  if (origin === probeOrigin || origin === "null") return "danger";
  return null;
}

const txtRecords = (records) => (records ?? []).map((chunks) => (Array.isArray(chunks) ? chunks.join("") : String(chunks)));

/** SPF on the sending domain. Without it, mail forged in this domain's name passes. */
export function spfIssue(records) {
  const spf = txtRecords(records).filter((t) => /^v=spf1(\s|$)/i.test(t));
  if (!spf.length) return "SPF 레코드 없음 — 이 도메인을 사칭한 메일을 받는 쪽이 걸러내지 못함";
  if (spf.length > 1) return "SPF 레코드가 2개 이상 — 받는 쪽이 SPF 전체를 무효로 처리";
  const rec = spf[0];
  const strictEnd = /(^|\s)[~-]all(\s|$)/i.test(rec);
  if (!strictEnd && /(^|\s)[+?]?all(\s|$)/i.test(rec)) return "SPF 가 모든 발신 서버를 허용 (+all/?all)";
  if (!strictEnd && !/(^|\s)redirect=/i.test(rec)) return "SPF 끝에 -all/~all 없음 — 목록 밖 발신 서버도 통과";
  return null;
}

/** `_dmarc` names to try in order: the mail domain, then its parents (a subdomain falls back to the organisational record). */
export function dmarcNames(domain) {
  const parts = String(domain ?? "").split(".").filter(Boolean);
  const out = [];
  for (let i = 0; i <= parts.length - 2; i++) out.push(`_dmarc.${parts.slice(i).join(".")}`);
  return out;
}

/** DMARC tells receivers what to do with mail that fails SPF/DKIM; p=none only reports. */
export function dmarcIssue(records) {
  const rec = txtRecords(records).find((t) => /^v=DMARC1(\s*;|$)/i.test(t));
  if (!rec) return "DMARC 레코드 없음 — 사칭 메일 처리 방침이 없음";
  const policy = rec.match(/;\s*p\s*=\s*([a-z]+)/i)?.[1]?.toLowerCase();
  if (!policy || policy === "none") return "DMARC 정책 p=none — 사칭 메일을 막지 않고 보고만 받음";
  return null;
}

/** `/rest/v1` must stay server-only (the app reaches PostgREST on localhost). */
export function isPostgrestResponse(status, text) {
  if (/"code"\s*:\s*"PGRST/.test(text ?? "")) return true;
  return status === 200 && /"swagger"|"openapi"/.test(text ?? "");
}

/**
 * `/_next/image` asked for a real image on an outside host: "open" when it serves the image,
 * "closed" on 400 "url" parameter is not allowed (or 404, optimizer not served), null when a
 * WAF, rate limit or outage hides the answer.
 */
export function imageProxyState(status, text, contentType) {
  if (status === 404) return "closed";
  if (status === 400 && /parameter is not allowed/i.test(text ?? "")) return "closed";
  if (status === 200 && /^image\//i.test(contentType ?? "")) return "open";
  return null;
}

/** GoTrue `/settings` is public. Sign-in methods outside the expected set, or auto-confirm, are drift. */
export function gotrueSettingsItems(settings, expectedProviders) {
  const items = [];
  const enabled = Object.entries(settings?.external ?? {})
    .filter(([, on]) => on === true)
    .map(([name]) => name);
  const extra = enabled.filter((name) => !expectedProviders.has(name));
  if (extra.length) items.push({ status: "warn", text: `로그인 방식이 새로 켜짐: ${extra.map(safe).join(", ")} — 본인 설정인지 확인` });
  if (settings?.mailer_autoconfirm === true) {
    items.push({ status: "danger", text: "이메일 인증 없이 가입 확정(mailer_autoconfirm) — 아무 주소로나 확인된 계정을 만들 수 있음" });
  }
  if (settings?.phone_autoconfirm === true) {
    items.push({ status: "danger", text: "전화번호 인증 없이 가입 확정(phone_autoconfirm)" });
  }
  return items;
}

/**
 * Answer to an empty POST: GoTrue's own JSON error (validation, missing auth, even a 404 like
 * user_not_found) means the path reaches GoTrue. The app's middleware block answers
 * 404 {"error":"not_found"} and GoTrue's router answers a plain-text 404 for unknown routes.
 */
export function reachesGoTrue(status, text) {
  if (status === 0 || status >= 500) return false;
  try {
    const body = JSON.parse(text ?? "");
    return typeof body?.error_code === "string" || typeof body?.msg === "string";
  } catch {
    return false;
  }
}

function tlsBelow12(v) {
  if (v == null || v === "") return false;
  const n = Number.parseFloat(String(v).replace(/^TLS1_/i, "1.").replace(/^TLSv/i, ""));
  return Number.isFinite(n) && n < 1.2;
}

/** App Service / Function App settings that undo transport security or open a debug door. */
export function appServiceIssues(name, cfg) {
  const n = safe(name);
  const out = [];
  if (cfg?.httpsOnly !== true) out.push({ status: "danger", text: `${n}: 암호화 안 된 HTTP 접속 허용 (httpsOnly 꺼짐)` });
  if (tlsBelow12(cfg?.minTlsVersion)) out.push({ status: "warn", text: `${n}: TLS ${safe(cfg.minTlsVersion)} 허용 (1.2 미만)` });
  if (tlsBelow12(cfg?.scmMinTlsVersion)) out.push({ status: "warn", text: `${n}: 배포 사이트(SCM) TLS ${safe(cfg.scmMinTlsVersion)} 허용` });
  if (cfg?.ftpsState === "AllAllowed") out.push({ status: "warn", text: `${n}: 암호화 없는 FTP 허용` });
  if (cfg?.remoteDebuggingEnabled === true) out.push({ status: "danger", text: `${n}: 원격 디버깅 켜짐 — 외부에서 프로세스에 붙을 수 있음` });
  return out;
}

const WIDE_RANGE = 65536; // wider than a /16

function ipv4(v) {
  const p = String(v ?? "").split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

// Half the IPv4 space or more is "everyone": 0.0.0.0–255.255.255.254, or the two halves as two rules.
const HALF_IPV4 = 2 ** 31;
const size = (r) => r.end - r.start + 1;
const isAzureServices = (r) => r.start === 0 && r.end === 0; // Azure's AllowAllAzureServices marker

/** Addresses covered by the rules together (overlaps counted once), so four /2 rules are "everyone" too. */
function coveredAddresses(ranges) {
  const sorted = ranges.filter((r) => !isAzureServices(r) && r.end >= r.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let cur = null;
  for (const r of sorted) {
    if (cur && r.start <= cur.end + 1) {
      cur.end = Math.max(cur.end, r.end);
    } else {
      if (cur) total += size(cur);
      cur = { ...r };
    }
  }
  return cur ? total + size(cur) : total;
}

/** PostgreSQL Flexible Server network and TLS. Firewall rules are judged, never printed. */
export function postgresIssues(name, { publicNetworkAccess, rules = [], requireSecureTransport, sslMinProtocol } = {}) {
  const n = safe(name);
  const out = [];
  const open = publicNetworkAccess !== "Disabled";
  const ranges = rules.map((r) => ({ start: ipv4(r.start), end: ipv4(r.end) })).filter((r) => r.start !== null && r.end !== null);
  if (open && coveredAddresses(ranges) >= HALF_IPV4) {
    out.push({ status: "danger", text: `${n}: 인터넷 절반 이상(모든 IP 포함)을 허용하는 방화벽 규칙 — 비밀번호만으로 어디서나 접속` });
  }
  if (open && ranges.some(isAzureServices)) {
    out.push({ status: "warn", text: `${n}: 모든 Azure 고객의 서비스에서 접속 허용 (AllowAllAzureServices)` });
  }
  const wide = ranges.filter((r) => !isAzureServices(r) && size(r) > WIDE_RANGE && size(r) < HALF_IPV4).length;
  if (open && wide) out.push({ status: "warn", text: `${n}: /16 보다 넓은 IP 대역 허용 규칙 ${wide}개` });
  if (requireSecureTransport != null && String(requireSecureTransport).toLowerCase() !== "on") {
    out.push({ status: "danger", text: `${n}: 암호화 안 된 DB 접속 허용 (require_secure_transport=${safe(requireSecureTransport)})` });
  }
  if (tlsBelow12(sslMinProtocol)) out.push({ status: "warn", text: `${n}: DB TLS ${safe(sslMinProtocol)} 허용 (1.2 미만)` });
  return out;
}

/** Storage accounts: anonymous containers, plain HTTP, old TLS. */
export function storageIssues(name, cfg) {
  const n = safe(name);
  const out = [];
  if (cfg?.allowBlobPublicAccess === true) out.push({ status: "warn", text: `${n}: 익명 공개 컨테이너를 만들 수 있음 (allowBlobPublicAccess)` });
  if (cfg?.enableHttpsTrafficOnly === false) out.push({ status: "danger", text: `${n}: 암호화 안 된 HTTP 접근 허용` });
  if (tlsBelow12(cfg?.minimumTlsVersion)) out.push({ status: "warn", text: `${n}: TLS ${safe(cfg.minimumTlsVersion)} 허용 (1.2 미만)` });
  return out;
}
