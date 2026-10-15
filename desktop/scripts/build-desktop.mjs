import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const targets = Object.freeze({
  "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64", goos: "windows", goarch: "amd64", bundles: ["nsis", "msi"] },
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64", goos: "darwin", goarch: "arm64", bundles: ["dmg"] },
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64", goos: "darwin", goarch: "amd64", bundles: ["dmg"] },
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64", goos: "linux", goarch: "amd64", bundles: ["appimage", "deb"] },
});

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(desktop, "..");
const tauri = path.join(desktop, "src-tauri");
const tauriCLI = path.join(desktop, "node_modules/@tauri-apps/cli/tauri.js");
const extensions = { nsis: ".setup.exe", msi: ".msi", dmg: ".dmg", appimage: ".AppImage", deb: ".deb" };

export function validateVersion(value) {
  const match = /^([1-9]\d)\.([1-9]|1[0-2])\.([1-9]\d*)-rc\.([1-9]\d*)$/.exec(value ?? "");
  if (!match || Number(match[3]) > 65535 || Number(match[4]) > 65535) {
    throw new Error("Use an experimental RC SemVer such as 26.10.15-rc.1 (numeric components without leading zeroes).");
  }
  return value;
}

export function serverVersion(value) {
  validateVersion(value);
  const [year, month, ...rest] = value.split(".");
  return `${year}.${month.padStart(2, "0")}.${rest.join(".")}`;
}

export function targetConfig(target, platform = process.platform, arch = process.arch) {
  const config = targets[target];
  if (!config) throw new Error(`Unsupported desktop target: ${target}`);
  if (config.platform !== platform || config.arch !== arch) {
    throw new Error(`Build ${target} on its native ${config.platform}/${config.arch} runner so packaged executables can be verified.`);
  }
  return config;
}

