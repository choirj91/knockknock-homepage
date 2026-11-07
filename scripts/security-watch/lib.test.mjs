import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSlackPayload,
  category,
  compareVersions,
  findMarkers,
  isAllowedOutbound,
  latestPatch,
  nameServersExpected,
  nextVersionIn,
  postPathFilter,
  readAudit,
  scriptSrcItem,
  scriptTags,
  stylesheetHrefs,
  tlsItem,
  worst,
} from "./lib.mjs";

describe("scriptTags", () => {
  it("flags the unquoted src that the October injection used", () => {
    const html =
      '<script src="/_next/static/chunks/main.js" async=""></script><script src=https://www.googletagmanager.com/gtm.js?id=GTM-PJB7D937></script></head>';
    assert.deepEqual(scriptTags(html), [
      { src: "/_next/static/chunks/main.js", quoted: true },
      { src: "https://www.googletagmanager.com/gtm.js?id=GTM-PJB7D937", quoted: false },
    ]);
  });

  it("ignores inline scripts", () => {
    assert.deepEqual(scriptTags('<script>self.__next_f.push([1,"x"])</script>'), []);
  });

  it("reads a src separated from the tag name by a slash, as browsers do", () => {
    assert.deepEqual(scriptTags("<script/src=//evil.example/x.js></script>"), [{ src: "//evil.example/x.js", quoted: false }]);
    assert.deepEqual(scriptTags('<SCRIPT/SRC="https://evil.example/y.js">'), [{ src: "https://evil.example/y.js", quoted: true }]);
  });

  it("does not stop at a > inside a quoted attribute value", () => {
    const html = `<script data-x="a>b" src="https://evil.example/x.js"></script><script data-y='>' src=/ok.js></script>`;
    assert.deepEqual(scriptTags(html), [
      { src: "https://evil.example/x.js", quoted: true },
      { src: "/ok.js", quoted: false },
    ]);
  });

  it("takes the first src like the browser and ignores lookalike attribute names", () => {
    const html = '<script data-src="https://cdn.example/a.js" src="/first.js" src="https://evil.example/second.js"></script>';
    assert.deepEqual(scriptTags(html), [{ src: "/first.js", quoted: true }]);
  });

  it("decodes character references the browser decodes before loading", () => {
    assert.deepEqual(scriptTags('<script src="https:&#x2F;&#47;evil.example&sol;x.js?a=1&amp;b=2">'), [
      { src: "https://evil.example/x.js?a=1&b=2", quoted: true },
    ]);
  });

  it("skips elements whose name only starts with script and a src without a value", () => {
    assert.deepEqual(scriptTags('<script-loader src="https://cdn.example/a.js"></script-loader><script src></script>'), []);
  });

  it("is not blinded by a decoy tag inside an inline script string", () => {
    const html = `<script>var a='<script b="';</script><script src=https://evil.example/x.js></script><script>var c='"';</script>`;
    assert.ok(scriptTags(html).some((s) => s.src === "https://evil.example/x.js"));
  });

  it("lists a value that overlapping reads share once, as the browser's single tag", () => {
    assert.deepEqual(scriptTags("<script/src=x<script/src=y></script>"), [{ src: "x<script/src=y", quoted: false }]);
  });

  it("stays fast on hostile pages (the regex-free reader must not rescan per tag)", () => {
    const allowHosts = new Set(["site.example"]);
    for (const unit of ["<script a", '<script a="', "<script/n=x", "<script/src=x", '<script a="<script b=\'', "<script src=data:,", '<script src="data:,x"'] ) {
      const page = unit.repeat(Math.ceil(500_000 / unit.length));
      const started = performance.now();
      for (const s of scriptTags(page)) scriptSrcItem(s, { base: "https://site.example", allowHosts });
      const ms = performance.now() - started;
      assert.ok(ms < 1500, `${JSON.stringify(unit)} took ${ms.toFixed(0)} ms`);
    }
  });
});

