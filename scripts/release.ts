import { spawn } from "bun";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import pc from "picocolors";

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

async function main() {
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
  
  if (!gitLog.trim()) {
    console.log(`\n${pc.yellow("⚠️  No changes found since")} ${pc.bold(currentVersion)}.`);
    console.log(pc.dim("Aborting release process.\n"));
    process.exit(0);
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    const useAi = await ask("Generate Release Notes with AI?", "y");
    if (useAi.toLowerCase() === "y") {
      try {
        console.log(`\n${pc.yellow("🤖 Generating release notes...")}`);
        
        const client = new GoogleGenAI({ 
            apiKey, 
            httpOptions: process.env.GEMINI_API_BASE ? { baseUrl: process.env.GEMINI_API_BASE } : undefined 
        });
        
        const response = await client.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Summarize the following git commit log into release notes. Call out main new features, as well as smaller changes and their commit hashes. Also propose a short, catchy headline for the release. Format the output as JSON with keys "headline" (string) and "notes" (markdown string). \n\n${gitLog}`,
          config: { responseMimeType: "application/json" }
        });
        
        if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
             const json = JSON.parse(response.candidates[0].content.parts[0].text);
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
