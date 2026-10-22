import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(new URL('../../../../.github/workflows/ocr-review.yml', import.meta.url), 'utf8')
);
const steps = workflow.jobs['ocr-review'].steps;
const gate = steps.find((step: { id?: string }) => step.id === 'review-gate');
const marker = '<!-- ocr-review-detail -->';

describe('OCR review workflow', () => {
  let comments: { id?: number; user: { login: string }; body: string }[];
  let github: {
    paginate: ReturnType<typeof vi.fn>;
    rest: {
      issues: {
        listComments: ReturnType<typeof vi.fn>;
        createComment: ReturnType<typeof vi.fn>;
        updateComment: ReturnType<typeof vi.fn>;
      };
    };
  };

  beforeEach(() => {
    comments = [];
    github = {
      paginate: vi.fn(async () => comments),
      rest: {
        issues: {
          listComments: vi.fn(),
          createComment: vi.fn(async ({ body }: { body: string }) => {
            comments.push({
              id: comments.length + 1,
              user: { login: 'github-actions[bot]' },
              body,
            });
          }),
          updateComment: vi.fn(),
        },
      },
    };
  });

  async function runGate(eventName = 'pull_request_target', action = 'opened') {
    const core = { info: vi.fn(), setOutput: vi.fn() };
    await runInNewContext(`(async () => { ${gate.with.script} })()`, {
      github,
      core,
      context: {
        eventName,
        repo: { owner: 'owner', repo: 'plexus' },
        payload: { action, pull_request: { number: 123 } },
      },
    });
    return core;
  }

  it('does not trigger automatic reviews on pushes', () => {
    expect(workflow.on.pull_request_target.types).toEqual([
      'opened',
      'reopened',
      'ready_for_review',
    ]);
    expect(workflow.on.issue_comment.types).toEqual(['created']);
  });

  it('only lets explicit reruns cancel an active review', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'issue_comment' }}"
    );
  });

  it('claims the first automatic review before allowing OCR to start', async () => {
    const core = await runGate();

    expect(github.paginate).toHaveBeenCalledWith(github.rest.issues.listComments, {
      owner: 'owner',
      repo: 'plexus',
      issue_number: 123,
      per_page: 100,
    });
    expect(github.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'plexus',
      issue_number: 123,
      body: expect.stringContaining(marker),
    });
    expect(core.setOutput).toHaveBeenCalledWith('should_run', 'true');
  });

  it.each(['opened', 'reopened', 'ready_for_review'])(
    'skips an automatic %s event when a review already exists',
    async (action) => {
      comments.push({ user: { login: 'github-actions[bot]' }, body: `${marker}\nPrior review` });

      const core = await runGate('pull_request_target', action);

      expect(core.setOutput).toHaveBeenCalledWith('should_run', 'false');
      expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    }
  );

  it('does not retry an automatic attempt that only wrote its starting marker', async () => {
    await runGate();
    const core = await runGate('pull_request_target', 'ready_for_review');

    expect(core.setOutput).toHaveBeenCalledWith('should_run', 'false');
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('ignores markers posted by anyone except the Actions bot', async () => {
    comments.push({ user: { login: 'contributor' }, body: marker });

    const core = await runGate();

    expect(core.setOutput).toHaveBeenCalledWith('should_run', 'true');
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('allows explicit reruns without checking the automatic marker', async () => {
    comments.push({ user: { login: 'github-actions[bot]' }, body: marker });

    const core = await runGate('issue_comment');

    expect(core.setOutput).toHaveBeenCalledWith('should_run', 'true');
    expect(github.paginate).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('fails closed if the automatic attempt cannot be recorded', async () => {
    github.rest.issues.createComment.mockRejectedValue(new Error('GitHub API unavailable'));

    await expect(runGate()).rejects.toThrow('GitHub API unavailable');
  });

  it('updates the starting comment with the summary instead of duplicating the marker', async () => {
    await runGate();
    const summary = steps.find(
      (step: { name: string }) => step.name === 'Post detailed OCR summary'
    );
    const readReview = vi.fn(() =>
      JSON.stringify({ comments: [], summary: { files_reviewed: 1 } })
    );

    await runInNewContext(`(async () => { ${summary.with.script} })()`, {
      github,
      core: { warning: vi.fn() },
      context: {
        repo: { owner: 'owner', repo: 'plexus' },
        payload: { pull_request: { number: 123 } },
      },
      require: () => ({ readFileSync: readReview }),
      process: { env: { REVIEW_FILE: '/tmp/ocr-result.json' } },
    });

    expect(github.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'plexus',
      comment_id: 1,
      body: expect.stringContaining(marker),
    });
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('gates every subsequent step, including the always-run summary', () => {
    expect(gate).toBe(steps[0]);
    for (const step of steps.slice(1)) {
      expect(step.if).toContain("steps.review-gate.outputs.should_run == 'true'");
    }
    const summary = steps.find(
      (step: { name: string }) => step.name === 'Post detailed OCR summary'
    );
    expect(summary.if).toContain('always()');
  });
});