describe("scriptSrcItem", () => {
  const opts = { base: "https://site.example", allowHosts: new Set(["site.example", "ads.example"]) };
  const judge = (html) => scriptTags(html).map((s) => scriptSrcItem(s, opts));

  it("passes own and allowed scripts", () => {
    assert.deepEqual(judge('<script src="/_next/static/chunks/a.js"></script><script src="https://ads.example/t.js"></script>'), [null, null]);
  });

  it("flags a data: src as danger: the code rides in the attribute, past the host allow list", () => {
    for (const html of [
      '<script src="data:text/javascript,alert(1)"></script>',
      "<script src=data:text/javascript;base64,YWxlcnQoMSk=></script>",
      '<script src=" DATA:,alert(1)"></script>',
      '<script src="da&#x74;a:,alert(1)"></script>',
      '<script src="da&#9;ta:,alert(1)"></script>',
    ]) {
      const [item] = judge(html);
      assert.equal(item?.status, "danger", html);
      assert.match(item.text, /data:/, html);
    }
  });

  it("flags blob: and other non-http(s) schemes as danger, naming the scheme", () => {
    for (const [html, scheme] of [
      ['<script src="blob:https://site.example/0b1c2d3e"></script>', "blob:"],
      ['<script src="javascript:alert(1)"></script>', "javascript:"],
      ['<script src="file:///etc/passwd"></script>', "file:"],
    ]) {
      const [item] = judge(html);
      assert.equal(item?.status, "danger", html);
      assert.ok(item.text.includes(scheme), item.text);
    }
  });

  it("keeps the unquoted-src and allow-list rules", () => {
    assert.match(judge("<script src=https://ads.example/t.js></script>")[0].text, /따옴표 없는 src\): ads\.example$/);
    assert.match(judge('<script src="//evil.example/x.js"></script>')[0].text, /허용 목록 밖 외부 스크립트: evil\.example$/);
    assert.equal(judge("<script src=/ok.js></script>")[0], null);
  });

  it("skips a src the URL parser rejects (the browser cannot load it)", () => {
    assert.equal(judge('<script src="https://[bad"></script>')[0], null);
  });
});

describe("postPathFilter", () => {
  // What KQL's tolower(coalesce(url_decode(name), name)) makes of a logged request name. Checked
  // against App Insights with a datatable of these names on 2026-11-08: url_decode returns a
  // malformed escape unchanged, which decodeURIComponent throws on.
  const asMatched = (name) => {
    let decoded = name;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      decoded = name;
    }
    return decoded.toLowerCase();
  };
  const filter = postPathFilter(["auth/v1/signup", "/auth/v1/otp", "api/auth/signup"]);
  const regex = new RegExp(filter.match(/matches regex @'([^']*)'/)[1]);
  const hits = (name) => /^post /i.test(name) && regex.test(asMatched(name));

  it("lower-cases and decodes the name in KQL, POSTs only, before the regex sees it", () => {
    assert.match(filter, /^where name startswith 'POST ' \| extend (\w+) = tolower\(coalesce\(url_decode\(name\), name\)\) \| where \1 matches regex @'/);
  });

  it("matches upper-case, mixed-case and percent-encoded spellings of a path", () => {
    for (const name of [
      "POST /auth/v1/signup",
      "POST /AUTH/V1/signup",
      "POST /AUTH/V1/SIGNUP",
      "POST /auth/v1/Signup",
      "POST /Auth/V1/Otp",
      "POST /auth/v1/%73ignup",
      "POST /auth/v1/%53IGNUP",
      "POST /%61uth%2Fv1/otp",
      "POST /api/auth/signup",
    ]) {
      assert.ok(hits(name), name);
    }
  });

  it("matches whole paths only", () => {
    for (const name of ["GET /auth/v1/signup", "POST /auth/v1/signup/", "POST /auth/v1/signups", "POST /x/auth/v1/signup", "POST /auth/v1/token", "POST /auth/v1/signup%zz"]) {
      assert.equal(hits(name), false, name);
    }
  });

  it("refuses paths that would need escaping inside the KQL string, and an empty list", () => {
    for (const bad of ["auth/v1/sign'up", "auth/v1/sign.up", "auth/v1/(signup|.*)", "auth//v1", ""]) {
      assert.throws(() => postPathFilter([bad]), /unsupported path/, bad);
    }
    assert.throws(() => postPathFilter([]), /no paths/);
  });
});

