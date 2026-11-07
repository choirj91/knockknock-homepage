import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appServiceIssues,
  corsRisk,
  dmarcIssue,
  gotrueSettingsItems,
  dmarcNames,
  imageProxyState,
  isPostgrestResponse,
  postgresIssues,
  reachesGoTrue,
  spfIssue,
  storageIssues,
} from "./hardening.mjs";

const PROBE = "https://secwatch-probe.invalid";
const statuses = (items) => items.map((i) => i.status);

describe("corsRisk", () => {
  it("flags an API that echoes any Origin with credentials", () => {
    const h = new Headers({ "access-control-allow-origin": PROBE, "access-control-allow-credentials": "true" });
    assert.equal(corsRisk(h, PROBE), "danger");
    assert.equal(corsRisk(new Headers({ "access-control-allow-origin": "null", "access-control-allow-credentials": "true" }), PROBE), "danger");
  });

  it("ignores * with credentials (browsers refuse it — GoTrue sends this) and reflection without credentials", () => {
    assert.equal(corsRisk(new Headers({ "access-control-allow-origin": "*", "access-control-allow-credentials": "true" }), PROBE), null);
    assert.equal(corsRisk(new Headers({ "access-control-allow-origin": PROBE }), PROBE), null);
    assert.equal(corsRisk(new Headers(), PROBE), null);
  });
});

describe("mail domain", () => {
  it("accepts the production SPF and DMARC records (2026-11-06)", () => {
    assert.equal(spfIssue([["v=spf1 include:_spf.google.com include:spf.protection.outlook.com -all"]]), null);
    assert.equal(spfIssue([["v=spf1 include:a.example ", "~all"]]), null); // chunked TXT
    assert.equal(spfIssue([["v=spf1 redirect=_spf.example.com"]]), null);
    assert.equal(dmarcIssue([["v=DMARC1; p=quarantine; adkim=r; aspf=r;"]]), null);
  });

  it("flags missing, permissive or duplicated SPF", () => {
    assert.match(spfIssue([["google-site-verification=x"]]), /없음/);
    assert.match(spfIssue([["v=spf1 +all"]]), /모든 발신 서버/);
    assert.match(spfIssue([["v=spf1 include:a.example ?all"]]), /모든 발신 서버/);
    assert.match(spfIssue([["v=spf1 include:a.example"]]), /-all\/~all 없음/);
    assert.match(spfIssue([["v=spf1 -all"], ["v=spf1 include:a.example -all"]]), /2개 이상/);
  });

  it("looks up DMARC on the mail domain, then its parents", () => {
    assert.deepEqual(dmarcNames("knockknock.company"), ["_dmarc.knockknock.company"]);
    assert.deepEqual(dmarcNames("mail.app.example.co.kr"), [
      "_dmarc.mail.app.example.co.kr",
      "_dmarc.app.example.co.kr",
      "_dmarc.example.co.kr",
      "_dmarc.co.kr",
    ]);
  });

  it("flags a missing DMARC record or p=none", () => {
    assert.match(dmarcIssue([]), /없음/);
    assert.match(dmarcIssue([["v=DMARC1; p=none; rua=mailto:x@example.com"]]), /p=none/);
    assert.match(dmarcIssue([["v=DMARC1; rua=mailto:x@example.com"]]), /p=none/);
  });
});

describe("outside-in app checks", () => {
  it("recognises an exposed PostgREST, but not the app's 404 page", () => {
    assert.ok(isPostgrestResponse(200, '{"swagger":"2.0","info":{}}'));
    assert.ok(isPostgrestResponse(401, '{"code":"PGRST301","message":"JWT"}'));
    assert.equal(isPostgrestResponse(404, "<!DOCTYPE html>"), false);
    assert.equal(isPostgrestResponse(200, "<html>swagger</html>"), false);
  });

  it("treats the optimizer's refusal of an outside host as closed (production, 2026-11-06)", () => {
    assert.equal(imageProxyState(400, '"url" parameter is not allowed', "text/plain"), "closed");
    assert.equal(imageProxyState(404, "", "text/html"), "closed");
    assert.equal(imageProxyState(200, "PNG", "image/png"), "open");
  });

  it("does not guess when a WAF, rate limit or outage hides the answer", () => {
    assert.equal(imageProxyState(403, "Forbidden", "text/html"), null);
    assert.equal(imageProxyState(429, "", "text/plain"), null);
    assert.equal(imageProxyState(502, "", "text/html"), null);
    assert.equal(imageProxyState(200, "<html>", "text/html"), null);
    assert.equal(imageProxyState(0, "", null), null);
  });
});

describe("GoTrue", () => {
  const production = { external: { google: true, email: true, github: false }, disable_signup: false, mailer_autoconfirm: false, phone_autoconfirm: false };

  it("accepts the production settings (2026-11-06)", () => {
    assert.deepEqual(gotrueSettingsItems(production, new Set(["email", "google"])), []);
  });

  it("flags a newly enabled sign-in method and auto-confirm", () => {
    const drifted = { ...production, external: { ...production.external, github: true }, mailer_autoconfirm: true };
    const items = gotrueSettingsItems(drifted, new Set(["email", "google"]));
    assert.deepEqual(statuses(items).sort(), ["danger", "warn"]);
    assert.match(items.find((i) => i.status === "warn").text, /github/);
  });

  it("tells GoTrue's own errors from the middleware block", () => {
    assert.ok(reachesGoTrue(400, '{"code":400,"error_code":"validation_failed","msg":"One of email or phone must be set"}'));
    assert.ok(reachesGoTrue(401, '{"code":401,"error_code":"no_authorization","msg":"This endpoint requires a Bearer token"}'));
    assert.ok(reachesGoTrue(404, '{"code":404,"error_code":"user_not_found","msg":"User not found"}'));
    assert.equal(reachesGoTrue(404, '{"error":"not_found"}'), false);
    assert.equal(reachesGoTrue(404, "404 page not found"), false);
    assert.equal(reachesGoTrue(400, "<html>bad request</html>"), false);
    assert.equal(reachesGoTrue(0, ""), false);
  });
});

