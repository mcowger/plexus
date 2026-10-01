import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { ConfigService } from '../../../services/configuration/config-service';
import { registerConfigRoutes } from '../config';

/**
 * Route-level regressions for the whole-graph alias validations wired into
 * PUT/PATCH /v0/management/aliases. These use the real ConfigService with
 * registered spies (no module re-mock) so the actual assert* helpers run.
 */
describe('alias write routes — auto routing graph validation', () => {
  let fastify: ReturnType<typeof Fastify>;
  let service: ConfigService;
  let repo: {
    getAllAliases: ReturnType<typeof vi.fn>;
    getAlias: ReturnType<typeof vi.fn>;
  };
  let saveAlias: ReturnType<typeof vi.fn>;
  let existingModels: Record<string, unknown>;

  const concreteTarget = (overrides: Record<string, unknown> = {}) => ({
    provider: 'provider-a',
    model: 'fast',
    auto_profile: { capability: 'standard', specialties: ['chat'], reasoning: 'normal' },
    ...overrides,
  });

  const autoAlias = (overrides: Record<string, unknown> = {}) => ({
    type: 'text',
    auto_routing: { mode: 'active', classifier_alias: 'judge' },
    target_groups: [{ name: 'Main', selector: 'auto', targets: [concreteTarget()] }],
    ...overrides,
  });

  const put = (slug: string, payload: unknown) =>
    fastify.inject({
      method: 'PUT',
      url: `/v0/management/aliases/${slug}`,
      payload: payload as object,
    });

  const patch = (slug: string, payload: unknown) =>
    fastify.inject({
      method: 'PATCH',
      url: `/v0/management/aliases/${slug}`,
      payload: payload as object,
    });

  beforeEach(async () => {
    ConfigService.resetInstance();
    service = ConfigService.getInstance();
    existingModels = {};

    repo = {
      getAllAliases: vi.fn(async () => existingModels),
      getAlias: vi.fn(async (slug: string) => existingModels[slug]),
    };
    saveAlias = registerSpy(service, 'saveAlias').mockResolvedValue(undefined);
    registerSpy(service, 'getRepository').mockReturnValue(repo as never);

    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    ConfigService.resetInstance();
  });

  it('PUT 400s on an unknown classifier alias with the explicit message', async () => {
    existingModels = { judge: { type: 'decisions', target_groups: [] } };

    const res = await put(
      'magic',
      autoAlias({ auto_routing: { mode: 'active', classifier_alias: 'ghost' } })
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("unknown classifier alias 'ghost'");
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('PUT 400s when the classifier alias is not a Decisions alias', async () => {
    existingModels = {
      judge: {
        type: 'text',
        target_groups: [{ name: 'Main', selector: 'random', targets: [concreteTarget()] }],
      },
    };

    const res = await put('magic', autoAlias());

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('requires a Decisions classifier alias');
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('PUT 400s when an auto target references another auto alias', async () => {
    existingModels = {
      child: autoAlias(),
      judge: { type: 'decisions', target_groups: [] },
    };

    const res = await put(
      'magic',
      autoAlias({
        target_groups: [
          {
            name: 'Main',
            selector: 'auto',
            targets: [{ alias: 'child', auto_profile: { capability: 'standard' } }],
          },
        ],
      })
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('nested auto aliases are not supported');
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('PUT 400s on malformed auto routing settings before graph validation', async () => {
    const res = await put(
      'magic',
      autoAlias({ auto_routing: { mode: 'turbo', classifier_alias: 'judge' } })
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('PUT saves a valid active config and preserves metadata', async () => {
    existingModels = { judge: { type: 'decisions', target_groups: [] } };

    const res = await put('magic', autoAlias({ metadata: { source: 'disabled' } }));

    expect(res.statusCode).toBe(200);
    expect(saveAlias).toHaveBeenCalledTimes(1);
    const call = saveAlias.mock.calls[0] as unknown[];
    expect(call[0]).toBe('magic');
    const saved = call[1] as {
      metadata: unknown;
      auto_routing: { classifier_alias: string };
      target_groups: Array<{ selector: string }>;
    };
    expect(saved.metadata).toEqual({ source: 'disabled' });
    expect(saved.auto_routing.classifier_alias).toBe('judge');
    expect(saved.target_groups[0]?.selector).toBe('auto');
  });

  it('PUT saves an off-mode config with an otherwise-invalid classifier and preserves metadata', async () => {
    existingModels = {};

    const res = await put(
      'magic',
      autoAlias({
        auto_routing: { mode: 'off', classifier_alias: 'ghost' },
        metadata: { source: 'disabled' },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(saveAlias).toHaveBeenCalledTimes(1);
    const saved = saveAlias.mock.calls[0]?.[1] as { metadata: unknown } | undefined;
    expect(saved?.metadata).toEqual({ source: 'disabled' });
  });

  it('PATCH 400s on an unknown classifier alias with the explicit message', async () => {
    existingModels = {
      magic: autoAlias(),
      judge: { type: 'decisions', target_groups: [] },
    };

    const res = await patch('magic', {
      auto_routing: { mode: 'active', classifier_alias: 'ghost' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("unknown classifier alias 'ghost'");
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('PUT 500s when the alias store read fails unexpectedly', async () => {
    repo.getAllAliases.mockRejectedValue(new Error('db exploded'));

    const res = await put('magic', autoAlias());

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Internal server error');
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('PUT 500s when the alias save fails unexpectedly', async () => {
    existingModels = { judge: { type: 'decisions', target_groups: [] } };
    saveAlias.mockRejectedValue(new Error('db exploded'));

    const res = await put('magic', autoAlias());

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Internal server error');
  });
});
