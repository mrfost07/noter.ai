import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCommitIdentity, assertTemporaryExtraction, assertVersions, desktopOAuthPayload, launchSmoke, run, serverVersion, sha256, smokeCommand, targetConfig, targets, validateVersion, verifyAll, verifySmokeProfile } from "./build-desktop.mjs";

const version = "26.10.15-rc.1";
const commit = "a".repeat(40);
const sidecarHash = "b".repeat(64);

async function cleanup(root) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("noter-"));
  await rm(root, { recursive: true, force: true });
}

test("only bounded release candidates are accepted, with Go calendar formatting", () => {
  assert.equal(validateVersion(version), version);
  assert.equal(serverVersion("27.1.5-rc.2"), "27.01.5-rc.2");
  for (const invalid of ["26.10.15", "26.01.15-rc.1", "26.13.15-rc.1", "26.10.65536-rc.1", "26.10.15-rc.0", "26.10.15-rc.1;echo unsafe"]) {
    assert.throws(() => validateVersion(invalid));
  }
});

test("foreign or unrecognized targets cannot bypass native package verification", () => {
  assert.equal(targetConfig("aarch64-apple-darwin", "darwin", "arm64").goarch, "arm64");
  assert.throws(() => targetConfig("aarch64-apple-darwin", "darwin", "x64"));
  assert.throws(() => targetConfig("universal-apple-darwin", "darwin", "arm64"));
});

test("failed subprocesses stop the build", () => {
  assert.throws(() => run(process.execPath, ["-e", "process.exit(7)"], { capture: true }), /exited 7/);
});

test("trimpath sidecars identify their exact candidate through VCS metadata without linker flags", () => {
  const info = `go1.27.3\nbuild\t-trimpath=true\nbuild\tvcs=git\nbuild\tvcs.revision=${commit}\nbuild\tvcs.modified=true`;
  assert.doesNotThrow(() => assertCommitIdentity(info, commit));
  assert.throws(() => assertCommitIdentity(info, "c".repeat(40)), /candidate commit/);
  assert.throws(() => assertCommitIdentity(`build\t-ldflags=-X internal/version.Commit=${commit}`, commit), /candidate commit/);
  assert.throws(() => assertCommitIdentity(`${info}\nbuild\tvcs.revision=${commit}`, commit), /candidate commit/);
});

test("package cleanup is confined to the known temporary directory", () => {
  assertTemporaryExtraction(path.join(tmpdir(), "noter-package-sample"));
  assert.throws(() => assertTemporaryExtraction(path.join(tmpdir(), "other-folder")));
  assert.throws(() => assertTemporaryExtraction(path.join(tmpdir(), "nested", "noter-package-sample")));
});

test("Linux native smoke uses Xvfb without sandbox-disabling arguments", () => {
  assert.deepEqual(smokeCommand("/tmp/app/memos-desktop", "linux"), { command: "xvfb-run", args: ["-a", "/tmp/app/memos-desktop", "--smoke-test"] });
  assert.deepEqual(smokeCommand("C:/temp/app/memos-desktop.exe", "win32"), { command: "C:/temp/app/memos-desktop.exe", args: ["--smoke-test"] });
});

test("native smoke fails on nonzero exit and terminates a stalled owned process", async () => {
  await assert.rejects(launchSmoke(process.execPath, ["-e", "process.exit(5)"]), /exited 5/);
  await assert.rejects(launchSmoke(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200 }), /timed out/);
});

test("native startup proof requires the isolated SQLite profile, loopback page, and reaped sidecar", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "noter-smoke-test-"));
  t.after(() => cleanup(root));
  const stoppedPid = Number(run(process.execPath, ["-e", "console.log(process.pid)"], { capture: true }));
  const proof = { serverOrigin: "http://127.0.0.1:54321", webviewLoaded: true, sidecarHealthy: true, sidecarStopped: true, sidecarPid: stoppedPid, httpStatus: 200, noterPage: true };
  const report = path.join(root, "noter-smoke-result.json");
  await writeFile(path.join(root, "memos_prod.db"), Buffer.from("SQLite format 3\0"));
  await writeFile(report, JSON.stringify(proof));
  assert.equal((await verifySmokeProfile(root)).isolatedProfile, true);
  await writeFile(report, JSON.stringify({ ...proof, serverOrigin: "https://example.com" }));
  await assert.rejects(verifySmokeProfile(root), /selected loopback/);
  await writeFile(report, JSON.stringify({ ...proof, httpStatus: 500 }));
  await assert.rejects(verifySmokeProfile(root), /selected loopback/);
  await writeFile(report, JSON.stringify({ ...proof, sidecarPid: process.pid }));
  await assert.rejects(verifySmokeProfile(root), /still present/);
  await writeFile(report, JSON.stringify(proof));
  await writeFile(path.join(root, "memos_prod.db"), "not a SQLite profile");
  await assert.rejects(verifySmokeProfile(root), /isolated SQLite/);
});

