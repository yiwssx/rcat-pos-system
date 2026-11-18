import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowedThemeFiles = new Set([
  "libs/ui/src/spartan-theme.css",
  "libs/ui/src/pos-thai-type.css",
]);

/**
 * Evaluate added diff lines only. Existing V1–V6 feature CSS is migration
 * debt: removing it is good, introducing more is forbidden. The official
 * generated Spartan Helm components use TypeScript and semantic Tailwind.
 */
export function inspectSpartanUiPatch(diff) {
  const violations = [];
  let path = "";
  let line = 0;

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) {
      path = raw.slice(6);
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]) - 1;
      continue;
    }
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    line++;
    const addition = raw.slice(1);
    if (!addition.trim()) continue;

    const isAppCss =
      /^apps\/(customer|merchant|admin)\/src\/.*\.(?:css|scss|sass|less)$/.test(path);
    const isNonThemeLibraryCss =
      /^libs\/ui\/src\/.*\.(?:css|scss|sass|less)$/.test(path) &&
      !allowedThemeFiles.has(path);
    if (isAppCss || isNonThemeLibraryCss) {
      violations.push(`${path}:${line}: do not add feature CSS; migrate to official Spartan Helm + Tailwind utilities and delete old rules`);
      continue;
    }

    if (!/\.(?:ts|html)$/.test(path) || !/^apps\/(customer|merchant|admin)\/src\//.test(path)) {
      continue;
    }
    if (/\bstyle\s*=|\[\s*(?:ngStyle|style\.[\w-]+)\s*\]|\bstyles\s*:\s*\[|\bstyleUrl[s]?\s*:/.test(addition)) {
      violations.push(`${path}:${line}: new inline or per-component styles are prohibited`);
    }
    if (/\b(?:bg|text|border|shadow|ring|fill|stroke)-\[\s*(?:#|rgb|hsl|oklch)/.test(addition)) {
      violations.push(`${path}:${line}: use Spartan semantic color utilities, not arbitrary color literals`);
    }
  }

  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , base, head = "HEAD"] = process.argv;
  if (!base || !/^[0-9a-f]{40}$/.test(base)) {
    console.error("SPARTAN_UI_POLICY=ABORT: supply the 40-character base Git SHA");
    process.exitCode = 1;
  } else {
    try {
      const diff = execFileSync(
        "git",
        ["diff", "--no-ext-diff", "--unified=0", `${base}...${head}`, "--", "apps/customer/src", "apps/merchant/src", "apps/admin/src", "libs/ui/src"],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      );
      const errors = inspectSpartanUiPatch(diff);
      for (const error of errors) console.error(error);
      if (errors.length) {
        console.error(`SPARTAN_UI_POLICY=FAIL violations=${errors.length}`);
        process.exitCode = 1;
      } else {
        console.log("SPARTAN_UI_POLICY=PASS changed-lines-only");
      }
    } catch (error) {
      console.error("SPARTAN_UI_POLICY=ABORT: " + error.message);
      process.exitCode = 1;
    }
  }
}
