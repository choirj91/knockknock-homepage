/**
 * Pure rules for ⑦ — secrets committed to this public repository, and GitHub Actions workflow
 * patterns that let an outsider run code with the repository's secrets. check.mjs feeds the
 * file text and `git log -p` output. Findings name the file and the kind of secret, never the value.
 */

import { createHash } from "node:crypto";

const decodeJwtRole = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.role ?? null;
  } catch {
    return null;
  }
};

// Passwords that are template references or documentation stand-ins, not real values:
// `${DB_PASSWORD}`, `<password>`, `[YOUR-PASSWORD]` (Supabase dashboard), `your-super-secret-…`
// (Supabase self-host .env.example). The whole value must be the reference, so a real password
// that merely starts with `$` or `<` still counts.
// Variable references are case-sensitive (`$DB_PASSWORD`), so a real `$Rk9…` password still counts.
const TEMPLATE_REF = /^(?:\$\{?[A-Z_][A-Z0-9_]*\}?|\$\{[^}]+\}|<[^>]*>|\{\{?[^}]*\}?\}|\[[^\]]*\]|%[A-Z_]*%|%s)$/;
const STAND_IN = /^(?:\*+|x+|\.{3}|postgres)$/i;
// Documentation values are made of these words only (`your_password`, `your-super-secret-and-long-
// postgres-password`); a real password that merely contains one (`Passw0rd2024xyz`) still counts.
const MARKER_WORDS = new Set(["your", "password", "passwd", "pwd", "secret", "changeme", "example", "placeholder", "dummy", "redacted"]);
const FILLER_WORDS = new Set(["my", "the", "a", "and", "super", "long", "very", "strong", "db", "database", "postgres", "user", "admin", "app", "here", "change", "me", "put", "insert", "new", "real", "local", "dev", "pass", "value"]);
function isWordPlaceholder(v) {
  const words = v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.some((w) => MARKER_WORDS.has(w)) && words.every((w) => MARKER_WORDS.has(w) || FILLER_WORDS.has(w));
}
const isPlaceholder = (v) => TEMPLATE_REF.test(v) || STAND_IN.test(v) || isWordPlaceholder(v);
// Hosts that exist only on a developer machine or inside a compose network (no dot), or a variable.
// Anchored at both ends: `localhost.evil.com` is a real host.
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|host\.docker\.internal|[\w-]+|\$\{?\w+\}?)$/i;

/**
 * Each rule: id, label (Korean, shown in Slack), status, global regex, optional `keep(match)`
 * filter that drops false positives. High-confidence shapes only: a daily alarm that is always
 * wrong gets ignored, and then the real one is missed.
 */
export const SECRET_RULES = [
  {
    id: "private-key",
    label: "개인 키(PEM)",
    status: "danger",
    re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{64}/g,
  },
  { id: "azure-storage-key", label: "Azure 스토리지 계정 키", status: "danger", re: /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/g },
  { id: "azure-access-key", label: "Azure 서비스 액세스 키 (ACS 등)", status: "danger", re: /accesskey=[A-Za-z0-9+/]{40,}={0,2}/gi },
  { id: "azure-sas", label: "Azure SAS 토큰", status: "danger", re: /[?&]sv=20\d\d-\d\d-\d\d&[^\s"']{0,1000}?sig=[A-Za-z0-9%+/=]{30,}/g },
  {
    id: "slack-webhook",
    label: "Slack 웹훅 주소",
    status: "danger",
    re: /hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/g,
  },
  { id: "github-token", label: "GitHub 토큰", status: "danger", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g },
  { id: "aws-key", label: "AWS 액세스 키", status: "danger", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    id: "payment-live-key",
    label: "결제 라이브 비밀 키 (Stripe·토스·포트원)",
    status: "danger",
    re: /\b(?:sk_live_[0-9a-zA-Z]{20,}|rk_live_[0-9a-zA-Z]{20,}|live_sk_[0-9a-zA-Z]{16,}|live_gsk_[0-9a-zA-Z]{16,})/g,
  },
  {
    id: "llm-key",
    label: "AI API 키 (Anthropic·OpenAI)",
    status: "danger",
    re: /\bsk-(?:ant-[A-Za-z0-9_-]{40,}|proj-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})/g,
  },
  { id: "sendgrid-key", label: "SendGrid API 키", status: "danger", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  {
    id: "privileged-jwt",
    label: "관리자 권한 JWT (service_role 등)",
    status: "danger",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g,
    keep: (m) => ["service_role", "supabase_admin", "postgres"].includes(decodeJwtRole(m[0])),
  },
  {
    id: "db-url-password",
    label: "비밀번호가 들어간 DB 접속 주소",
    status: "danger",
    // Bounded quantifiers: unbounded ones made a 200 KB run of "postgres://a:" take seconds.
    re: /\bpostgres(?:ql)?:\/\/([^:\s/'"@]{1,128}):([^\s'"/]{6,200})@(\[[^\]\s]{1,64}\]|[^/\s'":?@]{1,253})/g,
    keep: (m) => !isPlaceholder(m[2]) && !LOCAL_HOST.test(m[3]),
  },
  { id: "google-api-key", label: "Google API 키", status: "warn", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    id: "appinsights-key",
    label: "App Insights 수집 키 (로그 위조에 쓰일 수 있음)",
    status: "warn",
    re: /InstrumentationKey=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  },
];

/**
 * Generated lockfiles only: thousands of integrity hashes, no hand-written values. Everything
 * else is judged by content (decodeFile), so renaming a file to `.png` does not hide it.
 */
export const SKIP_FILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;

/**
 * File bytes → text to scan. UTF-16 (BOM) is decoded; other files with a NUL byte are binary and
 * are read as latin1, which keeps every ASCII run intact for the patterns (line numbers then mean little).
 */
export function decodeFile(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString("utf16le"), binary: false };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2));
    le.swap16();
    return { text: le.toString("utf16le"), binary: false };
  }
  if (buf.includes(0)) return { text: buf.toString("latin1"), binary: true };
  return { text: buf.toString("utf8"), binary: false };
}

