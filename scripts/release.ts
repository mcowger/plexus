import { spawn } from "bun";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import pc from "picocolors";

const PROMPT_TEMPLATE = `You are a helpful assistant that generates release notes.

Summarize the following git commit log into release notes. Call out main new features, as well as smaller changes and their commit hashes. Also propose a short headline for the release - use technical terms where appropriate, not marketing terms. 

IMPORTANT: Your response must be a valid JSON object with EXACTLY these two keys:
- "headline": a string containing a short technical headline.  This version is {{version}}
- "notes": a markdown string containing the detailed release notes.  Make sure that commit hashes are included, and are linked properly with a base of https://github.com/mcowger/plexus/commit<hash>.  It should also include a mention at the very end that the docker image has been updated and can be found at ghcr.io/mcowger/plexus:latest
Do not include any other text or markdown formatting (like \`\`\`json) outside of the JSON object.

Commit log:
{{gitLog}}`;

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query: string, defaultVal?: string): Promise<string> => {
  const promptText = defaultVal 
    ? `${pc.bold(pc.cyan(query))} ${pc.dim(`(${defaultVal})`)}: ` 
    : `${pc.bold(pc.cyan(query))}: `;
  
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
};

async function run(cmd: string[]) {
  const proc = spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")}\n${err}`);
  }
  return text.trim();
}

