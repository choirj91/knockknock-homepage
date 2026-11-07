import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { adsTxtIssue, auditItems, cnameIssue, missingHeaders, PINNED_STYLES, redirectsTo, styleIssue } from "./site.mjs";

const statuses = (items) => items.map((i) => i.status);
const advisory = (module_name, severity, patched) => ({ module_name, severity, title: `${module_name} ${severity}`, patched_versions: patched });
// `pnpm audit --prod --json` stdout, as check.mjs passes it.
const audit = (advisories, vulnerabilities = {}) =>
  JSON.stringify({
    advisories: Object.fromEntries(advisories.map((a, i) => [i, a])),
    metadata: { vulnerabilities },
  });

describe("auditItems", () => {
  it("reports framework advisories on a static export as an upgrade warning with the fixing version (2026-11-07: next 15.1.3)", () => {
    const items = auditItems(
      audit([advisory("next", "critical", ">=15.1.9"), advisory("next", "high", ">=15.5.28"), advisory("next", "moderate", ">=15.5.16"), advisory("postcss", "high", ">=8.5.12")], { moderate: 1 }),
      { staticExport: true },
    );
    assert.deepEqual(statuses(items), ["warn", "warn"]);
    assert.match(items[0].text, /2건/);
    assert.match(items[0].text, /15\.5\.28 이상/);
    assert.match(items[0].text, /정적 사이트/);
    assert.match(items[1].text, /postcss/);
  });

  it("keeps framework advisories as danger when a server runs them", () => {
    assert.deepEqual(statuses(auditItems(audit([advisory("next", "high", ">=15.5.28")]), { staticExport: false })), ["danger"]);
  });

  it("treats a critical advisory outside the framework as danger either way", () => {
    const items = auditItems(audit([advisory("marked", "critical", ">=18.0.12")]), { staticExport: true });
    assert.deepEqual(statuses(items), ["danger"]);
    assert.match(items[0].text, /marked/);
  });

  it("falls back to moderate counts, then to ok", () => {
    assert.deepEqual(statuses(auditItems(audit([advisory("x", "moderate", ">=1.0.1")], { moderate: 1 }), { staticExport: true })), ["warn"]);
    assert.deepEqual(statuses(auditItems(audit([], {}), { staticExport: true })), ["ok"]);
  });

  it("keeps client-side react advisories at full weight on a static site", () => {
    assert.deepEqual(statuses(auditItems(audit([advisory("react-dom", "critical", ">=19.0.1")]), { staticExport: true })), ["danger"]);
  });

  it("reports an audit that did not run as unknown, never as clean", () => {
    const registryDown = JSON.stringify({ error: { code: "ECONNREFUSED", summary: "request to http://127.0.0.1:1/ failed" } });
    for (const broken of [registryDown, "{}", "", undefined, "not json", JSON.stringify({ advisories: {} })]) {
      const items = auditItems(broken, { staticExport: true });
      assert.deepEqual(statuses(items), ["unknown"], String(broken));
    }
    assert.match(auditItems(registryDown, { staticExport: true })[0].text, /ECONNREFUSED/);
    assert.doesNotMatch(auditItems(registryDown, { staticExport: true })[0].text, /127\.0\.0\.1/);
  });

  it("does not report counts without the advisories behind them as a moderate warning", () => {
    assert.deepEqual(statuses(auditItems(audit([], { moderate: 3 }), { staticExport: true })), ["unknown"]);
  });
});

describe("adsTxtIssue", () => {
  const committed = "google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\n";

  it("accepts the served file when it matches the repository copy, ignoring line endings and blank lines", () => {
    assert.equal(adsTxtIssue(200, committed.replace("\n", "\r\n\r\n"), committed), null);
  });

  it("flags a changed seller list as danger (ad revenue sent elsewhere)", () => {
    const served = committed.replace("0000000000000000", "1111111111111111");
    assert.equal(adsTxtIssue(200, served, committed).status, "danger");
  });

  it("does not guess when the file is missing or the site does not answer", () => {
    assert.equal(adsTxtIssue(404, "", committed).status, "warn");
    assert.equal(adsTxtIssue(0, "", committed).status, "unknown");
    assert.equal(adsTxtIssue(503, "", committed).status, "unknown");
  });
});

describe("styleIssue", () => {
  const url = Object.keys(PINNED_STYLES)[0];

  it("pins the stylesheet app/layout.tsx actually loads", () => {
    const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
    assert.ok(layout.includes(url), "PINNED_STYLES must list the stylesheet URL in app/layout.tsx");
  });

  it("passes the pinned hash, flags a changed body as danger and an unpinned sheet as warn", () => {
    assert.equal(styleIssue(url, PINNED_STYLES[url]), null);
    assert.equal(styleIssue(url, "sha384-AAAA").status, "danger");
    const other = styleIssue("https://cdn.example.test/x.css", "sha384-AAAA");
    assert.equal(other.status, "warn");
    assert.match(other.text, /cdn\.example\.test/);
  });
});

describe("headers, DNS and redirects", () => {
  it("lists missing security headers (production 2026-11-07: CSP and X-Frame-Options)", () => {
    const production = new Headers({ "strict-transport-security": "max-age=10886400", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
    assert.deepEqual(missingHeaders(production), ["CSP", "X-Frame-Options"]);
    const fixed = new Headers({ "content-security-policy": "frame-ancestors 'none'", "strict-transport-security": "max-age=1", "x-content-type-options": "nosniff" });
    assert.deepEqual(missingHeaders(fixed), []); // frame-ancestors stands in for X-Frame-Options
  });

  it("checks that a CNAME still points at the expected hosting", () => {
    assert.equal(cnameIssue(["gentle-x.4.azurestaticapps.net"], [".azurestaticapps.net"]), null);
    assert.match(cnameIssue(["evil.example.net"], [".azurestaticapps.net"]), /evil\.example\.net/);
    assert.match(cnameIssue([], [".azurestaticapps.net"]), /CNAME 없음/);
  });

  it("accepts only a permanent redirect to the apex", () => {
    assert.ok(redirectsTo(301, "https://knockknock.company/", "knockknock.company"));
    assert.ok(redirectsTo(308, "https://knockknock.company/blog/", "knockknock.company"));
    assert.equal(redirectsTo(302, "https://knockknock.company/", "knockknock.company"), false);
    assert.equal(redirectsTo(301, "https://knockknock.company.evil.test/", "knockknock.company"), false);
    assert.equal(redirectsTo(200, null, "knockknock.company"), false);
    assert.equal(redirectsTo(301, "not a url", "knockknock.company"), false);
  });
});
