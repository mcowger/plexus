import { Octokit } from 'octokit';
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

  // Get GitHub token
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('GH_TOKEN environment variable is required');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const owner = 'mcowger';
  const repo = 'plexus';

  // 1. Get current version tags via GitHub API
  let currentTag: CalVerTag | null = null;
  try {
    const { data: tags } = await octokit.request('GET /repos/{owner}/{repo}/tags', {
      owner,
      repo,
      per_page: 100,
    });

    const calverTags = tags
      .map((t) => parseCalVer(t.name))
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
    console.log('Could not fetch tags, starting fresh...\n');
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

  // 3. GitHub API - create tag on main
  console.log('\n📦 Creating tag on remote main...');
  try {
    // Get the latest commit SHA on main
    const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: 'heads/main',
    });

    const mainSha = ref.object.sha;
    console.log(`📌 Target commit: ${mainSha.slice(0, 7)}`);

    // Create the tag on the remote
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/tags/${version}`,
      sha: mainSha,
    });

    console.log(`✅ Created tag ${version} at origin/main\n`);
    console.log('🎊 Release tag created! GitHub Actions will handle the rest.\n');
  } catch (e) {
    console.error('\n❌ GitHub API operation failed:', e);
    process.exit(1);
  }
}

main().catch(console.error);
