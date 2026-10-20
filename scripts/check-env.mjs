import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// These belong to the OS, toolchain or harness, not to Noter.ai's .env config.
// Keep individual names and reasons: a broad prefix exemption would hide drift.
export const externalEnvironment = Object.freeze({
  ProgramData: "Windows-provided common application-data directory",
  HOME: "Operating-system home directory on Unix",
  USERPROFILE: "Operating-system home directory on Windows",
  PATH: "Operating-system executable search path",
  CI: "CI runner marker used to require clean desktop release builds",
  CARGO_TARGET_DIR: "Cargo-owned build-output override",
  WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "WebKit-owned flag rejected by desktop smoke tests; never enable it",
  MEMOS_ENTRYPOINT_SWITCHED: "Internal legacy entrypoint re-execution marker; not a user setting",
});

export function isEnvironmentSource(filename) {
  const file = filename.replaceAll("\\", "/");
  if (/^(?:proto\/gen|web\/src\/types\/proto|build|website\/dist)\//.test(file)) return false;
  if (/(?:_test\.go|\.(?:test|spec)\.[cm]?[jt]sx?|_test\.sh)$/.test(file)) return false;
  return /\.(?:go|rs|[cm]?[jt]sx?|sh)$/.test(file) || file === "compose.yaml";
}

export function sourceEnvironment(filename, text) {
  const found = new Set();
  const addMatches = (pattern, group = 1) => {
    for (const match of text.matchAll(pattern)) found.add(match[group]);
  };
  if (filename.endsWith(".go")) {
    addMatches(/\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z_0-9]*)"\s*\)/g);
    // Viper's automatic environment names are derived from bound profile keys,
    // rather than explicit os.Getenv calls. Include all keys the server reads.
    const prefix = /\bviper\.SetEnvPrefix\("([^"]+)"\)/.exec(text)?.[1];
    if (prefix && /\bviper\.AutomaticEnv\(\)/.test(text)) {
      for (const match of text.matchAll(/\bviper\.Get\w*\("([a-z][a-z0-9-]*)"\)/g)) {
        found.add(`${prefix}_${match[1]}`.replaceAll("-", "_").toUpperCase());
      }
    }
  } else if (filename.endsWith(".rs")) {
    addMatches(/\b(?:std::)?env::var(?:_os)?\(\s*"([A-Za-z_][A-Za-z_0-9]*)"/g);
    // The desktop selects the OS-owned home variable in a conditional argument.
    for (const match of text.matchAll(/\benv::var_os\(\s*if\b([\s\S]*?\}\s*)\)/g)) {
      for (const literal of match[1].matchAll(/"([A-Z][A-Z_0-9]*)"/g)) found.add(literal[1]);
    }
  } else if (filename.endsWith(".sh")) {
    // Shell locals are not environment knobs. The legacy scripts' public
    // compatibility options are explicitly prefixed MEMOS_.
    addMatches(/\$\{(MEMOS_[A-Z_0-9]+)(?::[-?+]|[-?+])/g);
    for (const match of text.matchAll(/^file_env\s+"([A-Z_0-9]+)"/gm)) {
      found.add(match[1]);
      found.add(`${match[1]}_FILE`);
    }
  } else if (filename === "compose.yaml") {
    addMatches(/\$\{([A-Z][A-Z_0-9]*)(?::[-?+]|[-?+]|\})/g);
  } else {
    addMatches(/\bprocess\.env\.([A-Za-z_][A-Za-z_0-9]*)/g);
    addMatches(/\bprocess\.env\[\s*["']([A-Za-z_][A-Za-z_0-9]*)["']\s*\]/g);
  }
  return [...found].sort();
}

export function documentedEnvironment(example) {
  return new Set([...example.matchAll(/^\s*(?:#\s*)?([A-Za-z_][A-Za-z_0-9]*)=/gm)].map((match) => match[1]));
}

export function checkEnvironment(files, example, exclusions = externalEnvironment) {
  const documented = documentedEnvironment(example);
  const reads = new Map();
  for (const { filename, text } of files) {
    if (!isEnvironmentSource(filename)) continue;
    for (const name of sourceEnvironment(filename, text)) {
      if (!reads.has(name)) reads.set(name, []);
      reads.get(name).push(filename);
    }
  }
  const missing = [...reads.entries()]
    .filter(([name]) => !documented.has(name) && !Object.hasOwn(exclusions, name))
    .map(([name, sources]) => ({ name, sources }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { missing, documented: [...documented].sort(), referenced: [...reads.keys()].sort() };
}

export function checkRepository(root = repo) {
  // Only tracked source is inspected. Never open .env, profiles,
  // OAuth files, dependency trees or private build outputs.
  const names = execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  }).split("\0").filter(Boolean);
  const files = [...new Set(names)].filter(isEnvironmentSource).filter((filename) => existsSync(path.join(root, filename))).map((filename) => ({
    filename,
    text: readFileSync(path.join(root, filename), "utf8"),
  }));
  return checkEnvironment(files, readFileSync(path.join(root, ".env.example"), "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkRepository();
    for (const { name, sources } of result.missing) console.error(`Undocumented environment variable ${name}: ${sources.join(", ")}`);
    if (result.missing.length) process.exitCode = 1;
    else console.log(`Environment documentation covers ${result.referenced.length} statically referenced variables (${result.documented.length} example entries).`);
  } catch (error) {
    console.error(`Environment check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
