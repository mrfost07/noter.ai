import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// Exercise a running Compose project, not a mock server. All temporary state belongs
// to its named test volume; the caller chooses the Compose project name and cleans up.
const base = process.env.NOTER_TEST_URL || "http://127.0.0.1:8081";
const writeFixtures = process.argv.includes("--write-fixtures");
const compose = (...args) => execFileSync("docker", ["compose", ...args], { encoding: "utf8" }).trim();
const request = (route, options = {}) => fetch(`${base}${route}`, {
  ...options,
  headers: { Connection: "close", ...options.headers },
  signal: AbortSignal.timeout(10000),
});
const get = async (route) => {
  // The smoke test deliberately recreates the server. Do not reuse a pooled
  // connection to the previous container when checking the replacement.
  const response = await request(route);
  assert.equal(response.status, 200, `${route} should be ready`);
  return response;
};
assert.match(await (await get("/healthz")).text(), /Service ready/);
const html = await (await get("/")).text();
assert.match(html, /Noter\.ai/);
const bundle = html.match(/src="([^"]+\.js)"/);
assert.ok(bundle, "fresh frontend HTML should reference a built JavaScript bundle");
await (await get(bundle[1])).arrayBuffer();
const id = compose("ps", "-q", "noter");
assert.ok(id, "the Noter.ai service must exist");
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.Config.User}}", id], { encoding: "utf8" }).trim(), "10001:10001");
assert.equal(compose("exec", "-T", "noter", "sh", "-c", "test -s /data/profile/memos_prod.db && echo initialized"), "initialized");

// Opt in only for a disposable, empty CI profile. Never create a test account on
// an existing installation. Random credentials stay in memory and are not logged.
let verifyPrivateNote;
if (writeFixtures) {
  const profile = await (await get("/api/instance/profile")).json();
  assert.equal(profile.needsSetup, true, "--write-fixtures requires an empty disposable profile");
  const username = `smoke-${randomUUID().slice(0, 12)}`;
  const password = randomUUID();
  const postJSON = async (route, body, token) => {
    const response = await request(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, `${route} should succeed (HTTP ${response.status})`);
    return response.json();
  };
  const user = await postJSON("/api/users", { username, password, email: `${username}@example.test` });
  assert.equal(user.role, "ADMIN");
  const signIn = async () => {
    const result = await postJSON("/api/auth/signin", { passwordCredentials: { username, password } });
    assert.ok(typeof result.accessToken === "string" && result.accessToken.length > 0, "sign-in should issue an access token");
    return result.accessToken;
  };
  const token = await signIn();
  const content = "# Meeting — café\n\n- [ ] Review the recording\n\nKeep **decisions** and [details](https://example.test) intact.";
  // The current notebook API creates owner-private notes and no longer exposes
  // a visibility field. Verify privacy through actual access, not a removed DTO.
  const note = await postJSON(`/api/memos?memoId=${randomUUID()}`, { content }, token);
  assert.equal(note.content, content);
  assert.match(note.name, /^memos\/[A-Za-z0-9_-]+$/);
  const readPrivateNote = async (accessToken) => {
    const response = await request(`/api/${note.name}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    assert.equal(response.status, 200, "authenticated note should survive container recreation");
    const saved = await response.json();
    assert.equal(saved.content, content, "Markdown and Unicode content must round-trip exactly");
    const anonymous = await request(`/api/${note.name}`);
    await anonymous.arrayBuffer();
    assert.ok([401, 403].includes(anonymous.status), "a private note must reject anonymous reads");
  };
  await readPrivateNote(token);
  verifyPrivateNote = async () => {
    assert.equal((await (await get("/api/instance/profile")).json()).needsSetup, false);
    // Both the existing token and a fresh password login must remain usable.
    await readPrivateNote(token);
    await readPrivateNote(await signIn());
  };
}
// A marker proves the mounted library survives recreating the service (not just process restart).
const marker = `/data/library/container-smoke-${randomUUID()}.txt`;
try {
  compose("exec", "-T", "noter", "sh", "-c", `printf 'Noter.ai smoke fixture' > '${marker}'`);
  compose("up", "--detach", "--force-recreate", "--wait", "--wait-timeout", "120");
  assert.equal(compose("exec", "-T", "noter", "cat", marker), "Noter.ai smoke fixture");
  await verifyPrivateNote?.();
} finally {
  compose("exec", "-T", "noter", "rm", "-f", marker);
}
assert.match(await (await get("/healthz")).text(), /Service ready/);
console.log("Noter.ai container verified: database readiness, real frontend/assets, non-root user and persistent library after recreation.");
if (writeFixtures) console.log("Disposable profile verified: account, private Unicode/Markdown note, authentication and access isolation survive recreation.");
