import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import Fastify, { FastifyInstance } from 'fastify';

import { ConfigService } from '../../../services/configuration/config-service';

const serviceState = (() => {
  const state = {
    quotas: {} as Record<string, unknown>,
    setSettingsBulk: mock(async () => {}),
    getAllUserQuotas: mock(async () => state.quotas),
  };
  return state;
})();

beforeEach(() => {
  spyOn(ConfigService, 'getInstance').mockImplementation(
    mock(() => ({
      setSettingsBulk: serviceState.setSettingsBulk,
      getRepository: mock(() => ({
        getAllUserQuotas: serviceState.getAllUserQuotas,
      })),
    })) as any
  );
});

import { registerConfigRoutes } from '../config';

describe('PATCH /v0/management/system-settings — default_quotas validation', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    serviceState.quotas = { 'my-quota': { type: 'daily', limitType: 'requests', limit: 100 } };
    serviceState.setSettingsBulk.mockClear();
    serviceState.getAllUserQuotas.mockClear();

    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  const patch = (payload: unknown) =>
    fastify.inject({
      method: 'PATCH',
      url: '/v0/management/system-settings',
      payload: payload as object,
    });

  it('400s when default_quotas references an undefined quota name', async () => {
    const res = await patch({ default_quotas: ['my-quota', 'ghost-quota'] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
    expect(res.json().error.message).toContain('ghost-quota');
    expect(serviceState.setSettingsBulk).not.toHaveBeenCalled();
  });

  it('400s when default_quotas is not an array', async () => {
    const res = await patch({ default_quotas: 'my-quota' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
    expect(serviceState.setSettingsBulk).not.toHaveBeenCalled();
  });

  it('400s when default_quotas contains non-string entries', async () => {
    const res = await patch({ default_quotas: [1] });

    expect(res.statusCode).toBe(400);
    expect(serviceState.setSettingsBulk).not.toHaveBeenCalled();
  });

  it('200s when every name exists in user_quotas', async () => {
    const res = await patch({ default_quotas: ['my-quota'] });

    expect(res.statusCode).toBe(200);
    expect(serviceState.setSettingsBulk).toHaveBeenCalledWith({ default_quotas: ['my-quota'] });
  });

  it('200s for an empty array', async () => {
    const res = await patch({ default_quotas: [] });

    expect(res.statusCode).toBe(200);
    expect(serviceState.setSettingsBulk).toHaveBeenCalledWith({ default_quotas: [] });
  });

  it('200s for null (clearing the setting)', async () => {
    const res = await patch({ default_quotas: null });

    expect(res.statusCode).toBe(200);
    expect(serviceState.setSettingsBulk).toHaveBeenCalledWith({ default_quotas: null });
  });

  it('leaves other settings free-form and skips the quota lookup', async () => {
    const res = await patch({ some_other_setting: 'whatever' });

    expect(res.statusCode).toBe(200);
    expect(serviceState.getAllUserQuotas).not.toHaveBeenCalled();
    expect(serviceState.setSettingsBulk).toHaveBeenCalledWith({ some_other_setting: 'whatever' });
  });
});
