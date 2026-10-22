import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface PaseoJsonScriptConfig {
  type: 'service' | 'command';
  command: string;
}

export function loadPaseoScriptConfig(
  target: string,
  cwd = process.cwd()
): PaseoJsonScriptConfig | null {
  const paseoJsonPath = join(cwd, 'paseo.json');
  if (!existsSync(paseoJsonPath)) return null;

  try {
    const paseoJson = JSON.parse(readFileSync(paseoJsonPath, 'utf8'));
    return paseoJson.scripts?.[target] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves environmental variables in paseo.json command string ($PASEO_PORT, etc.)
 */
export function resolveFallbackCommand(targetConfig: PaseoJsonScriptConfig, port: string): string {
  return targetConfig.command
    .replace(/\$PASEO_PORT/g, port)
    .replace(/\$PASEO_SERVICE_DEV_PORT/g, port);
}
