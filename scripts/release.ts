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

interface CalVerTag {
  year: number;
  month: number;
  day: number;
  counter: number;
  raw: string;
}

function parseCalVer(tag: string): CalVerTag | null {
  const match = tag.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/);
  if (!match) return null;
  return {
    year: parseInt(match[1]!),
    month: parseInt(match[2]!),
    day: parseInt(match[3]!),
    counter: parseInt(match[4]!),
    raw: tag,
  };
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
      '\nUses CalVer (YYYY.MM.DD.N) format. Release notes are handled by GitHub Actions.\n'
    );
    process.exit(0);
  }

  console.log('\n🚀 Plexus Release Process');
  console.log('--------------------------\n');

  // 0. Check if we need to pull
  try {
    console.log('🔍 Checking remote for updates...');
    await run(['git', 'fetch', 'origin']);
    const branch = (await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch) {
      const ahead = (await run(['git', 'rev-list', '--count', `HEAD..origin/${branch}`])).trim();
      if (parseInt(ahead) > 0) {
        console.log(`⚠️  Local branch is ${ahead} commit(s) behind origin/${branch}.`);
        console.log('   Run `git pull` and then re-run this script.');
        process.exit(1);
      }
      const behind = (await run(['git', 'rev-list', '--count', `origin/${branch}..HEAD`])).trim();
      if (parseInt(behind) > 0) {
        console.log(`ℹ️  Local branch is ${behind} commit(s) ahead of origin/${branch}.`);
      } else {
        console.log('✅ Local is up to date with remote.\n');
      }
    }
  } catch (e) {
    console.log('⚠️  Could not check remote status, continuing anyway...\n');
  }

  // 1. Get current version tags
  let currentTag: CalVerTag | null = null;
  try {
    const tags = await run(['git', 'tag', '--list']);
    const calverTags = tags
      .split('\n')
      .map((t) => parseCalVer(t))
      .filter((t): t is CalVerTag => t !== null);

    if (calverTags.length > 0) {
      // Sort: newest date first, then highest counter
      calverTags.sort((a, b) => {
        const dateA = a.year * 10000 + a.month * 100 + a.day;
        const dateB = b.year * 10000 + b.month * 100 + b.day;
        if (dateB !== dateA) return dateB - dateA;
        return b.counter - a.counter;
      });
      currentTag = calverTags[0]!;
    }
  } catch (e) {
    // No tags found, start fresh
  }

  // Calculate next version
  const now = new Date();
  const todayStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

  let nextVersion: string;

  if (currentTag) {
    const currentDateStr = `${currentTag.year}.${String(currentTag.month).padStart(2, '0')}.${String(currentTag.day).padStart(2, '0')}`;
    if (currentDateStr === todayStr) {
      // Same day, increment counter
      nextVersion = `${todayStr}.${currentTag.counter + 1}`;
    } else {
      // New day, start at .1
      nextVersion = `${todayStr}.1`;
    }
  } else {
    // No tags yet
    nextVersion = `${todayStr}.1`;
  }

  // 2. Ask for version
  let version = await ask('New Version', nextVersion);
  if (!version.match(/^\d{4}\.\d{2}\.\d{2}\.\d+$/)) {
    console.error('Invalid version format. Use CalVer: YYYY.MM.DD.N');
    process.exit(1);
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

main().catch(console.error);
