import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addedText, decodeFile, isAllowedHistory, lintWorkflow, PATCH_MARKER, patchPath, scanText } from "./repo-scan.mjs";

// Fake secrets are assembled at runtime: ⑦ scans this file too, and its source must stay clean.
const j = (...parts) => parts.join("");
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => j(b64url({ alg: "HS256", typ: "JWT" }), ".", b64url(payload), ".", "s".repeat(43));
const ids = (text) => scanText(text, "f").map((h) => h.id);

describe("scanText", () => {
  it("finds each kind of secret with its line number", () => {
    const cases = {
      "private-key": j("-----BEGIN ", "PRIVATE KEY-----\n", "M".repeat(64), "\n-----END PRIVATE KEY-----"),
      "azure-storage-key": j("DefaultEndpointsProtocol=https;AccountName=x;Account", "Key=", "A".repeat(86), "=="),
      "azure-access-key": j("endpoint=https://x.communication.azure.com/;access", "key=", "B".repeat(86), "=="),
      "azure-sas": j("https://x.blob.core.windows.net/c?s", "v=2024-11-04&ss=b&srt=o&sp=r&si", "g=", "C".repeat(43), "%3D"),
      "slack-webhook": j("https://hooks.slack", ".com/services/", "T0123ABCD/", "B0123ABCD/", "abcdEFGHijklMNOPqrstUVWX"),
      "github-token": j("gh", "p_", "a1B2".repeat(9)),
      "aws-key": j("AK", "IA", "ABCDEFGHIJKLMNOP"),
      "payment-live-key": j("live_", "sk_", "a".repeat(20)),
      "llm-key": j("sk-", "ant-", "a".repeat(80)),
      "sendgrid-key": j("S", "G.", "a".repeat(22), ".", "b".repeat(43)),
      "privileged-jwt": jwt({ iss: "supabase", role: "service_role" }),
      "db-url-password": j("postgres", "ql://", "tmadmin:", "Zq8vL2mN4pR7", "@psql-x.postgres.database.azure.com:5432/postgres"),
      "google-api-key": j("AI", "za", "B".repeat(35)),
      "appinsights-key": j("Instrumentation", "Key=", "0123abcd-0123-4abc-8def-0123456789ab"),
    };
    for (const [id, secret] of Object.entries(cases)) {
      const hits = scanText(`line one\nconst x = "${secret}";\n`, "src/x.ts");
      assert.deepEqual(hits.map((h) => [h.id, h.line]), [[id, 2]], id);
    }
  });

  it("reads a PEM key stored with \\n escapes (JSON, env files)", () => {
    assert.deepEqual(ids(j('{"private_key":"-----BEGIN ', "PRIVATE KEY-----", "\\n", "M".repeat(64), '"}')), ["private-key"]);
  });

  it("does not flag code that only handles keys, placeholders, local URLs or the public anon JWT", () => {
    const clean = [
      j("// pem: -----BEGIN ", "PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----"),
      j('.replace(/-----BEGIN ', 'PRIVATE KEY-----/g, "")'),
      j("postgres", "://supabase_auth_admin:$AUTH_ADMIN_PASSWORD@$LOCAL_PGHOST:$LOCAL_PGPORT/db"),
      j("postgres", "ql://postgres:postgres@127.0.0.1:54322/postgres"),
      j("postgres", "://app:${DB_PASSWORD}@db.example.com/app"),
      j("postgres", "://user:<password>@host/db"),
      j("postgres", "ql://postgres:[YOUR-PASSWORD]@db.abcdefgh.supabase.co:5432/postgres"), // Supabase dashboard
      j("postgres", "://user:your_password@db.example.com/db"),
      j("postgres", "://postgres:your-super-", "secret-and-long-postgres-", "password@db:5432/postgres"), // Supabase .env.example
      j("postgres", "://app:Zq8vL2mN4pR7@supabase-db:5432/postgres"), // compose service name, no dot
      j("postgres", "://app:Zq8vL2mN4pR7@[::1]:5432/postgres"),
      jwt({ iss: "supabase", role: "anon" }),
    ].join("\n");
    assert.deepEqual(scanText(clean, "f"), []);
  });

  it("still flags a real password on a host that only looks local, or one that starts with $ or <", () => {
    assert.deepEqual(ids(j("postgres", "://u:Real123456@localhost.evil.com/x")), ["db-url-password"]);
    assert.deepEqual(ids(j("postgres", "://u:$Rk9vQ2xLp@db.example.com/x")), ["db-url-password"]);
    assert.deepEqual(ids(j("postgres", "://u:<Rk9vQ2xLp@203.0.113.7/x")), ["db-url-password"]);
    assert.deepEqual(ids(j("postgres", "://u:Passw0rd2024xyz@db.prod.example.com/x")), ["db-url-password"]); // contains a word, is not one
    assert.deepEqual(ids(j("postgres", "://u:Xk9", "secret", "Q7zL@db.prod.example.com/x")), ["db-url-password"]);
    assert.deepEqual(ids(j("postgres", "://u:p@ssw0rdReal@db.prod.example.com/x")), ["db-url-password"]); // unencoded @
  });

  it("stays linear on long adversarial input (no catastrophic backtracking)", () => {
    for (const unit of [j("postgres", "://a:"), j("postgres", "://"), "?sv=2024-01-01&", "eyJ", "x".repeat(63) + "\n", "-----BEGIN PRIVATE KEY-----"]) {
      const text = unit.repeat(Math.ceil(200_000 / unit.length));
      const t0 = performance.now();
      scanText(text, "f");
      assert.ok(performance.now() - t0 < 1000, `${JSON.stringify(unit.slice(0, 20))} took ${Math.round(performance.now() - t0)} ms`);
    }
  });

  it("gives the same secret the same fingerprint, so a commit and its merge count once", () => {
    const key = j("AK", "IA", "ABCDEFGHIJKLMNOP");
    const [a] = scanText(`x ${key}`, "a.ts");
    const [b] = scanText(`\n\ny = "${key}"`, "a.ts");
    const [c] = scanText(j("AK", "IA", "ZZZZEFGHIJKLMNOP"), "a.ts");
    assert.equal(a.fingerprint, b.fingerprint);
    assert.notEqual(a.fingerprint, c.fingerprint);
    assert.doesNotMatch(a.fingerprint, /AKIA/);
  });

  it("keeps the scanner's own sources and tests clean", () => {
    for (const f of ["repo-scan.mjs", "repo-scan.test.mjs", "hardening.test.mjs"]) {
      assert.deepEqual(scanText(readFileSync(new URL(f, import.meta.url), "utf8"), f), [], f);
    }
  });
});