describe("readAudit", () => {
  const clean = JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { moderate: 0 } } });

  it("passes a report through", () => {
    assert.deepEqual(readAudit(clean), { audit: JSON.parse(clean) });
  });

  it("reports a failed audit as unknown, not clean, without the registry URL", () => {
    const raw = JSON.stringify({ error: { code: "ECONNREFUSED", message: "request to http://127.0.0.1:1/-/npm/v1/security/audits failed" } });
    const { audit, item } = readAudit(raw);
    assert.equal(audit, undefined);
    assert.equal(item.status, "unknown");
    assert.match(item.text, /ECONNREFUSED/);
    assert.doesNotMatch(item.text, /127\.0\.0\.1|http/);
  });

  it("reports missing or unreadable output as unknown", () => {
    for (const raw of [undefined, "", "{}", "not json", "[]", '{"advisories":{}}', '{"advisories":null,"metadata":{}}', '{"advisories":{},"metadata":{}}']) {
      assert.equal(readAudit(raw).item?.status, "unknown", String(raw));
    }
  });

  it("does not read counts without the advisories behind them as clean", () => {
    const { item } = readAudit(JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { critical: 2, high: 0 } } }));
    assert.equal(item?.status, "unknown");
  });

  it("keeps an odd error code from injecting text", () => {
    const { item } = readAudit(JSON.stringify({ error: { code: "<!channel> http://x" } }));
    assert.doesNotMatch(item.text, /[<>:]/);
  });
});

describe("tlsItem", () => {
  it("treats a bad certificate as danger, not as a failed check", () => {
    for (const code of ["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT"]) {
      assert.equal(tlsItem({ error: code })?.status, "danger", code);
    }
  });

  it("reports a connection failure or an unreadable date as unknown", () => {
    assert.equal(tlsItem({ error: "ECONNRESET" }).status, "unknown");
    assert.equal(tlsItem({ error: "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR" }).status, "unknown");
    assert.equal(tlsItem({ error: "timeout" }).status, "unknown");
    assert.equal(tlsItem({ days: Number.NaN }).status, "unknown");
    assert.equal(tlsItem({}).status, "unknown");
  });

  it("warns before expiry and passes a fresh certificate", () => {
    assert.equal(tlsItem({ days: 6 }).status, "danger");
    assert.equal(tlsItem({ days: 20 }).status, "warn");
    assert.equal(tlsItem({ days: 21 }), null);
  });
});

describe("nameServersExpected", () => {
  const azure = ["ns1-01.azure-dns.com.", "ns2-01.azure-dns.net", "ns3-01.azure-dns.org", "ns4-01.azure-dns.info"];

  it("accepts Azure DNS", () => {
    assert.ok(nameServersExpected(azure));
  });

  it("rejects names that merely contain azure-dns, a mixed set and an empty answer", () => {
    assert.equal(nameServersExpected(["ns1.evil-azure-dns.com"]), false);
    assert.equal(nameServersExpected(["azure-dns.com.evil.net"]), false);
    assert.equal(nameServersExpected([...azure, "ns1.attacker.net"]), false);
    assert.equal(nameServersExpected([]), false);
  });

  it("matches a configured suffix on label boundaries", () => {
    assert.ok(nameServersExpected(["ada.ns.cloudflare.com", "bob.ns.cloudflare.com."], ".ns.cloudflare.com"));
    assert.equal(nameServersExpected(["ada.evilns.cloudflare.com.attacker.net"], "ns.cloudflare.com"), false);
    assert.equal(nameServersExpected(["ada.evilcloudflare.com"], "cloudflare.com"), false);
  });
});

describe("stylesheetHrefs", () => {
  it("reads only stylesheet links", () => {
    const html =
      '<link rel="icon" href="/icon.svg"/><link rel="stylesheet" href="https://fonts.googleapis.com/css2?x"/>';
    assert.deepEqual(stylesheetHrefs(html), ["https://fonts.googleapis.com/css2?x"]);
  });
});

