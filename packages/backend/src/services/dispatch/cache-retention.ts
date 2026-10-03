import { getApiBaseType } from '../../utils/api-format';
import { DEFAULT_STICKY_TTL_MS } from '../routing/sticky-session-manager';

const HOUR_MS = 60 * 60 * 1000;

export function resolveStickyCacheTtlMs(payload: any, apiType: string): number {
  const baseType = getApiBaseType(apiType);
  if (baseType === 'chat' || baseType === 'responses') {
    if (payload?.prompt_cache_options?.ttl === '30m') return 30 * 60 * 1000;
    if (payload?.prompt_cache_retention === '24h') return 24 * HOUR_MS;
    return DEFAULT_STICKY_TTL_MS;
  }
  if (baseType !== 'messages') return DEFAULT_STICKY_TTL_MS;

  const markers = [payload?.cache_control];
  for (const field of ['system', 'tools', 'messages']) {
    if (!Array.isArray(payload?.[field])) continue;
    for (const block of payload[field]) {
      markers.push(block?.cache_control);
      if (Array.isArray(block?.content)) {
        for (const part of block.content) markers.push(part?.cache_control);
      }
    }
  }
  return markers.some((marker) => marker?.type === 'ephemeral' && marker.ttl === '1h')
    ? HOUR_MS
    : DEFAULT_STICKY_TTL_MS;
}