describe("decodeFile", () => {
  const key = j("AK", "IA", "ABCDEFGHIJKLMNOP");

  it("reads text, UTF-16 and binary files alike, so renaming a file does not hide a secret", () => {
    assert.deepEqual(decodeFile(Buffer.from(`k=${key}`)), { text: `k=${key}`, binary: false });
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`k=${key}`, "utf16le")]);
    assert.deepEqual(ids(decodeFile(le).text), ["aws-key"]);
    const be = Buffer.from(le.subarray(2));
    be.swap16();
    assert.deepEqual(ids(decodeFile(Buffer.concat([Buffer.from([0xfe, 0xff]), be])).text), ["aws-key"]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]), Buffer.from(` ${key} `), Buffer.from([0, 0xff])]);
    const decoded = decodeFile(png);
    assert.equal(decoded.binary, true);
    assert.deepEqual(ids(decoded.text), ["aws-key"]);
  });
});

describe("isAllowedHistory", () => {
  const allow = [{ commit: "abc1234", file: "old.env", rule: "aws-key", rotated: "2026-11-06" }];

  it("silences only the listed commit, file and rule, and only with a rotation date", () => {
    assert.ok(isAllowedHistory(allow, { commit: "abc1234ffff", file: "old.env", id: "aws-key" }));
    assert.equal(isAllowedHistory(allow, { commit: "abc1234ffff", file: "old.env", id: "github-token" }), false);
    assert.equal(isAllowedHistory(allow, { commit: "abc1234ffff", file: "new.env", id: "aws-key" }), false);
    assert.equal(isAllowedHistory(allow, { commit: "def5678ffff", file: "old.env", id: "aws-key" }), false);
    assert.equal(isAllowedHistory([{ ...allow[0], rotated: "" }], { commit: "abc1234ffff", file: "old.env", id: "aws-key" }), false);
    assert.equal(isAllowedHistory([{ ...allow[0], commit: "abc" }], { commit: "abc1234ffff", file: "old.env", id: "aws-key" }), false);
    assert.equal(isAllowedHistory(undefined, { commit: "abc1234ffff", file: "old.env", id: "aws-key" }), false);
  });
});

describe("patchPath", () => {
  it("reads plain, spaced, quoted and non-ASCII names the way the allow list and SKIP_FILE expect", () => {
    assert.equal(patchPath("+++ b/src/x.ts"), "src/x.ts");
    assert.equal(patchPath("+++ b/a b.txt\t"), "a b.txt");
    assert.equal(patchPath('+++ "b/\\354\\202\\254\\354\\227\\205.md"'), "사업.md"); // core.quotepath=true
    assert.equal(patchPath('+++ "b/say \\"hi\\".txt"'), 'say "hi".txt');
    assert.equal(patchPath("+++ b/01-source/bp/사업계획서.md"), "01-source/bp/사업계획서.md");
  });
});

