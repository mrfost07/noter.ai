import test from "node:test";
import assert from "node:assert/strict";
import { readGoCoverage, readFrontendCoverage, checkFloors, mergeGoCoverageProfiles } from "./check-coverage.mjs";

test("Go coverage weights statements and merges duplicate blocks without double counting", () => {
  const metrics = readGoCoverage(`mode: atomic
example/service.go:1.1,2.1 3 0
example/service.go:1.1,2.1 3 2
example/service.go:3.1,5.1 1 0
example/proto/gen/api/service.pb.go:1.1,5.1 100 0
`);
  assert.equal(metrics.statements,75);
  checkFloors(metrics,{statements:75});
  assert.throws(()=>checkFloors(metrics,{statements:75.01}),/Coverage regression/);
});

test("invalid and empty reports fail instead of being reported as passing coverage", () => {
  for (const profile of ["", "mode: atomic", "mode: atomic\ninvalid", "mode: atomic\nexample/a.go:1.1,2.1 0 0"]) {
    assert.throws(()=>readGoCoverage(profile));
  }
  assert.throws(()=>readGoCoverage("mode: atomic\nexample/a.go:1.1,2.1 1 1\nexample/a.go:1.1,2.1 2 0"),/Conflicting/);
  assert.throws(()=>readFrontendCoverage({total:{}}),/Missing or invalid/);
});

test("database profiles combine real execution across drivers without inflating totals", () => {
  const sqlite="mode: atomic\nexample/shared.go:1.1,2.1 2 3\nexample/mysql.go:1.1,2.1 3 0\n";
  const mysql="mode: atomic\nexample/shared.go:1.1,2.1 2 1\nexample/mysql.go:1.1,2.1 3 4\n";
  const merged=mergeGoCoverageProfiles([sqlite,mysql]);
  assert.equal(merged,"mode: set\nexample/mysql.go:1.1,2.1 3 1\nexample/shared.go:1.1,2.1 2 1\n");
  assert.equal(readGoCoverage(merged).statements,100);
  assert.throws(()=>mergeGoCoverageProfiles([]),/No Go profiles/);
  assert.throws(()=>mergeGoCoverageProfiles(["mode: atomic"]),/No coverage statements/);
});

test("frontend gates recompute all four percentages from execution counts", () => {
  const summary={total:Object.fromEntries(["lines","statements","functions","branches"].map(key=>[key,{total:20,covered:15,pct:100}]))};
  const metrics=readFrontendCoverage(summary);
  assert.deepEqual(metrics,{lines:75,statements:75,functions:75,branches:75});
  checkFloors(metrics,{lines:75,statements:75,functions:75,branches:75});
  assert.throws(()=>checkFloors({...metrics,branches:60},{branches:70}),/branches: 60/);
});

test("floors cannot silently disappear or disable coverage", () => {
  for (const floors of [undefined,{}, {statements:0}, {statements:-1}, {statements:101}, {statements:NaN}]) {
    assert.throws(()=>checkFloors({statements:80},floors));
  }
  assert.throws(()=>checkFloors({}, {statements:70}),/Missing coverage metric/);
});
