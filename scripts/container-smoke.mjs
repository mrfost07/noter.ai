import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// Exercise a running Compose project, not a mock server. All temporary state belongs
// to its named test volume; the caller chooses the Compose project name and cleans up.
const base = process.env.NOTER_TEST_URL || "http://127.0.0.1:8081";
const compose = (...args) => execFileSync("docker", ["compose", ...args], { encoding: "utf8" }).trim();
const get = async (route) => {
  const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `${route} should be ready`);
  return response;
};
assert.match(await (await get("/healthz")).text(), /Service ready/);
const html = await (await get("/")).text();
assert.match(html, /Noter\.ai/);
const bundle = html.match(/src="([^"]+\.js)"/);
assert.ok(bundle, "fresh frontend HTML should reference a built JavaScript bundle");
await get(bundle[1]);
const id = compose("ps", "-q", "noter");
assert.ok(id, "the Noter.ai service must exist");
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.Config.User}}", id], { encoding: "utf8" }).trim(), "10001:10001");
assert.equal(compose("exec", "-T", "noter", "sh", "-c", "test -s /data/profile/memos_prod.db && echo initialized"), "initialized");
// A marker proves the mounted library survives recreating the service (not just process restart).
const marker = `/data/library/container-smoke-${randomUUID()}.txt`;
try {
  compose("exec", "-T", "noter", "sh", "-c", `printf 'Noter.ai smoke fixture' > '${marker}'`);
  compose("up", "--detach", "--force-recreate", "--wait", "--wait-timeout", "120");
  assert.equal(compose("exec", "-T", "noter", "cat", marker), "Noter.ai smoke fixture");
} finally {
  compose("exec", "-T", "noter", "rm", "-f", marker);
}
assert.match(await (await get("/healthz")).text(), /Service ready/);
console.log("Noter.ai container verified: database readiness, real frontend/assets, non-root user and persistent library after recreation.");