describe("addedText", () => {
  it("collects added lines per commit and file, and is not fooled by an added '++' line", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const patch = [
      `${PATCH_MARKER}${a}`,
      "",
      "diff --git a/x.env b/x.env",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/x.env",
      "@@ -0,0 +1,2 @@",
      "+TOKEN=abc",
      "+++ not a header",
      `${PATCH_MARKER}${b}`,
      "",
      "diff --git a/old.txt b/old.txt",
      "deleted file mode 100644",
      "--- a/old.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
    ].join("\n");
    assert.deepEqual(addedText(patch), [{ commit: a, file: "x.env", text: "TOKEN=abc\n++ not a header\n" }]);
  });
});

describe("lintWorkflow", () => {
  const TRUSTED = new Set(["actions", "github", "azure", "pnpm", "supabase"]);
  const lint = (lines) => lintWorkflow(lines.join("\n"), "wf.yml", { trustedOwners: TRUSTED });
  const job = ["jobs:", "  t:", "    runs-on: ubuntu-latest", "    steps:"];

  it("passes this repository's workflows", () => {
    const dir = new URL("../../.github/workflows/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
      assert.deepEqual(lintWorkflow(readFileSync(new URL(f, dir), "utf8"), f, { trustedOwners: TRUSTED }), [], f);
    }
  });

  it("flags a pull_request_target that checks out the PR head (pwn request)", () => {
    const items = lint(["on: pull_request_target", ...job, "      - uses: actions/checkout@v4", "        with:", "          ref: ${{ github.event.pull_request.head.sha }}", "      - run: npm test"]);
    assert.deepEqual(items.map((i) => i.status), ["danger"]);
    assert.deepEqual(lint(["on: pull_request_target", ...job, "      - run: echo hi"]).map((i) => i.status), ["warn"]);
  });

  it("flags outside input pasted into run, but not the env pattern or a comment", () => {
    const inline = lint(["on: pull_request", ...job, '      - run: echo "${{ github.event.pull_request.title }}"']);
    assert.deepEqual(inline.map((i) => i.status), ["danger"]);
    const block = lint(["on: issues", ...job, "      - name: x", "        run: |", "          echo start", '          echo "${{ github.event.issue.body }}"']);
    assert.match(block[0].text, /wf\.yml:\d+ run/);
    const safe = lint([
      "on: pull_request",
      ...job,
      "      - env:",
      "          TITLE: ${{ github.event.pull_request.title }}",
      '        run: echo "$TITLE"',
      '      # run: echo "${{ github.head_ref }}"',
    ]);
    assert.deepEqual(safe, []);
  });

  it("flags free-text fields only: numbers and SHAs are safe, a quoted # does not hide the rest", () => {
    const run = (expr) => lint(["on: pull_request", ...job, `      - run: ${expr}`]).map((i) => i.status);
    assert.deepEqual(run('echo "${{ github.event.pull_request.number }} ${{ github.event.pull_request.head.sha }}"'), []);
    assert.deepEqual(run('echo "x #" ${{ github.event.issue.title }}'), ["danger"]);
    assert.deepEqual(run("echo '${{ toJSON(github.event) }}'"), ["danger"]);
    assert.deepEqual(run('echo "${{ github.event.head_commit.message }}"'), ["danger"]);
    assert.deepEqual(run('echo "${{ github.event.commits[0].author.name }}"'), ["danger"]);
    assert.deepEqual(run('echo "${{ github.head_ref }}"'), ["danger"]);
    assert.deepEqual(run("echo \"${{ format('{0}', github.event.issue.title) }}\""), ["danger"]);
    assert.deepEqual(run("echo \"${{ github['event']['pull_request']['title'] }}\""), ["danger"]);
  });

  it("checks shell comments inside run blocks too: Actions substitutes ${{ }} before the shell runs", () => {
    const items = lint(["on: issues", ...job, "      - run: |", "          # ${{ github.event.issue.title }}", "          echo ok"]);
    assert.deepEqual(items.map((i) => i.status), ["danger"]);
  });

  it("asks for SHA pins on third-party actions and flags branch refs for everyone", () => {
    const items = lint([
      "on: push",
      ...job,
      "      - uses: tj-actions/changed-files@v45",
      "      - uses: tj-actions/changed-files@0123456789abcdef0123456789abcdef01234567",
      "      - uses: actions/checkout@main",
      "      - uses: actions/setup-node@v4",
      "      - uses: ./.github/actions/local",
      "      - uses: docker://alpine:3.20",
    ]);
    assert.deepEqual(items.map((i) => i.status), ["warn", "warn"]);
    assert.match(items[0].text, /tj-actions\/changed-files@v45/);
    assert.match(items[1].text, /actions\/checkout 를 브랜치\(main\)/);
  });

  it("flags write-all and self-hosted runners on pull requests", () => {
    assert.deepEqual(lint(["on: push", "permissions: write-all", ...job, "      - run: echo"]).map((i) => i.status), ["warn"]);
    const selfHosted = lint(["on: pull_request", "jobs:", "  t:", "    runs-on: [self-hosted, linux]", "    steps:", "      - run: make"]);
    assert.deepEqual(selfHosted.map((i) => i.status), ["danger"]);
  });
});
