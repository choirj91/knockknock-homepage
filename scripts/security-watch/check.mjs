#!/usr/bin/env node
/**
 * Daily security watch for knockknock.company — run by .github/workflows/security-watch.yml.
 *
 * Posts one Slack message to the channel Tester Match also reports to (separate webhook, the
 * header names the project), or prints it with SECWATCH_DRY_RUN=1. Exits 2 when anything is
 * "danger" so the workflow run also turns red.
 *
 * The site is a Next.js static export on Azure Static Web Apps: no server, no database, no
 * sign-in. So the categories are ① page tampering, ② dependencies, ③ exposure and DNS, ⑦
 * repository and CI. The numbers match the Tester Match report; ④⑤⑥ need a server, a database
 * or an Azure read-only identity this site does not have.
 *
 * lib.mjs, repo-scan.mjs, hardening.mjs and their tests are copied from
 * choirj91/tester-match@6c448d1 05-harness/security-watch (porting guide: META-PROMPT.md there).
 * Change them there first, then copy. site.mjs holds the rules that are only about this site and
 * uses lib.mjs for the rest.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import tls from "node:tls";
import { dmarcIssue, dmarcNames, spfIssue } from "./hardening.mjs";
import {
  buildSlackPayload,
  category,
  compareVersions,
  findMarkers,
  hostOf,
  latestPatch,
  nameServersExpected,
  nextVersionIn,
  scriptSrcItem,
  scriptTags,
  stylesheetHrefs,
  tlsItem,
} from "./lib.mjs";
import { addedText, decodeFile, isAllowedHistory, lintWorkflow, PATCH_MARKER, scanText, SKIP_FILE } from "./repo-scan.mjs";
import { adsTxtIssue, auditItems, cnameIssue, missingHeaders, redirectsTo, styleIssue } from "./site.mjs";

const env = process.env;
const PROJECT = env.SECWATCH_PROJECT_NAME || "낰낰컴퍼니 홈페이지";
const SITE = (env.SECWATCH_SITE_URL || "https://knockknock.company").replace(/\/$/, "");
const SITE_HOST = new URL(SITE).host;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const POSTS_TO_CHECK = 5; // newest blog posts, on top of the fixed pages
const MAP_CHECKS = 3; // source maps ship for all chunks or none
// Larger tracked files are reported as not scanned (none in Nov 2026; GitHub warns at 50 MB).
const MAX_SCAN_BYTES = 20 * 1024 * 1024;
// www and the default *.azurestaticapps.net host must 301 to the apex (README, Azure custom domains).
const CNAME_HOSTS = list(env.SECWATCH_CNAME_HOSTS || `www.${SITE_HOST}`);
const CNAME_SUFFIXES = list(env.SECWATCH_CNAME_SUFFIXES || ".azurestaticapps.net");

async function get(url, { headers = {} } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9", ...headers },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body, text: body.toString("utf8") };
  } catch (err) {
    return { status: 0, headers: new Headers(), body: Buffer.alloc(0), text: "", error: String(err?.message ?? err) };
  }
}
// No answer at all (network error) or a server error: the probe saw nothing, which is not "fine".
const noAnswer = (r) => r.status === 0 || r.status >= 500;
const httpOf = (r) => (r.status ? `HTTP ${r.status}` : "응답 없음");

const state = { servedNext: null };

// ① Page tampering — injected scripts, fake CAPTCHA, changed ads.txt or outside stylesheet
async function checkPages() {
  const items = [];
  const pages = new Map();
  for (const p of ["/", "/blog/"]) pages.set(p, await get(SITE + p));
  const posts = [...new Set(pages.get("/blog/").text.match(/href="\/blog\/[^"/]+\/"/g) ?? [])]
    .map((h) => h.slice(6, -1))
    .slice(0, POSTS_TO_CHECK);
  if (pages.get("/blog/").status === 200 && !posts.length) {
    items.push({ status: "warn", text: "/blog/ 에서 글 링크를 찾지 못해 글 페이지는 검사 못 함" });
  }
  for (const p of posts) pages.set(p, await get(SITE + p));

  // The site loads no outside scripts at all (no AdSense tag yet): any is a danger.
  const allowScript = new Set([SITE_HOST, ...list(env.SECWATCH_SCRIPT_ALLOW)]);
  const allowStyle = new Set([SITE_HOST, "cdn.jsdelivr.net"]);
  const chunks = new Set();
  const styles = new Set();
  for (const [path, res] of pages) {
    if (res.status !== 200) {
      items.push({ status: noAnswer(res) ? "unknown" : "warn", text: `${path} 응답 ${httpOf(res)}` });
      continue;
    }
    for (const s of scriptTags(res.text)) {
      const issue = scriptSrcItem(s, { base: SITE, allowHosts: allowScript });
      if (issue) items.push({ ...issue, text: `${path} ${issue.text}` });
      if (hostOf(s.src, SITE) === SITE_HOST && s.src.includes("/_next/static/")) chunks.add(new URL(s.src, SITE).href);
    }
    for (const href of stylesheetHrefs(res.text)) {
      const host = hostOf(href, SITE);
      if (host && !allowStyle.has(host)) items.push({ status: "warn", text: `${path} 허용 목록 밖 스타일시트: ${host}` });
      if (host && host !== SITE_HOST) styles.add(new URL(href, SITE).href);
    }
    for (const m of findMarkers(res.text)) items.push({ status: "danger", text: `${path} ${m.label}` });
  }

  let mapChecks = 0;
  let mapExposed = false;
  const failedChunks = [];
  if (!chunks.size && [...pages.values()].some((r) => r.status === 200)) {
    items.push({ status: "unknown", text: "페이지에서 JS 청크(/_next/static/)를 찾지 못해 JS 는 검사 못 함" });
  }
  for (const url of chunks) {
    const res = await get(url);
    if (res.status !== 200) {
      failedChunks.push(res);
      continue;
    }
    state.servedNext ??= nextVersionIn(res.text);
    for (const m of findMarkers(res.text)) items.push({ status: "danger", text: `JS ${url.split("/").pop()}: ${m.label}` });
    if (!mapExposed && mapChecks < MAP_CHECKS) {
      mapChecks++;
      const mapUrl = new URL(url);
      mapUrl.search = "";
      mapUrl.pathname += ".map";
      const map = await get(mapUrl.href);
      mapExposed = map.status === 200 && /"mappings"/.test(map.text);
    }
  }
  if (failedChunks.length) {
    const codes = [...new Set(failedChunks.map(httpOf))].join(", ");
    items.push({ status: "unknown", text: `JS ${chunks.size}개 중 ${failedChunks.length}개 받지 못해 검사 못 함 (${codes})` });
  }
  if (mapExposed) items.push({ status: "warn", text: "JS 소스맵(.map) 공개 — 원본 코드 구조·주석 노출" });

  for (const url of styles) {
    const res = await get(url);
    if (res.status !== 200) {
      items.push({ status: noAnswer(res) ? "unknown" : "warn", text: `외부 스타일시트 ${hostOf(url, SITE)} 응답 ${httpOf(res)}` });
      continue;
    }
    const issue = styleIssue(url, `sha384-${createHash("sha384").update(res.body).digest("base64")}`);
    if (issue) items.push(issue);
  }

  const ads = await get(`${SITE}/ads.txt`);
  const adsIssue = adsTxtIssue(ads.status, ads.text, readFileSync("public/ads.txt", "utf8"));
  if (adsIssue) items.push(adsIssue);

  if (!items.length) {
    items.push({ status: "ok", text: `페이지 ${pages.size}개 · JS ${chunks.size}개 · 외부 스타일시트 ${styles.size}개 검사, 주입 흔적 없음 · ads.txt 저장소와 같음` });
  }
  return category("pages", "① 페이지 변조 (스크립트 주입·ads.txt)", items);
}

// ② Framework and dependency vulnerabilities
async function checkDependencies() {
  const items = [];
  const served = state.servedNext;
  const lock = readFileSync("pnpm-lock.yaml", "utf8").match(/^ {2}next@(\d+\.\d+\.\d+)[:(]/m)?.[1] ?? null;
  if (!served) {
    items.push({ status: "unknown", text: "운영 Next.js 버전을 응답에서 찾지 못함" });
  } else {
    let versions = null;
    try {
      const res = await fetch("https://registry.npmjs.org/next", {
        headers: { accept: "application/vnd.npm.install-v1+json" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) versions = Object.keys((await res.json()).versions ?? {});
    } catch {
      // reported below
    }
    const newest = versions && latestPatch(versions, served);
    if (!versions?.length) items.push({ status: "unknown", text: "npm 레지스트리에서 Next.js 최신 버전 확인 실패" });
    else if (newest && compareVersions(newest, served) > 0) {
      items.push({ status: "warn", text: `운영 Next.js ${served} → 같은 라인 ${newest} 출시됨` });
    }
    if (lock && lock !== served) items.push({ status: "warn", text: `저장소 잠금 파일 ${lock} ≠ 운영 ${served} (배포 안 된 변경)` });
  }
  let raw = "";
  try {
    raw = execFileSync("pnpm", ["audit", "--prod", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    raw = err.stdout ?? ""; // non-zero exit when advisories exist; missing when pnpm itself is missing
  }
  items.push(...auditItems(raw, { staticExport: true }));
  return category("deps", "② 프레임워크·의존성 취약점", items);
}

const txt = async (name, items) => {
  try {
    return await dns.resolveTxt(name);
  } catch (err) {
    if (["ENODATA", "ENOTFOUND"].includes(err.code)) return [];
    items.push({ status: "unknown", text: `${name} TXT 조회 실패 (${err.code ?? err.message})` });
    return null;
  }
};

// ③ Security settings visible from outside, DNS and mail domain
async function checkSurface() {
  const items = [];
  const home = await get(`${SITE}/`);
  if (noAnswer(home)) {
    items.push({ status: "unknown", text: `보안 헤더 확인 불가 (${httpOf(home)})` });
  } else {
    const missing = missingHeaders(home.headers);
    if (missing.length) items.push({ status: "warn", text: `보안 헤더 없음: ${missing.join(", ")} → public/staticwebapp.config.json 의 globalHeaders 에 추가` });
  }

  const silent = [];
  for (const p of ["/.env", "/.env.local", "/.git/HEAD", "/.git/config", "/package.json", "/pnpm-lock.yaml"]) {
    const r = await get(SITE + p);
    if (r.status === 200) items.push({ status: "danger", text: `민감 경로가 열려 있음: ${p}` });
    else if (noAnswer(r)) silent.push(p);
  }
  if (silent.length) items.push({ status: "unknown", text: `민감 경로 확인 불가 (응답 없음·5xx): ${silent.join(", ")}` });

  // Verification stays on: an expired or wrong certificate surfaces as an error code here.
  const probe = await new Promise((resolve) => {
    const sock = tls.connect({ host: SITE_HOST, port: 443, servername: SITE_HOST, timeout: 15000 }, () => {
      const exp = new Date(sock.getPeerCertificate().valid_to);
      sock.end();
      resolve({ days: Math.floor((exp - Date.now()) / 86400000) });
    });
    sock.on("error", (err) => resolve({ error: String(err.code ?? err.message).slice(0, 60) }));
    sock.on("timeout", () => {
      sock.destroy();
      resolve({ error: "timeout" });
    });
  });
  const tlsProblem = tlsItem(probe);
  if (tlsProblem) items.push(tlsProblem);

  const apex = SITE_HOST.split(".").slice(-2).join(".");
  try {
    const ns = await dns.resolveNs(apex);
    // Azure DNS by default; SECWATCH_EXPECTED_NS is a name-server suffix for a zone hosted elsewhere.
    if (!nameServersExpected(ns, env.SECWATCH_EXPECTED_NS)) items.push({ status: "danger", text: `${apex} 네임서버 변경 감지: ${ns.join(", ")}` });
  } catch (err) {
    items.push({ status: "unknown", text: `네임서버 조회 실패 (${err.code ?? err.message})` });
  }

  // Subdomain takeover: a CNAME left pointing at a deleted Static Web App can be claimed by anyone.
  for (const host of CNAME_HOSTS) {
    let cnames = [];
    try {
      cnames = await dns.resolveCname(host);
    } catch (err) {
      if (!["ENODATA", "ENOTFOUND"].includes(err.code)) {
        items.push({ status: "unknown", text: `${host} CNAME 조회 실패 (${err.code ?? err.message})` });
        continue;
      }
    }
    const issue = cnameIssue(cnames, CNAME_SUFFIXES);
    if (issue) {
      items.push({ status: "danger", text: `${host} ${issue}` });
      continue;
    }
    for (const target of cnames) {
      try {
        await dns.lookup(target);
      } catch (err) {
        if (err.code === "ENOTFOUND") items.push({ status: "danger", text: `${host} 의 CNAME 대상이 사라짐 — 남이 같은 이름을 만들어 가로챌 수 있음 (DNS 레코드 정리)` });
        else items.push({ status: "unknown", text: `${host} CNAME 대상 조회 실패 (${err.code ?? err.message})` });
        continue;
      }
      // The default *.azurestaticapps.net host must not serve the site on its own.
      const direct = await get(`https://${target}/`);
      if (noAnswer(direct)) items.push({ status: "unknown", text: `${host} 기본 호스트 확인 불가 (${httpOf(direct)})` });
      else if (!redirectsTo(direct.status, direct.headers.get("location"), SITE_HOST)) {
        items.push({ status: "warn", text: `${host} 의 기본 호스트(*.azurestaticapps.net)가 ${SITE_HOST} 로 301 하지 않음 (${httpOf(direct)})` });
      }
    }
    // www always 301s to the apex. Anything else means someone else may be serving it — a
    // CNAME repointed to another *.azurestaticapps.net app still passes the suffix check above.
    const via = await get(`https://${host}/`);
    if (noAnswer(via)) items.push({ status: "unknown", text: `${host} 확인 불가 (${httpOf(via)})` });
    else if (!redirectsTo(via.status, via.headers.get("location"), SITE_HOST)) {
      items.push({ status: "danger", text: `${host} 가 ${SITE_HOST} 로 301 하지 않음 (${httpOf(via)}) — 다른 앱이 이 주소를 가로챘는지 DNS·Azure 사용자 지정 도메인 확인` });
    }
  }

  // Mail sent as this domain: SPF and DMARC decide whether forged mail in its name gets through.
  const mailDomain = env.SECWATCH_MAIL_DOMAIN || apex;
  const spf = await txt(mailDomain, items);
  const spfProblem = spf && spfIssue(spf);
  if (spfProblem) items.push({ status: "warn", text: `${mailDomain} ${spfProblem}` });
  let dmarc = [];
  for (const name of dmarcNames(mailDomain)) {
    dmarc = await txt(name, items);
    if (dmarc === null || dmarc.length) break;
  }
  const dmarcProblem = dmarc && dmarcIssue(dmarc);
  if (dmarcProblem) items.push({ status: "warn", text: `${mailDomain} ${dmarcProblem}` });

  if (!items.length) items.push({ status: "ok", text: "보안 헤더·민감 경로·인증서·네임서버·CNAME·리다이렉트·메일 도메인 이상 없음" });
  return category("surface", "③ 보안 설정·노출", items);
}

const git = (args) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

// ⑦ Repository and CI supply chain. This repository is public: a committed secret is already
// leaked, and a workflow that runs outside input can hand the repository's secrets (the Static
// Web Apps deploy token) to anyone.
const ALLOW_FILE = "scripts/security-watch/repo-scan-allow.json";

function checkRepo() {
  const items = [];
  const files = git(["ls-files", "-z"]).split("\0").filter((f) => f && !SKIP_FILE.test(f));
  let scanned = 0;
  let binary = 0;
  const tooBig = [];
  for (const f of files) {
    let buf;
    try {
      const st = statSync(f);
      if (!st.isFile()) continue; // submodule
      if (st.size > MAX_SCAN_BYTES) {
        tooBig.push(f);
        continue;
      }
      buf = readFileSync(f);
    } catch {
      continue; // listed in the index but gone from the working tree
    }
    const { text, binary: isBinary } = decodeFile(buf);
    scanned++;
    if (isBinary) binary++;
    for (const h of scanText(text, f)) {
      const where = isBinary ? `${h.file} (바이너리)` : `${h.file}:${h.line}`;
      items.push({ status: h.status, text: `${where} ${h.label} — 공개 저장소라 이미 유출된 것으로 보고 폐기·교체` });
    }
  }
  if (tooBig.length) {
    items.push({ status: "unknown", text: `${MAX_SCAN_BYTES / 1024 / 1024} MB 넘는 파일 ${tooBig.length}개는 비밀 검사 안 함: ${tooBig.slice(0, 3).join(", ")}` });
  }

  // Every commit on every branch, every day: a commit's date says nothing about when it was pushed.
  let commits = 0;
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    items.push({ status: "unknown", text: "얕은 체크아웃이라 커밋 기록을 못 봄 (checkout fetch-depth: 0 필요)" });
  } else {
    const allow = existsSync(ALLOW_FILE) ? JSON.parse(readFileSync(ALLOW_FILE, "utf8")) : [];
    const patch = git(["log", "--all", "--diff-merges=first-parent", "--text", "--no-color", "--no-ext-diff", "--no-renames", "-p", "-U0", `--format=${PATCH_MARKER}%H`]);
    const added = addedText(patch).filter((a) => !SKIP_FILE.test(a.file));
    commits = new Set(added.map((a) => a.commit)).size;
    const found = added.flatMap((a) => scanText(a.text, a.file).map((h) => ({ ...h, commit: a.commit })));
    const allowed = new Set(found.filter((h) => isAllowedHistory(allow, h)).map((h) => h.fingerprint));
    const seen = new Set();
    for (const h of found) {
      if (allowed.has(h.fingerprint) || seen.has(h.fingerprint)) continue;
      seen.add(h.fingerprint);
      items.push({ status: h.status, text: `커밋 ${h.commit.slice(0, 7)} ${h.file} ${h.label} — 나중에 지웠어도 기록에 남음, 폐기·교체 후 ${ALLOW_FILE.split("/").pop()} 에 기록` });
    }
  }

  const dir = ".github/workflows";
  const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const trustedOwners = new Set(list(env.SECWATCH_TRUSTED_ACTION_OWNERS || "actions,github,azure,pnpm").map((o) => o.toLowerCase()));
  for (const f of workflows) items.push(...lintWorkflow(readFileSync(`${dir}/${f}`, "utf8"), `${dir}/${f}`, { trustedOwners }));

  if (!items.length) {
    items.push({ status: "ok", text: `추적 파일 ${scanned}개(바이너리 ${binary}) · 전체 커밋 ${commits}개 · 워크플로 ${workflows.length}개, 비밀·위험 패턴 없음` });
  }
  return category("repo", "⑦ 저장소·CI 공급망", items);
}

async function run(fn, key, title) {
  try {
    return await fn();
  } catch (err) {
    return category(key, title, [{ status: "unknown", text: `점검 실패: ${String(err?.message ?? err).slice(0, 160)}` }]);
  }
}

const categories = [
  await run(checkPages, "pages", "① 페이지 변조 (스크립트 주입·ads.txt)"),
  await run(checkDependencies, "deps", "② 프레임워크·의존성 취약점"),
  await run(checkSurface, "surface", "③ 보안 설정·노출"),
  await run(checkRepo, "repo", "⑦ 저장소·CI 공급망"),
];

const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "";
const payload = buildSlackPayload({ projectName: PROJECT, siteUrl: SITE, date, runUrl, categories });

for (const c of categories) {
  console.log(`[${c.status}] ${c.title}`);
  for (const i of c.items) console.log(`   - [${i.status}] ${i.text}`);
}

if (env.SECWATCH_DRY_RUN === "1") {
  console.log("\n(dry run — Slack not sent)");
} else if (!env.SECWATCH_SLACK_WEBHOOK_URL) {
  // In Actions a missing secret must turn the run red, or the report silently stops arriving.
  console.log("\n::warning::SECWATCH_SLACK_WEBHOOK_URL secret is not set — Slack not sent");
  if (env.GITHUB_ACTIONS === "true") process.exitCode = 1;
} else {
  try {
    const res = await fetch(env.SECWATCH_SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    console.log(`Slack: ${res.status}`);
    if (!res.ok) process.exitCode = 1;
  } catch (err) {
    // Fixed text only: the error can quote the webhook URL, and this log is public.
    console.log(`::warning::Slack post failed (${err?.name ?? "error"})`);
    process.exitCode = 1;
  }
}
if (categories.some((c) => c.status === "danger")) process.exitCode = 2;
