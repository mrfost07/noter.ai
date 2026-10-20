import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portablePackages = ["./cmd/...", "./core/...", "./filter/...", "./internal/...", "./markdown/...", "./provider/...", "./proto/...", "./server/...", "./store/..."];

export function localTestPlan(args = [], environment = {}, platform = process.platform) {
  if (environment.CI === "true" || environment.CI === "1") throw new Error("This workstation-only runner skips container integrations. Use the full database matrix in CI.");
  let race = false;
  let packages;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--race" && !race) race = true;
    else if (args[index] === "--") {
      packages = args.slice(index + 1);
      if (!packages.length || packages.some((value) => !/^\.\/[A-Za-z0-9_./-]+$/.test(value) || value.split("/").includes(".."))) {
        throw new Error("After --, supply repository-relative Go package patterns such as ./store/... .");
      }
      break;
    } else throw new Error("Usage: node scripts/local-test.mjs [--race] [-- ./package/...] ");
  }
  packages ??= platform === "win32" ? [...portablePackages] : ["./..."];
  return {
    command: "go",
    args: ["test", "-count=1", "-p", "2", ...(race ? ["-race"] : []), ...packages],
    options: {
      cwd: repo,
      env: { ...environment, DRIVER: "sqlite", SKIP_CONTAINER_TESTS: "1", GOMAXPROCS: "2" },
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    },
    windowsCoreOnly: platform === "win32" && !args.includes("--"),
  };
}

export function runLocalTests(args, environment, { platform = process.platform, run = spawnSync, log = console.log } = {}) {
  const plan = localTestPlan(args, environment, platform);
  log("SQLite-only workstation checks: container-based integration tests are explicitly skipped.");
  if (plan.windowsCoreOnly) log("Windows runs maintained Go application packages; scripts/ POSIX shell regressions run in Linux CI.");
  log([plan.command, ...plan.args].join(" "));
  const result = run(plan.command, plan.args, plan.options);
  if (result.error) throw new Error(`Could not run Go tests: ${result.error.message}`);
  if (result.signal) throw new Error(`Go tests were interrupted by ${result.signal}`);
  return Number.isInteger(result.status) ? result.status : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runLocalTests(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
