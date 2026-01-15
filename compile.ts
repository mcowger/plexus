#!/usr/bin/env bun
/**
 * Plexus Compilation Script
 * 
 * This script is required for compiling Plexus executables because:
 * 
 * 1. Plugin Support: The `bun build --compile` CLI does NOT support plugins.
 *    Only the JavaScript API (Bun.build()) supports plugins during compilation.
 * 
 * 2. Tailwind CSS: We use bun-plugin-tailwind to generate CSS at build time.
 *    Without this plugin, Tailwind classes won't be processed in the compiled
 *    executable, resulting in missing styles.
 * 
 * 3. bunfig.toml Limitation: The [serve.static] plugins in bunfig.toml only
 *    work for the development server (bun index.html), not for production builds.
 * 
 * DO NOT use `bun build index.ts --compile` directly. Always use this script
 * via the package.json scripts (compile:macos, compile:linux, etc.) to ensure
 * the Tailwind plugin is included in the build.
 * 
 * See: https://bun.sh/docs/bundler/plugins
 *      https://bun.sh/docs/bundler/executables
 */
import tailwindPlugin from "bun-plugin-tailwind";

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let target: string | undefined;
  let outfile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && i + 1 < args.length) {
      target = args[i + 1];
      i++;
    } else if (args[i] === "--outfile" && i + 1 < args.length) {
      outfile = args[i + 1];
      i++;
    }
  }

  if (!target) {
    console.error("Error: --target is required");
    console.error("Usage: bun compile.ts --target <target> --outfile <outfile>");
    console.error("\nAvailable targets:");
    console.error("  - bun-darwin-arm64");
    console.error("  - bun-darwin-x64");
    console.error("  - bun-linux-x64-modern");
    console.error("  - bun-linux-x64");
    console.error("  - bun-linux-arm64");
    console.error("  - bun-windows-x64");
    process.exit(1);
  }

  if (!outfile) {
    console.error("Error: --outfile is required");
    console.error("Usage: bun compile.ts --target <target> --outfile <outfile>");
    process.exit(1);
  }

  return { target, outfile };
}

const { target, outfile } = parseArgs();

console.log(`🔨 Compiling for ${target}...`);
console.log(`📦 Output: ${outfile}`);

const result = await Bun.build({
  entrypoints: ["./index.ts"],
  compile: {
    target: target as any,
    outfile: outfile,
  },
  plugins: [tailwindPlugin],
  minify: true,
  sourcemap: "linked",
});

if (!result.success) {
  console.error("❌ Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`✅ Successfully compiled to ${outfile}`);