export function run(command, args, { cwd = repo, env = {}, capture = false, timeout } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status ?? result.signal}: ${capture ? result.stderr : "see output above"}`);
  return (result.stdout ?? "").trim();
}

export async function sha256(file) {
  // Installers can be large; read them incrementally instead of duplicating them in RAM.
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function assertVersions(version, root = desktop) {
  validateVersion(version);
  const packageJSON = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const config = JSON.parse(await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const cargo = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const lock = await readFile(path.join(root, "src-tauri/Cargo.lock"), "utf8");
  const cargoVersion = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  const lockVersion = /\[\[package\]\]\s+name = "memos-desktop"\s+version = "([^"]+)"/.exec(lock)?.[1];
  if ([packageJSON.version, config.version, cargoVersion, lockVersion].some((value) => value !== version) || config.bundle?.macOS?.bundleVersion !== version.split("-")[0] || config.bundle?.windows?.wix?.version !== version.replace("-rc.", ".")) {
    throw new Error("Candidate version must match committed desktop package.json, tauri.conf.json, Cargo.toml, Cargo.lock, and numeric macOS/MSI bundle versions. Bump these together first.");
  }
}

async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else if (item.isFile()) files.push(file);
  }
  return files;
}

function verifySidecar(file, version) {
  const reported = run(file, ["--version"], { capture: true, timeout: 30000 });
  if (reported !== serverVersion(version)) throw new Error(`Packaged sidecar reports ${JSON.stringify(reported)}; expected ${serverVersion(version)}.`);
  return reported;
}

function goIdentity(file) {
  const info = run("go", ["version", "-m", file], { capture: true }).split("\n");
  const toolchain = info[0].slice(info[0].lastIndexOf(": ") + 2);
  const buildInfo = [toolchain, ...info.slice(1).map((line) => line.trim())].join("\n");
  return {
    buildInfoSha256: createHash("sha256").update(buildInfo).digest("hex"),
    buildID: run("go", ["tool", "buildid", file], { capture: true }),
    buildInfo,
  };
}

export function assertCommitIdentity(buildInfo, commit) {
  // -trimpath omits linker flags from build settings. Require Go's VCS revision instead.
  const revisions = [...buildInfo.matchAll(/^build[ \t]+vcs\.revision=([a-f0-9]{40,64})$/gm)];
  if (revisions.length !== 1 || revisions[0][1] !== commit) {
    throw new Error("Fresh sidecar does not identify the candidate commit.");
  }
}

export function assertTemporaryExtraction(directory) {
  const root = path.resolve(tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith("noter-package-")) {
    throw new Error("Refusing cleanup outside the task's temporary package directory.");
  }
}

export function smokeCommand(application, platform = process.platform) {
  return platform === "linux"
    ? { command: "xvfb-run", args: ["-a", application, "--smoke-test"] }
    : { command: application, args: ["--smoke-test"] };
}

export function launchSmoke(command, args, { env = {}, cwd = repo, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: { ...process.env, ...env }, stdio: "pipe", windowsHide: true,
      detached: process.platform !== "win32", shell: false,
    });
    let output = "";
    let timedOut = false;
    let fallback;
    const collect = (data) => { output = `${output}${data}`.slice(-65536); };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      // Terminate only this freshly spawned process tree, never an installed app.
      if (child.pid) {
        if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000, stdio: "ignore" });
        else { try { process.kill(-child.pid, "SIGKILL"); } catch { /* It may have exited at the deadline. */ } }
      }
      fallback = setTimeout(() => reject(new Error(`Native smoke exceeded ${timeoutMs}ms and did not close after termination.\n${output}`)), 5000);
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); clearTimeout(fallback); reject(new Error(`Native smoke could not start: ${error.message}`)); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(fallback);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (timedOut || code !== 0) reject(new Error(`Native smoke ${timedOut ? `timed out after ${timeoutMs}ms` : `exited ${code ?? signal}`} for ${command}.\n${output}`));
      else resolve(output);
    });
  });
}

export async function verifySmokeProfile(dataDirectory) {
  const proof = JSON.parse(await readFile(path.join(dataDirectory, "noter-smoke-result.json"), "utf8"));
  const origin = new URL(proof.serverOrigin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash || proof.webviewLoaded !== true || proof.sidecarHealthy !== true || proof.sidecarStopped !== true || proof.httpStatus !== 200 || proof.noterPage !== true || !Number.isSafeInteger(proof.sidecarPid) || proof.sidecarPid <= 0) {
    throw new Error("Native smoke did not prove the selected loopback page, healthy sidecar, and child cleanup.");
  }
  const database = await readFile(path.join(dataDirectory, "memos_prod.db"));
  if (!database.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) throw new Error("Native smoke did not initialize its isolated SQLite profile.");
  let stopped = false;
  try { process.kill(proof.sidecarPid, 0); } catch (error) { if (error.code === "ESRCH") stopped = true; }
  if (!stopped) throw new Error("Native smoke's owned sidecar is still present after the wrapper exited.");
  return { webviewLoaded: true, sidecarHealthy: true, sidecarStopped: true, isolatedProfile: true, httpStatus: 200, noterPage: true, serverOrigin: origin.origin };
}

async function smokePackage(extraction, kind, packageFile, allFiles) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const applications = allFiles.filter((file) => path.basename(file) === `memos-desktop${suffix}`);
  if (applications.length !== 1) throw new Error(`${kind} must contain exactly one native Noter.ai executable; found ${applications.length}.`);
  const smokeRoot = path.join(extraction, "smoke-profile");
  const directories = Object.fromEntries(["data", "library", "webview"].map((name) => [name, path.join(smokeRoot, name)]));
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
  const env = {
    NOTER_DATA_DIR: directories.data, NOTER_LIBRARY_ROOT: directories.library, NOTER_WEBVIEW_DATA_DIR: directories.webview,
  };
  let application = applications[0];
  if (kind === "appimage") {
    // AppRun supplies the extracted AppImage's library paths without disabling sandboxing.
    application = path.join(extraction, "squashfs-root/AppRun");
    await stat(application);
    env.APPDIR = path.join(extraction, "squashfs-root");
    env.APPIMAGE = packageFile;
  }
  const invocation = smokeCommand(application);
  await launchSmoke(invocation.command, invocation.args, { env, cwd: extraction });
  return verifySmokeProfile(directories.data);
}

async function prepare(version, target, skipFrontend = false) {
  const config = targetConfig(target);
  await assertVersions(version);
  if (skipFrontend && process.env.CI === "true") throw new Error("CI must rebuild the embedded frontend.");
  if (!skipFrontend) {
    run(process.execPath, [path.join(repo, "web/node_modules/vite/bin/vite.js"), "build", "--mode", "release", "--outDir", "../server/frontend/dist", "--emptyOutDir"], { cwd: path.join(repo, "web") });
  }
  await stat(path.join(repo, "server/frontend/dist/index.html"));
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Cannot identify the candidate commit.");
  const suffix = config.platform === "win32" ? ".exe" : "";
  const sidecar = path.join(tauri, "binaries", `memos-server-${target}${suffix}`);
  await mkdir(path.dirname(sidecar), { recursive: true });
  run("go", ["build", "-p", "2", "-trimpath", "-buildvcs=true", "-ldflags", `-s -w -X github.com/usememos/memos/internal/version.Version=${serverVersion(version)} -X github.com/usememos/memos/internal/version.Commit=${commit}`, "-o", sidecar, "./cmd/memos"], {
    env: { CGO_ENABLED: "0", GOOS: config.goos, GOARCH: config.goarch },
  });
  verifySidecar(sidecar, version);
  const identity = goIdentity(sidecar);
  assertCommitIdentity(identity.buildInfo, commit);
  return { commit, sidecar, sourceSidecarSha256: await sha256(sidecar), sourceIdentity: identity };
}

async function verifyPackage(file, kind, version, source) {
  const extraction = await mkdtemp(path.join(tmpdir(), "noter-package-"));
  let mounted = false;
  const mountpoint = path.join(extraction, "mount");
  try {
    if (kind === "msi") {
      run("msiexec.exe", ["/a", file, "/qn", `TARGETDIR=${extraction}`, "/L*v", path.join(extraction, "extract.log")]);
    } else if (kind === "nsis") {
      run("7z", ["x", "-y", `-o${extraction}`, file], { capture: true });
    } else if (kind === "dmg") {
      await mkdir(mountpoint);
      run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountpoint, file], { capture: true });
      mounted = true;
    } else if (kind === "deb") {
      run("dpkg-deb", ["--extract", file, extraction]);
    } else if (kind === "appimage") {
      run(file, ["--appimage-extract"], { cwd: extraction, capture: true });
    }
    const name = process.platform === "win32" ? "memos-server.exe" : "memos-server";
    const extractedFiles = await walk(extraction);
    const found = extractedFiles.filter((entry) => path.basename(entry) === name);
    if (found.length !== 1) throw new Error(`${kind} must contain exactly one ${name}; found ${found.length}.`);
    const reportedVersion = verifySidecar(found[0], version);
    const packagedHash = await sha256(found[0]);
    const identity = goIdentity(found[0]);
    if (identity.buildInfoSha256 !== source.sourceIdentity.buildInfoSha256 || identity.buildID !== source.sourceIdentity.buildID) {
      throw new Error(`${kind} contains different Go build metadata or build ID than the fresh sidecar.`);
    }
    if (kind === "dmg") {
      // Ad-hoc macOS signing rewrites Mach-O signature bytes. Verify that signature
      // and the unchanged Go build identity instead of claiming raw byte equality.
      const app = path.dirname(path.dirname(path.dirname(found[0])));
      if (!app.endsWith(".app")) throw new Error("DMG sidecar is outside the application bundle.");
      run("codesign", ["--verify", "--deep", "--strict", app], { capture: true });
      run("codesign", ["--verify", "--strict", found[0]], { capture: true });
      const usage = run("/usr/libexec/PlistBuddy", ["-c", "Print :NSMicrophoneUsageDescription", path.join(app, "Contents/Info.plist")], { capture: true });
      if (!usage.trim()) throw new Error("The macOS application has no microphone permission explanation.");
    } else if (packagedHash !== source.sourceSidecarSha256) {
      throw new Error(`${kind} contains a different sidecar than the one built from this commit.`);
    }
    const smoke = await smokePackage(extraction, kind, file, extractedFiles);
    return {
      kind, sidecarVersion: reportedVersion, sidecarSha256: packagedHash,
      goBuildInfoSha256: identity.buildInfoSha256, goBuildID: identity.buildID,
      signing: kind === "dmg" ? "ad-hoc" : "unsigned",
      smoke,
    };
  } finally {
    if (mounted) run("hdiutil", ["detach", mountpoint], { capture: true });
    assertTemporaryExtraction(extraction);
    await rm(extraction, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

async function build(version, target) {
  const config = targetConfig(target);
  const source = await prepare(version, target);
  const signingArgs = config.platform === "darwin" ? [] : ["--no-sign"];
  run(process.execPath, [tauriCLI, "build", "--ci", ...signingArgs, "--target", target, "--bundles", config.bundles.join(","), "--", "--locked"], {
    cwd: desktop,
    env: { NO_STRIP: "true", APPIMAGE_EXTRACT_AND_RUN: "1" },
  });
  const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(desktop, process.env.CARGO_TARGET_DIR) : path.join(tauri, "target");
  const bundles = path.join(targetDir, target, "release/bundle");
  const destination = path.join(repo, "build/noter-desktop", version, target);
  await mkdir(destination, { recursive: true });
  // Refuse mixed or stale outputs from a previous run of this candidate.
  if ((await readdir(destination)).length) throw new Error(`Artifact directory is not empty: ${destination}`);
  const all = await walk(bundles);
  const files = [];
  const verification = [];
  for (const kind of config.bundles) {
    const ending = kind === "nsis" ? ".exe" : extensions[kind];
    const candidates = all.filter((file) => file.toLowerCase().endsWith(ending.toLowerCase()) && path.basename(path.dirname(file)) === kind);
    if (candidates.length !== 1) throw new Error(`Expected exactly one ${kind} package, found ${candidates.length}. Use a clean target directory.`);
    verification.push(await verifyPackage(candidates[0], kind, version, source));
    const name = `Noter.ai_${version}_${target}${extensions[kind]}`;
    const file = path.join(destination, name);
    await copyFile(candidates[0], file);
    files.push({ kind, file: name, sha256: await sha256(file), bytes: (await stat(file)).size });
  }
  const manifest = {
    version, serverVersion: serverVersion(version), commit: source.commit, target,
    unsigned: true, experimental: true, notarized: false,
    signing: config.platform === "darwin" ? "ad-hoc" : "unsigned",
    sourceSidecarSha256: source.sourceSidecarSha256,
    sourceGoBuildInfoSha256: source.sourceIdentity.buildInfoSha256,
    sourceGoBuildID: source.sourceIdentity.buildID,
    verification, files,
  };
  const manifestName = `manifest-${target}.json`;
  await writeFile(path.join(destination, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  const sums = [...files.map((file) => `${file.sha256}  ${file.file}`), `${await sha256(path.join(destination, manifestName))}  ${manifestName}`];
  await writeFile(path.join(destination, `${target}.sha256`), `${sums.join("\n")}\n`);
  console.log(`Verified ${target} candidate artifacts: ${destination}`);
}

export async function verifyAll(directory, version, commit) {
  validateVersion(version);
  const checksums = [];
  for (const [target, config] of Object.entries(targets)) {
    const name = `manifest-${target}.json`;
    const manifest = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    const signing = config.platform === "darwin" ? "ad-hoc" : "unsigned";
    if (manifest.version !== version || manifest.serverVersion !== serverVersion(version) || manifest.commit !== commit || manifest.target !== target || manifest.unsigned !== true || manifest.experimental !== true || manifest.notarized !== false || manifest.signing !== signing || !/^[a-f0-9]{64}$/.test(manifest.sourceSidecarSha256 ?? "") || !/^[a-f0-9]{64}$/.test(manifest.sourceGoBuildInfoSha256 ?? "") || typeof manifest.sourceGoBuildID !== "string" || !manifest.sourceGoBuildID) {
      throw new Error(`Candidate identity mismatch in ${name}.`);
    }
    if (manifest.files.length !== config.bundles.length || manifest.verification.length !== config.bundles.length) throw new Error(`Missing installer or verification in ${name}.`);
    for (const kind of config.bundles) {
      const file = manifest.files.find((item) => item.kind === kind);
      const proof = manifest.verification.find((item) => item.kind === kind);
      const expectedName = `Noter.ai_${version}_${target}${extensions[kind]}`;
      if (!file || file.file !== expectedName || proof?.sidecarVersion !== serverVersion(version) || proof?.signing !== signing || proof?.goBuildInfoSha256 !== manifest.sourceGoBuildInfoSha256 || proof?.goBuildID !== manifest.sourceGoBuildID || !/^[a-f0-9]{64}$/.test(proof?.sidecarSha256 ?? "") || (signing !== "ad-hoc" && proof?.sidecarSha256 !== manifest.sourceSidecarSha256)) throw new Error(`Invalid ${kind} package proof in ${name}.`);
      if (proof.smoke?.webviewLoaded !== true || proof.smoke?.sidecarHealthy !== true || proof.smoke?.sidecarStopped !== true || proof.smoke?.isolatedProfile !== true || proof.smoke?.httpStatus !== 200 || proof.smoke?.noterPage !== true) throw new Error(`Missing native startup smoke proof for ${kind} in ${name}.`);
      const actual = path.join(directory, expectedName);
      if (await sha256(actual) !== file.sha256 || (await stat(actual)).size !== file.bytes) throw new Error(`Checksum/size mismatch: ${expectedName}`);
      checksums.push(`${file.sha256}  ${expectedName}`);
    }
    checksums.push(`${await sha256(path.join(directory, name))}  ${name}`);
  }
  await writeFile(path.join(directory, "SHA256SUMS.txt"), `${checksums.sort().join("\n")}\n`);
  return checksums.length;
}

async function main() {
  const [mode = "build", ...args] = process.argv.slice(2);
  const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const version = validateVersion(option("--version") ?? JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8")).version);
  if (mode === "verify-all") {
    const directory = option("--directory");
    const commit = option("--commit");
    if (!directory || !/^[a-f0-9]{40,64}$/.test(commit ?? "")) throw new Error("verify-all requires --directory and the full --commit SHA.");
    console.log(`Verified ${await verifyAll(path.resolve(directory), version, commit)} installer/manifest hashes.`);
    return;
  }
  await assertVersions(version);
  if (mode === "validate") { console.log(`Validated committed desktop version ${version}.`); return; }
  const host = run("rustc", ["-vV"], { capture: true }).match(/^host:\s*(\S+)$/m)?.[1];
  const target = option("--target") ?? host;
  if (mode === "prepare") await prepare(version, target, args.includes("--skip-frontend"));
  else if (mode === "build") await build(version, target);
  else throw new Error(`Unknown desktop build operation: ${mode}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
