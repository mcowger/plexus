import { spawn } from 'bun';
import { createInterface } from 'node:readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query: string, defaultVal?: string): Promise<string> => {
  const promptText = defaultVal ? `${query} (${defaultVal}): ` : `${query}: `;

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
};

async function run(cmd: string[]) {
  const proc = spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(' ')}\n${err}`);
  }
  return text.trim();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n🚀 Plexus Release Script');
    console.log('--------------------------');
    console.log('\nUsage:');
    console.log(`  bun scripts/release.ts [options]`);
    console.log('\nOptions:');
    console.log('  --help, -h  Show this help message');
    console.log(
      '\nThis script tags the repo and pushes the tag. Release notes are handled by GitHub Actions.\n'
    );
    process.exit(0);
  }

  console.log('\n🚀 Plexus Release Process');
  console.log('--------------------------\n');

  // 1. Get current version
  let currentVersion = 'v0.0.0';
  try {
    const tags = await run(['git', 'tag', '--list']);
    const versionRegex = /^v?(\d+)\.(\d+)\.(\d+)$/;
    const sortedTags = tags
      .split('\n')
      .filter((tag) => versionRegex.test(tag))
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

  // Calculate next version
  let nextVersion = currentVersion;
  const match = currentVersion.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (match) {
    nextVersion = `v${match[1]}.${match[2]}.${parseInt(match[3]!) + 1}`;
  } else {
    nextVersion = 'v0.0.1';
  }

  // 2. Ask for version
  let version = await ask('New Version', nextVersion);
  if (!version.startsWith('v')) {
    version = `v${version}`;
  }

  rl.close();

  // 3. Git Operations - tag and push
  console.log('\n📦 Performing Git operations...');
  try {
    await run(['git', 'tag', version]);
    console.log(`✅ Tagged ${version}`);

    console.log('⬆️  Pushing tag...');
    await run(['git', 'push', 'origin', version]);
    console.log(`✅ Pushed tag ${version}\n`);
    console.log('🎊 Release tag created! GitHub Actions will handle the rest.\n');
  } catch (e) {
    console.error('\n❌ Git operation failed:', e);
    process.exit(1);
  }
}

main();