test("committed package, Cargo, lock and bundle versions must agree", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "noter-version-test-"));
  t.after(() => cleanup(root));
  await mkdir(path.join(root, "src-tauri"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  const configFile = path.join(root, "src-tauri/tauri.conf.json");
  const config = { version, bundle: { macOS: { bundleVersion: "26.10.15" }, windows: { wix: { version: "26.10.15.1" } } } };
  await writeFile(configFile, JSON.stringify(config));
  await writeFile(path.join(root, "src-tauri/Cargo.toml"), `[package]\nname = "memos-desktop"\nversion = "${version}"\n`);
  const lock = path.join(root, "src-tauri/Cargo.lock");
  await writeFile(lock, `[[package]]\nname = "memos-desktop"\nversion = "${version}"\n`);
  await assertVersions(version, root);
  await writeFile(configFile, JSON.stringify({ ...config, bundle: { ...config.bundle, windows: { wix: { version: "26.10.15.2" } } } }));
  await assert.rejects(assertVersions(version, root), /numeric macOS\/MSI/);
  await writeFile(configFile, JSON.stringify(config));
  await writeFile(lock, '[[package]]\nname = "memos-desktop"\nversion = "0.1.0"\n');
  await assert.rejects(assertVersions(version, root), /must match committed/);
});

async function candidateFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "noter-artifact-test-"));
  t.after(() => cleanup(root));
  const extensions = { nsis: ".setup.exe", msi: ".msi", dmg: ".dmg", appimage: ".AppImage", deb: ".deb" };
  for (const [target, config] of Object.entries(targets)) {
    const files = [];
    const verification = [];
    for (const kind of config.bundles) {
      const file = `Noter.ai_${version}_${target}${extensions[kind]}`;
      const content = Buffer.from(`fixture ${target} ${kind}`);
      await writeFile(path.join(root, file), content);
      files.push({ kind, file, sha256: await sha256(path.join(root, file)), bytes: content.length });
      verification.push({ kind, sidecarVersion: version, sidecarSha256: sidecarHash, goBuildInfoSha256: sidecarHash, goBuildID: "test-go-build-id", signing: config.platform === "darwin" ? "ad-hoc" : "unsigned", smoke: { webviewLoaded: true, sidecarHealthy: true, sidecarStopped: true, isolatedProfile: true, httpStatus: 200, noterPage: true, serverOrigin: "http://127.0.0.1:54321" } });
    }
    const manifest = { version, serverVersion: version, commit, target, unsigned: true, experimental: true, notarized: false, signing: config.platform === "darwin" ? "ad-hoc" : "unsigned", sourceSidecarSha256: sidecarHash, sourceGoBuildInfoSha256: sidecarHash, sourceGoBuildID: "test-go-build-id", files, verification };
    await writeFile(path.join(root, `manifest-${target}.json`), JSON.stringify(manifest));
  }
  return root;
}

test("all four platforms must verify before aggregate checksums are emitted", async (t) => {
  const root = await candidateFixture(t);
  assert.equal(await verifyAll(root, version, commit), 10);
  const sums = await readFile(path.join(root, "SHA256SUMS.txt"), "utf8");
  assert.equal(sums.trim().split("\n").length, 10);
  await rm(path.join(root, "manifest-aarch64-apple-darwin.json"));
  await assert.rejects(verifyAll(root, version, commit), /ENOENT/);
});

test("altered installer bytes and a mismatched commit block staging", async (t) => {
  const root = await candidateFixture(t);
  await assert.rejects(verifyAll(root, version, "c".repeat(40)), /identity mismatch/);
  await writeFile(path.join(root, `Noter.ai_${version}_x86_64-pc-windows-msvc.msi`), "changed installer");
  await assert.rejects(verifyAll(root, version, commit), /Checksum\/size mismatch/);
});

test("macOS ad-hoc signature bytes may differ while verified Go identity remains required", async (t) => {
  const root = await candidateFixture(t);
  const file = path.join(root, "manifest-aarch64-apple-darwin.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.verification[0].sidecarSha256 = "d".repeat(64);
  await writeFile(file, JSON.stringify(manifest));
  await verifyAll(root, version, commit);
  manifest.verification[0].goBuildID = "different-build-id";
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyAll(root, version, commit), /Invalid dmg package proof/);
});

test("a manifest cannot select arbitrary files or claim an unverified packaged sidecar", async (t) => {
  const root = await candidateFixture(t);
  const file = path.join(root, "manifest-x86_64-pc-windows-msvc.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.files[0].file = "../outside.exe";
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyAll(root, version, commit), /Invalid nsis package proof/);
  manifest.files[0].file = `Noter.ai_${version}_x86_64-pc-windows-msvc.setup.exe`;
  manifest.verification[0].sidecarSha256 = "d".repeat(64);
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyAll(root, version, commit), /Invalid nsis package proof/);
});

test("a package manifest without native startup evidence cannot be staged", async (t) => {
  const root = await candidateFixture(t);
  const file = path.join(root, "manifest-aarch64-apple-darwin.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  delete manifest.verification[0].smoke;
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyAll(root, version, commit), /Missing native startup smoke proof/);
});


test("desktop OAuth packaging accepts installed clients and rejects confidential web clients without exposing values", () => {
  const installed = { installed: { client_id: "fixture.apps.googleusercontent.com", client_secret: "fixture-desktop-client", project_id: "not-shipped" } };
  assert.deepEqual(JSON.parse(Buffer.from(desktopOAuthPayload(JSON.stringify(installed)), "base64").toString()), { installed: { client_id: installed.installed.client_id, client_secret: installed.installed.client_secret } });
  assert.equal(desktopOAuthPayload(undefined), "");
  for (const bad of ["invalid-json-private-value", JSON.stringify({ web: installed.installed }), JSON.stringify({ ...installed, web: {} }), JSON.stringify({ installed: { client_id: "invalid", client_secret: "private-value" } })]) {
    assert.throws(() => desktopOAuthPayload(bad), (error) => !error.message.includes("private-value") && !error.message.includes("fixture-desktop-client"));
  }
});
