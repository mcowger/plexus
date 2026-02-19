import { build } from "bun";
import { readFile, writeFile, mkdir, cp } from "fs/promises";
import { existsSync } from "fs";
import { watch } from "fs";
import { spawn } from "child_process";

const buildCSS = async () => {
  console.log("Building CSS...");
  const proc = spawn("bun", ["x", "@tailwindcss/cli", "-i", "./src/globals.css", "-o", "./dist/main.css"], {
    stdio: "inherit",
    cwd: ".",
  });

  return new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) {
        console.log("CSS Build complete.");
        resolve();
      } else {
        console.error("CSS Build failed.");
        reject(new Error(`CSS build exited with code ${code}`));
      }
    });
  });
};

const copyAssets = async () => {
  console.log("Copying assets...");
  try {
    if (existsSync("./src/assets")) {
      await cp("./src/assets", "./dist", { recursive: true });
      console.log("Assets copied.");
    } else {
      console.warn("No assets directory found at ./src/assets");
    }
  } catch (e) {
    console.error("Failed to copy assets:", e);
  }
};

const runBuild = async () => {
    console.log("Building...");

    if (!existsSync("./dist")) {
      await mkdir("./dist");
    }

    try {
      await buildCSS();
      await copyAssets();
    } catch (e) {
      console.error(e);
    }

    const result = await build({
      entrypoints: ["./src/main.tsx"],
      outdir: "./dist",
      minify: process.env.NODE_ENV === "production",
      define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        "process.env.APP_VERSION": JSON.stringify(process.env.APP_VERSION || "dev"),
        "process.env.APP_BUILD_SHA": JSON.stringify(process.env.APP_BUILD_SHA || ""),
        "process.env.APP_BUILD_TIME": JSON.stringify(process.env.APP_BUILD_TIME || ""),
      },
    });

    if (!result.success) {
      console.error("Build failed");
      for (const log of result.logs) {
        console.error(log);
      }
      return;
    }

    // HTML Injection
    let html = await readFile("index.html", "utf-8");
    html = html.replace('src="./src/main.tsx"', 'src="main.js"');
    html = html.replace('src="/src/main.tsx"', 'src="main.js"'); // Handle both absolute/relative
    html = html.replace('type="module"', ''); 

    // Inject Favicons and Manifest
    const faviconHtml = `
    <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
    <link rel="manifest" href="site.webmanifest">
    `;

    if (!html.includes('rel="manifest"')) {
        html = html.replace('</head>', `${faviconHtml}\n  </head>`);
    }

    if (existsSync("dist/main.css")) {
      // Check if link already exists to avoid dupes
      if (!html.includes('href="main.css"')) {
           html = html.replace('</head>', '  <link rel="stylesheet" href="main.css">\n  </head>');
      }
    }

    await writeFile("dist/index.html", html);
    console.log("Build complete.");
};

// Initial Build
await runBuild();

// Watch Mode
if (process.argv.includes("--watch")) {
    console.log("Watching for changes in ./src ...");

    let debounceTimer: Timer | null = null;
    let isBuilding = false;

    watch("./src", { recursive: true }, async (event, filename) => {
        if (isBuilding) return;
        if (!filename) return;

        if (filename.includes("assets/")) {
            return;
        }

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
            if (isBuilding) return;
            isBuilding = true;
            console.log(`Detected change in ${filename}`);
            try {
                await runBuild();
            } finally {
                isBuilding = false;
                debounceTimer = null;
            }
        }, 300);
    });
}