/** Line number lookup built once per text (rescanning from the start per match was quadratic). */
function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
// Same secret seen in a commit and again in the merge that brought it in → one finding. Never printed.
const fingerprint = (rule, value) => createHash("sha256").update(`${rule}\0${value}`).digest("hex").slice(0, 16);

/** Secret findings in one text: [{ file, line, id, label, status, fingerprint }]. */
export function scanText(text, file) {
  const out = [];
  const body = text ?? "";
  let lineAt = null;
  for (const rule of SECRET_RULES) {
    for (const m of body.matchAll(rule.re)) {
      if (rule.keep && !rule.keep(m)) continue;
      lineAt ??= lineIndex(body);
      out.push({ file, line: lineAt(m.index), id: rule.id, label: rule.label, status: rule.status, fingerprint: fingerprint(rule.id, m[0]) });
    }
  }
  return out;
}

/**
 * History findings the owner has already handled, from repo-scan-allow.json:
 * [{ commit (7+ chars), file, rule, rotated: "YYYY-MM-DD" }]. Public history cannot be erased
 * without a force push, so a secret that has been revoked and replaced is listed instead of
 * alarming every day. The file is optional; `rotated` is required so each entry records the fix.
 */
export function isAllowedHistory(allow, { commit, file, id }) {
  return (allow ?? []).some(
    (a) => typeof a?.commit === "string" && a.commit.length >= 7 && commit.startsWith(a.commit) && a.file === file && a.rule === id && Boolean(a.rotated),
  );
}

export const PATCH_MARKER = "@@secwatch ";

const C_ESCAPES = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };

/**
 * Path from a `+++ ` header. Git appends a tab to names with spaces and C-quotes names with
 * special characters (and non-ASCII, unless core.quotepath=false) — octal escapes are UTF-8 bytes.
 */
export function patchPath(header) {
  let p = header.replace(/^\+\+\+ /, "").replace(/\t$/, "");
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    const bytes = [];
    const body = p.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== "\\") {
        bytes.push(...Buffer.from(body[i]));
      } else if (/[0-7]{3}/.test(body.slice(i + 1, i + 4))) {
        bytes.push(Number.parseInt(body.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        bytes.push(...Buffer.from(C_ESCAPES[body[i + 1]] ?? body[i + 1] ?? ""));
        i += 1;
      }
    }
    p = Buffer.from(bytes).toString("utf8");
  }
  return p.replace(/^b\//, "");
}

/**
 * Added text per commit and file from `git log -p -U0 --format=@@secwatch %H`.
 * A secret removed in a later commit is still public in history, so added lines are what count.
 */
export function addedText(patch) {
  const out = new Map();
  let commit = null;
  let file = null;
  let header = false; // "+++ " is a file header only right after "--- ", not an added "++ …" line
  for (const line of String(patch ?? "").split("\n")) {
    if (line.startsWith(PATCH_MARKER)) {
      commit = line.slice(PATCH_MARKER.length).trim();
      file = null;
      header = false;
    } else if (line.startsWith("diff --git ")) {
      file = null;
      header = false;
    } else if (line.startsWith("--- ") && file === null) {
      header = true;
    } else if (header && line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : patchPath(line);
      header = false;
    } else if (commit && file && line.startsWith("+")) {
      const key = `${commit}\0${file}`;
      // `--text` diffs binary files too; NULs between ASCII bytes (UTF-16) would split a secret.
      out.set(key, `${out.get(key) ?? ""}${line.slice(1).replaceAll("\u0000", "")}\n`);
    }
  }
  return [...out].map(([key, text]) => {
    const [c, f] = key.split("\0");
    return { commit: c, file: f, text };
  });
}

