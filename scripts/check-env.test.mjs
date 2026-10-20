import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkEnvironment, checkRepository, documentedEnvironment, sourceEnvironment } from "./check-env.mjs";

test("finds Go/Viper, JavaScript, Rust and Compose environment reads", () => {
  assert.deepEqual(sourceEnvironment("main.go", 'os.Getenv("DIRECT"); os.LookupEnv("OPTIONAL"); viper.SetEnvPrefix("memos"); viper.AutomaticEnv(); viper.GetString("instance-url")'), ["DIRECT", "MEMOS_INSTANCE_URL", "OPTIONAL"]);
  assert.deepEqual(sourceEnvironment("build.mjs", `process.env.BUILD; process.env["BRACKET"]; process.env['OTHER']`), ["BRACKET", "BUILD", "OTHER"]);
  assert.deepEqual(sourceEnvironment("main.rs", 'env::var("NOTER_PORT"); std::env::var_os("NOTER_DATA_DIR"); env::var_os(\nif cfg!(target_os="windows") {\n "USERPROFILE"\n } else {\n "HOME"\n })'), ["HOME", "NOTER_DATA_DIR", "NOTER_PORT", "USERPROFILE"]);
  assert.deepEqual(sourceEnvironment("compose.yaml", '${NOTER_PORT:-8081} ${COMPOSE_OPTION}'), ["COMPOSE_OPTION", "NOTER_PORT"]);
  assert.deepEqual(sourceEnvironment("entrypoint.sh", 'MEMOS_UID=${MEMOS_UID:-10001}\nfile_env "MEMOS_DSN"\nLOCAL=${LOCAL:-1}'), ["MEMOS_DSN", "MEMOS_DSN_FILE", "MEMOS_UID"]);
});

test("requires new application variables while excluding individually documented OS/CI settings", () => {
  const files = [{ filename: "server/config.go", text: 'os.Getenv("NEW_SETTING"); os.Getenv("ProgramData")' },
    { filename: "desktop/build.mjs", text: "process.env.CI; process.env.NEW_RELEASE_SETTING" }];
  assert.deepEqual(checkEnvironment(files, "# NEW_SETTING=\n").missing, [{ name: "NEW_RELEASE_SETTING", sources: ["desktop/build.mjs"] }]);
  assert.equal(checkEnvironment(files, "# NEW_SETTING=\n# NEW_RELEASE_SETTING=\n").missing.length, 0);
  assert.deepEqual([...documentedEnvironment("# Meaningful comment\n# NAME=\nACTIVE=value\n")], ["NAME", "ACTIVE"]);
});

test("ignores generated bindings and test fixture strings, without exempting maintained source", () => {
  const files = ["proto/gen/api/config.go", "web/src/types/proto/config.ts", "scripts/check-env.test.mjs", "store/config_test.go", "web/tests/config.test.tsx"]
    .map((filename) => ({ filename, text: 'os.Getenv("FIXTURE"); process.env.FIXTURE' }));
  files.push({ filename: "provider/config.go", text: 'os.Getenv("REAL_CONFIG")' });
  assert.deepEqual(checkEnvironment(files, "").missing, [{ name: "REAL_CONFIG", sources: ["provider/config.go"] }]);
});

test("repository check and CLI fail on real undocumented source drift without reading private .env", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "noter-env-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true });
  writeFileSync(path.join(root, ".gitignore"), ".env\n", "utf8");
  writeFileSync(path.join(root, ".env"), "PRIVATE_VALUE=do-not-read\n", "utf8");
  writeFileSync(path.join(root, ".env.example"), "# KNOWN=\n", "utf8");
  writeFileSync(path.join(root, "config.go"), 'package app\nvar value = os.Getenv("ADDED_LATER")\n', "utf8");
  mkdirSync(path.join(root, "scripts"));
  const script = path.join(root, "scripts/check-env.mjs");
  writeFileSync(script, readFileSync(fileURLToPath(new URL("check-env.mjs", import.meta.url)), "utf8"), "utf8");
  execFileSync("git", ["add", ".gitignore", ".env.example", "config.go", "scripts/check-env.mjs"], { cwd: root, windowsHide: true });
  assert.deepEqual(checkRepository(root).missing, [{ name: "ADDED_LATER", sources: ["config.go"] }]);
  const failed = spawnSync(process.execPath, [script], { encoding: "utf8", windowsHide: true });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Undocumented environment variable ADDED_LATER: config.go/);
  assert.ok(!failed.stderr.includes("do-not-read"));
  writeFileSync(path.join(root, ".env.example"), "# ADDED_LATER=\n", "utf8");
  assert.equal(checkRepository(root).missing.length, 0);
  assert.equal(readFileSync(path.join(root, ".env"), "utf8"), "PRIVATE_VALUE=do-not-read\n");
  const cli = spawnSync(process.execPath, [script], { encoding: "utf8", windowsHide: true });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Environment documentation covers/);
});