function parseAIResponse(content: string) {
  try {
    // Try direct parse
    return JSON.parse(content.trim());
  } catch (e) {
    // Try to extract from markdown code blocks if present
    const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return JSON.parse(match[1].trim());
    }
    throw e;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`\n${pc.bold(pc.magenta("🚀 Plexus Release Script"))}`);
    console.log(pc.dim("--------------------------"));
    console.log("\nUsage:");
    console.log(`  bun scripts/release.ts [options]`);
    console.log("\nOptions:");
    console.log(`  ${pc.cyan("--force")}    Continue even if no changes are detected since the last tag`);
    console.log(`  ${pc.cyan("--help, -h")} Show this help message`);
    console.log("\nEnvironment Variables:");
    console.log(`  ${pc.cyan("AI_API_KEY")}   API key for AI release notes generation`);
    console.log(`  ${pc.cyan("AI_API_BASE")}  Base URL for AI API (compatible with OpenAI)`);
    console.log(`  ${pc.cyan("AI_MODEL")}     Model to use (default: gemini-3-flash-preview)\n`);
    process.exit(0);
  }

  console.log(`\n${pc.bold(pc.magenta("🚀 Plexus Release Process"))}`);
  console.log(pc.dim("--------------------------\n"));

  // 1. Get current version
  let currentVersion = "v0.0.0";
  try {
    const tags = await run(["git", "tag", "--list"]);
    const versionRegex = /^v?(\d+)\.(\d+)\.(\d+)$/;
    const sortedTags = tags.split("\n")
      .filter(tag => versionRegex.test(tag))
      .sort((a, b) => {
        const matchA = a.match(versionRegex)!;
        const matchB = b.match(versionRegex)!;
        for (let i = 1; i <= 3; i++) {
          const numA = parseInt(matchA[i]!);
          const numB = parseInt(matchB[i]!);
          if (numA !== numB) return numA - numB;
        }
        return 0;
      });
    if (sortedTags.length > 0) {
      currentVersion = sortedTags[sortedTags.length - 1]!;
    }
  } catch (e) {
    // No tags found, start fresh
  }

  const logRange = currentVersion === "v0.0.0" ? "HEAD" : `${currentVersion}..HEAD`;
  const gitLog = await run(["git", "log", logRange, "--pretty=format:%h %s"]);
  
  if (!gitLog.trim() && !force) {
    console.log(`\n${pc.yellow("⚠️  No changes found since")} ${pc.bold(currentVersion)}.`);
    console.log(pc.dim("Use --force to proceed anyway.\n"));
    process.exit(0);
  } else if (!gitLog.trim() && force) {
     console.log(`\n${pc.yellow("⚠️  No changes found since")} ${pc.bold(currentVersion)}.`);
     console.log(pc.green("Proceeding due to --force flag.\n"));
  }

  // Calculate next version
  let nextVersion = currentVersion;
  const match = currentVersion.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (match) {
    nextVersion = `v${match[1]}.${match[2]}.${parseInt(match[3]!) + 1}`;
  } else {
    nextVersion = "v0.0.1";
  }

  // 2. Ask questions
  let version = await ask("New Version", nextVersion);
  if (!version.startsWith("v")) {
    version = `v${version}`;
  }
  let headline = "";

  // AI Release Notes Generation
  let aiNotes = "";
  const apiKey = process.env.AI_API_KEY;
  const apiBase = process.env.AI_API_BASE;
  const apiModel = process.env.AI_MODEL || "gemini-2.5-flash-lite";

  if (!apiKey || !apiBase || !apiModel) {
    console.log(pc.yellow("\n⚠️  AI_API_KEY, AI_API_BASE, or AI_MODEL not set. Skipping AI release notes generation."));
    console.log(pc.dim("To enable AI notes, set AI_API_KEY, AI_API_BASE, and AI_MODEL (optional).\n"));
  }

  if (apiKey && apiBase && apiModel) {
    const useAi = await ask("Generate Release Notes with AI?", "y");
    if (useAi.toLowerCase() === "y") {
      try {
        console.log(`\n${pc.yellow("Generating release notes...")}`);
        
        const url = `${apiBase.replace(/\/+$/, "")}/chat/completions`;

        console.log(`\n${pc.dim("Sending request to AI API...")}`);
        const requestBody = {
            model: apiModel, 
            messages: [
                {
                    role: "user",
                    content: PROMPT_TEMPLATE.replace("{{gitLog}}", gitLog).replace("{{version}}", version)
                }
            ]
        };
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${await response.text()}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (content) {
             const json = parseAIResponse(content);
             aiNotes = typeof json.notes === 'string' ? json.notes : JSON.stringify(json.notes, null, 2);
             const aiHeadline = json.headline;

             console.log(`\n${pc.bold(pc.blue("--- AI PROPOSALS ---"))}`);
             console.log(`${pc.bold("Headline:")} ${pc.green(aiHeadline)}`);
             console.log(`\n${pc.bold("Notes:")}`);
             console.log(aiNotes.split('\n').map(line => `  ${line}`).join('\n'));
             console.log(pc.bold(pc.blue("--------------------\n")));
             
             const useHeadline = await ask("Use AI headline?", "y");
             if (useHeadline.toLowerCase() === "y") {
                 headline = aiHeadline;
             }
        }
      } catch (error) {
        console.error(`\n${pc.red("❌ Failed to generate AI notes:")}`, error);
      }
    }
  }

  if (!headline) {
      headline = await ask("Release Headline");
  }
  
  let notes = "";
  if (aiNotes) {
      const choice = await ask("Use AI generated notes?", "y");
      if (choice.toLowerCase() === "y") {
          notes = aiNotes;
      }
  }

  if (!notes) {
      notes = await ask("Release Notes (Markdown supported)");
      if (!notes || notes.trim().length === 0) {
          console.log(`\n${pc.red("❌ Release notes cannot be empty. Exiting.")}`);
          process.exit(1);
      }
  }

  rl.close();

  // 3. Update CHANGELOG.md
  const changelogPath = "CHANGELOG.md";
  const date = new Date().toISOString().split("T")[0];
  const newEntry = `## ${version} - ${date}\n\n### ${headline}\n\n${notes}\n\n`;
  
  let currentChangelog = "";
  if (existsSync(changelogPath)) {
    currentChangelog = await readFile(changelogPath, "utf-8");
  } else {
    currentChangelog = "# Changelog\n\n";
  }

  let newContent = "";
  const header = "# Changelog\n\n";
  
  if (currentChangelog.startsWith(header)) {
      newContent = header + newEntry + currentChangelog.substring(header.length);
  } else if (currentChangelog.startsWith("# Changelog")) {
       // Handle case where maybe there's only one newline
       newContent = currentChangelog.replace("# Changelog", "# Changelog\n\n" + newEntry);
  } else {
      newContent = header + newEntry + currentChangelog;
  }
  
  // Clean up excessive newlines
  newContent = newContent.replace(/\n{3,}/g, "\n\n");

  await writeFile(changelogPath, newContent);
  console.log(`\n${pc.green("✅ Updated")} ${pc.bold(changelogPath)}`);

  // 4. Git Operations
  console.log(`\n${pc.bold(pc.magenta("📦 Performing Git operations..."))}`);
  try {
    await run(["git", "add", changelogPath]);
    await run(["git", "commit", "-m", `chore: release ${version}`]);
    await run(["git", "tag", version]);
    console.log(`${pc.green("✅ Tagged")} ${pc.bold(version)}`);
    
    console.log(pc.dim("⬆️  Pushing changes..."));
    await run(["git", "push"]);
    await run(["git", "push", "--tags"]);
    console.log(`${pc.green("✅ Pushed")} ${pc.bold(version)}\n`);
    console.log(`${pc.bold(pc.magenta("🎊 Release Complete!"))}\n`);
  } catch (e) {
    console.error(`\n${pc.red("❌ Git operation failed:")}`, e);
    process.exit(1);
  }
}

main();