// --- GitHub Actions workflows -------------------------------------------------------------

/** Drops a `#` comment (YAML and shell alike) but keeps a `#` inside quotes: `echo "x #" ${{ … }}`. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (quote === '"' && c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

const stripComments = (text) => String(text ?? "").split("\n").map(stripComment).join("\n");

/** `run:` / `script:` bodies with their first line number. */
function runBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(-\s+)?(run|script):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length + (m[2] ? m[2].length : 0);
    const body = [m[4]];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && l.match(/^\s*/)[0].length <= indent) break;
      body.push(l);
    }
    out.push({ line: i + 1, text: body.join("\n") });
  }
  return out;
}

// Actions resolves `${{ }}` before the shell runs, even inside a shell comment, so run blocks are
// checked raw. Bracket syntax github['event'] is normalised to dots first.
const dotted = (text) => text.replace(/\[\s*['"]([\w-]+)['"]\s*\]/g, ".$1");

// Free-text contexts an outsider controls (GitHub's list of untrusted input: titles, bodies, branch
// names, commit messages, author names). Numbers and SHAs such as pull_request.number are safe.
const UNTRUSTED_FIELDS = [
  String.raw`(?:issue|pull_request|discussion)\.(?:title|body)`,
  String.raw`(?:comment|review|review_comment|discussion_comment)\.body`,
  String.raw`pull_request\.head\.(?:ref|label|repo\.default_branch)`,
  String.raw`(?:workflow_run\.)?head_commit\.(?:message|author\.(?:email|name))`,
  String.raw`commits\S*?\.(?:message|author\.(?:email|name))`,
  String.raw`pages\S*?\.page_name`,
  String.raw`workflow_run\.(?:head_branch|display_title)`,
];
const UNTRUSTED = new RegExp(
  String.raw`\$\{\{(?:[^}]|\}(?!\}))*?(?:\bgithub\.head_ref\b|\bgithub\.event\.(?:${UNTRUSTED_FIELDS.join("|")})\b|\btoJSON\(\s*github\.event\s*\))`,
);
const PR_HEAD_CHECKOUT = /\bref:\s*\$\{\{\s*(github\.event\.pull_request\.head\.|github\.head_ref|github\.event\.workflow_run\.head_)/;
const SHA = /^[0-9a-f]{40}$/;
const MUTABLE_REF = new Set(["main", "master", "head", "develop", "dev", "latest"]);

/**
 * Workflow findings: [{ status, text }]. `trustedOwners` (lowercase) may use version tags; any
 * other third-party action must be pinned to a full commit SHA — a moved tag runs new code with
 * this repository's secrets (tj-actions/changed-files, March 2025).
 */
export function lintWorkflow(rawText, file, { trustedOwners = new Set(["actions", "github"]) } = {}) {
  const text = stripComments(rawText);
  const items = [];
  const privileged = /\b(pull_request_target|workflow_run)\b/.test(text);
  if (privileged && PR_HEAD_CHECKOUT.test(text)) {
    items.push({ status: "danger", text: `${file}: pull_request_target/workflow_run 에서 외부 PR 코드를 체크아웃 — 비밀 권한으로 남의 코드 실행 (pwn request)` });
  } else if (privileged) {
    items.push({ status: "warn", text: `${file}: pull_request_target/workflow_run 사용 — 외부 PR 코드를 실행하지 않는지 확인` });
  }
  for (const block of runBlocks(String(rawText ?? ""))) {
    if (UNTRUSTED.test(dotted(block.text))) {
      items.push({ status: "danger", text: `${file}:${block.line} run 에 외부 입력(PR 제목·브랜치명 등)을 직접 삽입 — 스크립트 주입. env 로 넘길 것` });
    }
  }
  if (/^\s*permissions:\s*write-all\b/m.test(text)) items.push({ status: "warn", text: `${file}: permissions: write-all — 필요한 권한만 지정` });
  if (/\bruns-on:.*self-hosted/.test(text) && /\bpull_request(_target)?\b/.test(text)) {
    items.push({ status: "danger", text: `${file}: 공개 저장소 PR 이 self-hosted 러너에서 실행됨 — 외부인이 러너 장비에서 코드 실행` });
  }
  for (const m of text.matchAll(/\buses:\s*["']?([^\s"'#]+)/g)) {
    const ref = m[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
    const [path, version = ""] = ref.split("@");
    const owner = path.split("/")[0].toLowerCase();
    if (!version || MUTABLE_REF.has(version.toLowerCase())) {
      items.push({ status: "warn", text: `${file}: ${path} 를 브랜치(${version || "버전 없음"})로 사용 — 커밋 SHA 로 고정` });
    } else if (!SHA.test(version) && !trustedOwners.has(owner)) {
      items.push({ status: "warn", text: `${file}: 외부 액션 ${path}@${version} 이 SHA 로 고정되지 않음` });
    }
  }
  return items;
}