describe("findMarkers", () => {
  it("detects the GTM container and the BSC loader", () => {
    const ids = findMarkers(
      'gtm.js?id=GTM-PJB7D937 var RPC_URLS="https://data-seed-prebsc-1-s1.bnbchain.org:8545/"; method:"eth_call"',
    ).map((m) => m.id);
    assert.deepEqual(ids, ["gtm", "etherhiding"]);
  });

  it("detects a clipboard write that carries a command", () => {
    const ids = findMarkers('navigator.clipboard.writeText("powershell -w h -c iex(irm x)")').map((m) => m.id);
    assert.ok(ids.includes("clipboard-command"));
  });

  it("does not flag a copy-link button", () => {
    assert.deepEqual(findMarkers("await navigator.clipboard.writeText(location.href)"), []);
  });

  it("detects the fake CAPTCHA wording", () => {
    assert.deepEqual(findMarkers("I am not a robot - reCAPTCHA Verification ID: 6876668").map((m) => m.id), ["clickfix-text"]);
  });
});

describe("versions", () => {
  it("reads the Next.js version from a client chunk", () => {
    assert.equal(nextVersionIn('n={version:"15.1.12",appDir:!0}'), "15.1.12");
  });

  it("compares numerically, not as strings", () => {
    assert.equal(compareVersions("15.1.12", "15.1.9"), 1);
    assert.equal(compareVersions("15.1.3", "15.1.12"), -1);
  });

  it("finds the newest stable patch on the same line", () => {
    const versions = ["15.1.3", "15.1.12", "15.1.13", "15.2.0", "15.1.14-canary.1", "16.0.0"];
    assert.equal(latestPatch(versions, "15.1.12"), "15.1.13");
  });
});

describe("isAllowedOutbound", () => {
  const allow = ["127.0.0.1", "*.googleapis.com"];
  it("allows the sidecar on any port and allowed suffixes", () => {
    assert.ok(isAllowedOutbound("127.0.0.1:9999", allow));
    assert.ok(isAllowedOutbound("admin.googleapis.com", allow));
  });
  it("flags the exfiltration host from October", () => {
    assert.equal(isAllowedOutbound("env.qusaeri.com", allow), false);
  });
});

describe("report", () => {
  it("takes the worst status", () => {
    assert.equal(worst(["ok", "warn", "unknown"]), "warn");
    assert.equal(worst(["ok", "danger", "warn"]), "danger");
    assert.equal(worst([]), "ok");
  });

  it("lists dangers first and drops duplicate lines", () => {
    const c = category("x", "X", [
      { status: "ok", text: "a" },
      { status: "danger", text: "b" },
      { status: "danger", text: "b" },
    ]);
    assert.equal(c.status, "danger");
    assert.deepEqual(c.items.map((i) => i.text), ["b", "a"]);
  });

  it("builds one Slack section per category and caps long lists", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ status: "warn", text: `item ${i}` }));
    const payload = buildSlackPayload({
      siteUrl: "https://example.test",
      date: "2026-10-24",
      runUrl: "",
      categories: [category("a", "A", items), category("b", "B", [{ status: "ok", text: "fine" }])],
    });
    const sections = payload.blocks.filter((b) => b.type === "section");
    assert.equal(sections.length, 3); // summary + 2 categories
    assert.match(sections[1].text.text, /외 3건/);
    assert.match(payload.text, /주의/);
  });

  it("names the project in the header and the notification so several projects can share a channel", () => {
    const categories = [category("a", "A", [{ status: "danger", text: "x" }])];
    const mine = buildSlackPayload({ siteUrl: "https://example.test", date: "2026-11-07", runUrl: "", categories });
    assert.equal(mine.blocks[0].text.text, "🛡️ Tester Match 보안 점검 2026-11-07");
    const other = buildSlackPayload({ projectName: "Knock Knock", siteUrl: "https://example.test", date: "2026-11-07", runUrl: "", categories });
    assert.equal(other.blocks[0].text.text, "🛡️ Knock Knock 보안 점검 2026-11-07");
    assert.equal(other.text, "🔴 Knock Knock 보안 점검 2026-11-07: 위험");
  });

  it("escapes item text so a committed file name cannot ping the channel or fake a link", () => {
    const categories = [category("repo", "R", [{ status: "danger", text: "커밋 abc1234 <!channel>&<https://evil.test|x>.env 개인 키" }])];
    const { blocks } = buildSlackPayload({ siteUrl: "https://example.test", date: "2026-11-07", runUrl: "", categories });
    const line = blocks.at(-1).text.text;
    assert.doesNotMatch(line, /<!channel>|<https:/);
    assert.match(line, /&lt;!channel&gt;&amp;&lt;https:\/\/evil\.test\|x&gt;/);
  });
});
