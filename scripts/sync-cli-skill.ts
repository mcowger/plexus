import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const sourcePath = join(import.meta.dir, '../.agents/skills/plexus-cli/SKILL.md');
const destinationPath = join(import.meta.dir, '../packages/cli/skills/plexus-cli/SKILL.md');
const modulePath = join(import.meta.dir, '../packages/cli/src/skill.ts');

await mkdir(dirname(destinationPath), { recursive: true });
const skill = await readFile(sourcePath, 'utf8');
await writeFile(destinationPath, skill);
await writeFile(modulePath, `export const plexusCliSkill = ${JSON.stringify(skill)};\n`);
