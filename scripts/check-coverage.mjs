import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function goBlocks(profile) {
  const [mode, ...rows] = profile.trim().split(/\r?\n/);
  if (!/^mode: (set|count|atomic)$/.test(mode)) throw new Error("Missing or invalid Go coverage mode");
  const blocks = new Map();
  for (const row of rows) {
    if (!row.trim()) continue;
    const match = /^(.*):(\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/.exec(row);
    if (!match) throw new Error(`Malformed coverage block: ${row}`);
    const [, filename, position, statements, hits] = match;
    const count = Number(statements),
      executions = Number(hits);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(executions)) throw new Error("Invalid coverage counter");
    const key = `${filename}:${position}`,
      prior = blocks.get(key);
    if (prior && prior.total !== count) throw new Error(`Conflicting coverage block: ${key}`);
    blocks.set(key, { total: count, covered: executions > 0 || prior?.covered ? count : 0 });
  }
  return blocks;
}

export function mergeGoCoverageProfiles(profiles) {
  if (!profiles.length) throw new Error("No Go profiles supplied");
  const combined = new Map();
  for (const profile of profiles) {
    for (const [key, value] of goBlocks(profile)) {
      const prior = combined.get(key);
      if (prior && prior.total !== value.total) throw new Error(`Conflicting coverage block: ${key}`);
      combined.set(key, { total: value.total, covered: value.covered || prior?.covered || 0 });
    }
  }
  if (![...combined.values()].some((b) => b.total > 0)) throw new Error("No coverage statements to merge");
  return `mode: set\n${[...combined.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => `${key} ${b.total} ${b.covered > 0 ? 1 : 0}`)
    .join("\n")}\n`;
}

export function readGoCoverage(profile) {
  // Generated protocol bindings are not maintained application logic. Apply the
  // same policy to the measured baseline and every subsequent coverage gate.
  const maintained = [...goBlocks(profile)].filter(([key]) => !key.replaceAll("\\", "/").includes("/proto/gen/"));
  const totals = maintained.reduce((sum, [, b]) => ({ total: sum.total + b.total, covered: sum.covered + b.covered }), {
    total: 0,
    covered: 0,
  });
  if (!totals.total) throw new Error("Coverage profile contains no maintained statements");
  return { statements: (100 * totals.covered) / totals.total };
}

export function readFrontendCoverage(summary) {
  const metrics = {};
  for (const key of ["lines", "statements", "functions", "branches"]) {
    const value = summary.total?.[key];
    if (
      !value ||
      !Number.isInteger(value.total) ||
      value.total <= 0 ||
      !Number.isInteger(value.covered) ||
      value.covered < 0 ||
      value.covered > value.total
    ) {
      throw new Error(`Missing or invalid frontend ${key} coverage`);
    }
    metrics[key] = (100 * value.covered) / value.total;
  }
  return metrics;
}

export function checkFloors(metrics, floors) {
  if (!floors || !Object.keys(floors).length) throw new Error("No coverage floors configured");
  const failures = [];
  for (const [key, minimum] of Object.entries(floors)) {
    if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum <= 0 || minimum > 100)
      throw new Error(`Invalid floor for ${key}`);
    if (!Number.isFinite(metrics[key])) throw new Error(`Missing coverage metric: ${key}`);
    if (metrics[key] < minimum) failures.push(`${key}: ${metrics[key].toFixed(2)}% is below ${minimum}%`);
  }
  if (failures.length) throw new Error(`Coverage regression\n${failures.join("\n")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [group, report] = process.argv.slice(2);
    if (group === "merge") {
      if (!report) throw new Error("Usage: node scripts/check-coverage.mjs merge <output> <profiles...>");
      const profiles = process.argv.slice(4).map((file) => readFileSync(file, "utf8"));
      writeFileSync(report, mergeGoCoverageProfiles(profiles));
      console.log(`Merged ${profiles.length} Go profiles into ${report}`);
      process.exit(0);
    }
    if (!group || !report) throw new Error("Usage: node scripts/check-coverage.mjs <frontend|store|server|internal|other> <report>");
    const baseline = JSON.parse(readFileSync(new URL("../.github/coverage-baseline.json", import.meta.url), "utf8"));
    const text = readFileSync(report, "utf8");
    const metrics = group === "frontend" ? readFrontendCoverage(JSON.parse(text)) : readGoCoverage(text);
    checkFloors(metrics, baseline.groups[group]?.floors);
    console.log(
      `${group} coverage passed: ${Object.entries(metrics)
        .map(([key, n]) => `${key} ${n.toFixed(2)}%`)
        .join(", ")}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