describe("Azure hardening", () => {
  it("accepts the production App Service settings (2026-11-06)", () => {
    const cfg = { httpsOnly: true, minTlsVersion: "1.2", scmMinTlsVersion: "1.2", ftpsState: "Disabled", remoteDebuggingEnabled: false };
    assert.deepEqual(appServiceIssues("app-x", cfg), []);
    assert.deepEqual(appServiceIssues("app-x", { ...cfg, minTlsVersion: "1.3", ftpsState: "FtpsOnly" }), []);
  });

  it("flags plain HTTP, old TLS, plain FTP and remote debugging", () => {
    const items = appServiceIssues("app-x", { httpsOnly: false, minTlsVersion: "1.0", scmMinTlsVersion: "1.1", ftpsState: "AllAllowed", remoteDebuggingEnabled: true });
    assert.deepEqual(statuses(items), ["danger", "warn", "warn", "warn", "danger"]);
  });

  it("accepts the production database (20 single-address rules, SSL on, TLS 1.2)", () => {
    const rules = Array.from({ length: 20 }, (_, i) => ({ start: `203.0.113.${i + 1}`, end: `203.0.113.${i + 1}` }));
    assert.deepEqual(postgresIssues("psql-x", { publicNetworkAccess: "Enabled", rules, requireSecureTransport: "on", sslMinProtocol: "TLSv1.2" }), []);
  });

  it("flags allow-all, all-Azure and wide rules without printing addresses", () => {
    const rules = [
      { start: "0.0.0.0", end: "255.255.255.255" },
      { start: "0.0.0.0", end: "0.0.0.0" },
      { start: "198.51.0.0", end: "198.52.255.255" },
    ];
    const items = postgresIssues("psql-x", { publicNetworkAccess: "Enabled", rules, requireSecureTransport: "OFF", sslMinProtocol: "TLSv1.1" });
    assert.deepEqual(statuses(items), ["danger", "warn", "warn", "danger", "warn"]);
    for (const i of items) assert.doesNotMatch(i.text, /\d+\.\d+\.\d+\.\d+/);
  });

  it("treats half the internet as everyone, however the rules are cut", () => {
    const judge = (rules) => statuses(postgresIssues("psql-x", { publicNetworkAccess: "Enabled", rules, requireSecureTransport: "on" }));
    assert.deepEqual(judge([{ start: "0.0.0.0", end: "255.255.255.254" }]), ["danger"]);
    assert.deepEqual(judge([{ start: "0.0.0.0", end: "127.255.255.255" }, { start: "128.0.0.0", end: "255.255.255.255" }]), ["danger"]);
    const quarters = ["0", "64", "128", "192"].map((a) => ({ start: `${a}.0.0.0`, end: `${Number(a) + 63}.255.255.255` }));
    assert.deepEqual(judge(quarters), ["danger", "warn"]); // together everyone; each one also wider than /16
    assert.deepEqual(judge([{ start: "10.0.0.0", end: "10.255.255.255" }, { start: "10.0.0.0", end: "10.255.255.255" }]), ["warn"]); // overlap counted once
    assert.deepEqual(judge([{ start: "0.0.0.0", end: "0.255.255.255" }]), ["warn"]); // wide, starts at 0, not the Azure marker
    assert.deepEqual(judge([{ start: "0.0.0.0", end: "0.0.0.0" }]), ["warn"]); // AllowAllAzureServices only
  });

  it("ignores firewall rules when public network access is off", () => {
    const items = postgresIssues("psql-x", { publicNetworkAccess: "Disabled", rules: [{ start: "0.0.0.0", end: "255.255.255.255" }], requireSecureTransport: "on" });
    assert.deepEqual(items, []);
  });

  it("checks storage accounts", () => {
    assert.deepEqual(storageIssues("st-x", { allowBlobPublicAccess: false, enableHttpsTrafficOnly: true, minimumTlsVersion: "TLS1_2" }), []);
    const items = storageIssues("st-x", { allowBlobPublicAccess: true, enableHttpsTrafficOnly: false, minimumTlsVersion: "TLS1_0" });
    assert.deepEqual(statuses(items), ["warn", "danger", "warn"]);
  });

  it("keeps odd resource names out of the report, but not the Korean labels check.mjs uses", () => {
    const [item] = storageIssues("<script>`x`", { allowBlobPublicAccess: true });
    assert.doesNotMatch(item.text, /[<>`]/);
    assert.match(appServiceIssues("웹앱 #1", { httpsOnly: false })[0].text, /^웹앱 #1: /);
    assert.match(storageIssues("스토리지 #2", { allowBlobPublicAccess: true })[0].text, /^스토리지 #2: /);
  });
});
