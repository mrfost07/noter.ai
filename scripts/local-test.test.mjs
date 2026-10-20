import assert from "node:assert/strict";
import test from "node:test";
import { localTestPlan, runLocalTests } from "./local-test.mjs";

test("SQLite runner overrides inherited database choices only for its child", () => {
  const environment = { DRIVER: "postgres", SKIP_CONTAINER_TESTS: "0", GOMAXPROCS: "8", PATH: "existing-path" };
  const original = { ...environment };
  const plan = localTestPlan([], environment, "linux");
  assert.deepEqual(plan.args, ["test", "-count=1", "-p", "2", "./..."]);
  assert.deepEqual(plan.options.env, { DRIVER: "sqlite", SKIP_CONTAINER_TESTS: "1", GOMAXPROCS: "2", PATH: "existing-path" });
  assert.deepEqual(environment, original);
  assert.equal(plan.options.shell, false);
});

test("Windows default honestly excludes POSIX script tests; targeted and race checks remain explicit", () => {
  const windows = localTestPlan([], {}, "win32");
  assert.equal(windows.windowsCoreOnly, true);
  assert.ok(windows.args.includes("./store/..."));
  assert.ok(!windows.args.includes("./..."));
  assert.ok(!windows.args.includes("./scripts/..."));
  assert.deepEqual(localTestPlan(["--race", "--", "./server/...", "./store/..."], {}, "linux").args,
    ["test", "-count=1", "-p", "2", "-race", "./server/...", "./store/..."]);
});

test("cannot silently become the CI database acceptance suite or run arbitrary command arguments", () => {
  for (const CI of ["true", "1"]) assert.throws(() => localTestPlan([], { CI }), /workstation-only/);
  for (const args of [["--unknown"], ["--"], ["--", "-run"], ["--", "./../private/..."], ["--", "./store/...;echo"]]) {
    assert.throws(() => localTestPlan(args, {}), /Usage|package patterns/);
  }
});

test("propagates child failure and launch/interruption errors instead of reporting a false pass", () => {
  const messages = [];
  let called = false;
  assert.equal(runLocalTests([], {}, { platform: "win32", log: (line) => messages.push(line), run: (command, args, options) => {
    called = true;
    assert.equal(command, "go");
    assert.ok(args.includes("./store/..."));
    assert.equal(options.env.DRIVER, "sqlite");
    assert.equal(options.env.SKIP_CONTAINER_TESTS, "1");
    return { status: 7 };
  } }), 7);
  assert.equal(called, true);
  assert.ok(messages.some((line) => line.includes("POSIX")));
  assert.throws(() => runLocalTests([], {}, { log: () => {}, run: () => ({ error: new Error("missing executable") }) }), /missing executable/);
  assert.throws(() => runLocalTests([], {}, { log: () => {}, run: () => ({ signal: "SIGTERM" }) }), /SIGTERM/);
  assert.equal(runLocalTests([], {}, { log: () => {}, run: () => ({ status: 0 }) }), 0);
});
