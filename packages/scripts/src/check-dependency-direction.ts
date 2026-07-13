/**
 * Dependency-direction checker (SSOT §3.2 / Step 0.3). Every workspace package
 * must be classified here; unknown packages fail. Import specifiers are
 * extracted via the TypeScript AST (not regex), so static imports,
 * `export ... from`, dynamic `import()`, and `require()` are all covered and
 * comments/strings can never produce false hits. Relative cross-package
 * imports are resolved back to the target package. Test files are exempt (test
 * doubles are allowed to cross lines).
 *
 * Load-bearing rules: `intelligence` and `shared` are pure (no node built-ins,
 * no I/O); `ai` may NEVER reach `voice` (the LLM must not acquire input
 * capability); nothing imports the desktop app.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

const FEATURE_DEPS = [
  "@lodestar/core",
  "@lodestar/intelligence",
  "@lodestar/data",
  "@lodestar/shared",
];

/** package name → allowed @lodestar/* runtime dependencies. */
export const CLASSIFICATION: Readonly<Record<string, readonly string[]>> = {
  "@lodestar/shared": [],
  "@lodestar/data": ["@lodestar/shared"],
  "@lodestar/intelligence": ["@lodestar/shared"],
  "@lodestar/core": ["@lodestar/intelligence", "@lodestar/data", "@lodestar/shared"],
  "@lodestar/ai": FEATURE_DEPS,
  "@lodestar/ml": FEATURE_DEPS,
  "@lodestar/voice": FEATURE_DEPS,
  "@lodestar/overlay": FEATURE_DEPS,
  "@lodestar/carrier": FEATURE_DEPS,
  "@lodestar/wing": FEATURE_DEPS,
  "@lodestar/community": [...FEATURE_DEPS, "@lodestar/ai"],
  "@lodestar/integrations": FEATURE_DEPS,
  "@lodestar/compliance": ["*"],
  "@lodestar/scripts": ["@lodestar/shared"],
  desktop: ["*"],
  "wing-relay": ["@lodestar/shared"],
  "community-api": ["@lodestar/shared"],
};

/** Pure packages: no node built-ins, no runtime I/O in src. */
const PURE_PACKAGES = new Set(["@lodestar/shared", "@lodestar/intelligence"]);

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly dependencies: readonly string[];
}

interface ImportRef {
  readonly spec: string;
  readonly typeOnly: boolean;
}

export function repoRoot(): string {
  // packages/scripts/src/<this file> → three levels up is the repo root.
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function discoverPackages(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of ["packages", "apps", "services"]) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      const pkgJsonPath = join(groupDir, entry, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
      };
      if (parsed.name === undefined) continue;
      found.push({
        name: parsed.name,
        dir: join(groupDir, entry),
        dependencies: Object.keys(parsed.dependencies ?? {}),
      });
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  const srcDir = join(dir, "src");
  if (!existsSync(srcDir)) return files;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
        files.push(full);
      }
    }
  };
  walk(srcDir);
  return files;
}

/** AST-based specifier extraction — covers static, export-from, dynamic, require. */
export function importSpecifiers(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const source = ts.createSourceFile(
    "scan.tsx",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
      refs.push({ spec: node.moduleSpecifier.text, typeOnly });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      refs.push({ spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const arg = node.arguments[0];
      if ((isDynamicImport || isRequire) && arg !== undefined && ts.isStringLiteral(arg)) {
        refs.push({ spec: arg.text, typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

function scopedBase(specifier: string): string | undefined {
  if (!specifier.startsWith("@")) {
    const head = specifier.split("/")[0];
    return head === undefined || head.startsWith(".") ? undefined : head;
  }
  const [scope, name] = specifier.split("/");
  return name === undefined ? specifier : `${scope ?? ""}/${name}`;
}

/** Maps a relative specifier to the target package name, if it escapes into one. */
function resolveRelativeTarget(
  file: string,
  spec: string,
  packages: readonly WorkspacePackage[],
  current: WorkspacePackage,
): string | undefined {
  const resolved = resolve(dirname(file), spec);
  for (const pkg of packages) {
    if (pkg.name === current.name) continue;
    const rel = relative(pkg.dir, resolved);
    if (
      !rel.startsWith("..") &&
      !rel.startsWith(`.${sep}..`) &&
      rel !== "" &&
      !rel.includes(`..${sep}`)
    ) {
      return pkg.name;
    }
  }
  return undefined;
}

export function checkDependencyDirection(root: string): string[] {
  const violations: string[] = [];
  const packages = discoverPackages(root);

  for (const pkg of packages) {
    const allowed = CLASSIFICATION[pkg.name];
    if (allowed === undefined) {
      violations.push(
        `${pkg.name} is not classified in the SSOT §3.2 dependency table — classify it before adding code`,
      );
      continue;
    }
    const allowsEverything = allowed.includes("*");

    for (const dep of pkg.dependencies.filter((d) => d.startsWith("@lodestar/"))) {
      if (!allowsEverything && !allowed.includes(dep)) {
        violations.push(`${pkg.name} declares a forbidden dependency on ${dep} (SSOT §3.2)`);
      }
    }

    for (const file of sourceFiles(pkg.dir)) {
      for (const ref of importSpecifiers(readFileSync(file, "utf8"))) {
        const relTarget = ref.spec.startsWith(".")
          ? resolveRelativeTarget(file, ref.spec, packages, pkg)
          : undefined;
        const base = relTarget ?? scopedBase(ref.spec);

        if (base === "desktop" && pkg.name !== "desktop") {
          violations.push(
            `${pkg.name} imports the desktop app ("${ref.spec}") — nothing imports apps (SSOT §3.2)`,
          );
        } else if (
          base !== undefined &&
          (base.startsWith("@lodestar/") || CLASSIFICATION[base] !== undefined) &&
          base !== pkg.name &&
          !allowsEverything &&
          !allowed.includes(base)
        ) {
          violations.push(
            `${pkg.name} imports ${base} in ${relative(root, file)} — forbidden by SSOT §3.2`,
          );
        } else if (
          PURE_PACKAGES.has(pkg.name) &&
          !ref.typeOnly &&
          (ref.spec.startsWith("node:") || NODE_BUILTINS.has(ref.spec))
        ) {
          violations.push(
            `${pkg.name} imports node built-in "${ref.spec}" in ${relative(root, file)} — this package is pure (no I/O, SSOT §3.2)`,
          );
        }
      }
    }
  }
  return violations;
}

const NODE_BUILTINS = new Set([
  "fs",
  "path",
  "os",
  "crypto",
  "http",
  "https",
  "net",
  "tls",
  "dgram",
  "child_process",
  "worker_threads",
  "stream",
  "zlib",
  "events",
  "util",
  "url",
  "process",
  "buffer",
]);

/** Runs the check over `root` and returns the process exit code (0 clean, 1 violations, 2 bad root). */
export function runDependencyDirectionCli(root: string): number {
  if (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    console.error(
      `dependency-direction: cannot locate repo root (no pnpm-workspace.yaml at ${root})`,
    );
    return 2;
  }
  const packages = discoverPackages(root);
  const violations = checkDependencyDirection(root);
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation);
    console.error(`\n${String(violations.length)} dependency-direction violation(s).`);
    return 1;
  }
  console.log(`dependency-direction: clean (${String(packages.length)} packages scanned)`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exit(runDependencyDirectionCli(repoRoot()));
}
