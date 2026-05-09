import { execSync, spawn } from 'node:child_process';
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
    console.log('\nPlexus Release Script');
    console.log('--------------------------');
    console.log('\nUsage:');
    console.log(`  bun scripts/release.ts [options]`);
    console.log('\nOptions:');
    console.log('  --help, -h        Show this help message');
    console.log('  --remove <tag>    Delete tag locally, remotely, and its GitHub release');
    console.log(
      '\nUses CalVer (YYYY.MM.DD.N) format. Release notes are handled by GitHub Actions.\n'
    );
    process.exit(0);
  }

  const removeIndex = args.indexOf('--remove');
  if (removeIndex !== -1) {
    const tag = args[removeIndex + 1];
    if (!tag) {
      console.error('--remove requires a tag argument');
      process.exit(1);
    }

    console.log(`Removing tag and release: ${tag}`);

    try {
      execSync(`git tag -d ${tag}`, { stdio: 'inherit' });
    } catch {
      console.warn(`Local tag ${tag} not found, skipping`);
    }

    try {
      execSync(`git push origin :refs/tags/${tag}`, { stdio: 'inherit' });
    } catch {
      console.warn(`Remote tag ${tag} not found, skipping`);
    }

    try {
      execSync(`gh release delete ${tag} --yes`, { stdio: 'inherit' });
    } catch {
      console.warn(`GitHub release for ${tag} not found, skipping`);
    }

    console.log('Done.');
    process.exit(0);
  }

  console.log('\nPlexus Release Process');
  console.log('--------------------------\n');

  // Get GitHub token
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('GH_TOKEN environment variable is required');
    process.exit(1);
  }

  // 1. Get local tags using git
  const tagOutput = execSync('git tag', { encoding: 'utf-8' });
  const allTags = tagOutput
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const calverTags = allTags.map((t) => parseCalVer(t)).filter((t): t is CalVerTag => t !== null);

  // Sort: newest date first, then highest counter
  calverTags.sort((a, b) => {
    const dateA = a.year * 10000 + a.month * 100 + a.day;
    const dateB = b.year * 10000 + b.month * 100 + b.day;
    if (dateB !== dateA) return dateB - dateA;
    return b.counter - a.counter;
  });

  const currentTag = calverTags.length > 0 ? calverTags[0]! : null;

  // Calculate next version
  const now = new Date();
  const todayStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

  let nextVersion: string;

  // Find all tags for today and get the highest counter
  const todayCalVerTags = calverTags.filter(
    (t) => t.year === now.getFullYear() && t.month === now.getMonth() + 1 && t.day === now.getDate()
  );

  if (todayCalVerTags.length > 0) {
    // Same day, increment from highest counter
    const highestCounter = Math.max(...todayCalVerTags.map((t) => t.counter));
    nextVersion = `${todayStr}.${highestCounter + 1}`;
  } else if (currentTag) {
    // New day, start at .1
    nextVersion = `${todayStr}.1`;
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
  const octokit = new Octokit({ auth: token });
  const owner = 'mcowger';
  const repo = 'plexus';

  console.log('\nCreating tag on remote main...');
  try {
    // Get the latest commit SHA on main
    const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: 'heads/main',
    });

    const mainSha = ref.object.sha;
    console.log(`Target commit: ${mainSha.slice(0, 7)}`);

    // Create the tag on the remote
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/tags/${version}`,
      sha: mainSha,
    });

    console.log(`✅ Created tag ${version} at origin/main\n`);

    // Follow the release workflow
    await followReleaseWorkflow(owner, repo, version);
  } catch (e) {
    console.error('\n❌ GitHub API operation failed:', e);
    process.exit(1);
  }
}

async function followReleaseWorkflow(owner: string, repo: string, version: string): Promise<void> {
  console.log('Waiting for release workflow to start...\n');

  // Wait for the workflow to be triggered (poll for up to 30 seconds)
  let runId: string | null = null;
  const maxAttempts = 30;
  const pollInterval = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(pollInterval);

    try {
      const result = execSync(
        `gh run list --repo ${owner}/${repo} --branch refs/tags/${version} --limit 1 --json databaseId,status,conclusion`,
        { encoding: 'utf-8' }
      );
      const runs = JSON.parse(result);
      if (runs.length > 0) {
        runId = runs[0]!.databaseId;
        break;
      }
    } catch {
      // Workflow not found yet, continue polling
    }
  }

  if (!runId) {
    console.log(`Could not find workflow run. Check https://github.com/${owner}/${repo}/actions\n`);
    return;
  }

  console.log(`Found workflow run: ${runId}\n`);

  // Watch the workflow until it completes
  await watchWorkflowRun(owner, repo, runId);

  // Show the logs
  console.log('\n--- Workflow Logs ---\n');
  execSync(`gh run view ${runId} --repo ${owner}/${repo} --log`, { stdio: 'inherit' });

  // Get the final status
  const result = execSync(
    `gh run view ${runId} --repo ${owner}/${repo} --json databaseId,status,conclusion`,
    {
      encoding: 'utf-8',
    }
  );
  const runInfo = JSON.parse(result);

  if (runInfo.conclusion === 'success') {
    console.log('\n✅ Release workflow completed successfully!\n');
  } else {
    console.error(`\n❌ Release workflow ${runInfo.conclusion}\n`);
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function watchWorkflowRun(owner: string, repo: string, runId: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      'gh',
      ['run', 'watch', runId, '--repo', `${owner}/${repo}`, '--exit-status'],
      {
        stdio: 'inherit',
      }
    );

    child.on('close', (code) => {
      resolve();
    });
  });
}

main().catch(console.error);
