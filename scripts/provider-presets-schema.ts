#!/usr/bin/env bun
/** Generate/check the editor schema from the shared runtime preset contract. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { ProviderPresetSchema } from '../packages/shared/src/provider-presets';
import { parseAndValidatePresets } from '../packages/backend/src/services/provider-presets';

const schemaUrl =
  'https://raw.githubusercontent.com/mcowger/plexus/main/packages/backend/data/provider-presets.schema.json';
const schemaPath = fileURLToPath(
  new URL('../packages/backend/data/provider-presets.schema.json', import.meta.url)
);
const catalogPath = fileURLToPath(
  new URL('../packages/backend/data/provider-presets.json', import.meta.url)
);

type JsonSchema = Record<string, any>;

export function generateSchema(): JsonSchema {
  // Structural rules come directly from Zod. Cross-field refinements that Zod
  // cannot emit are appended here; the runtime parser remains authoritative.
  const schema: JsonSchema = z.toJSONSchema(
    z
      .object({
        $schema: z.literal(schemaUrl),
        $comment: z.string().optional(),
        presets: z.array(ProviderPresetSchema),
      })
      .strict(),
    { target: 'draft-2020-12', io: 'input' }
  );
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  schema.$id = schemaUrl;
  schema.title = 'Plexus provider presets catalog';
  const preset: JsonSchema = schema.properties.presets.items;
  preset.properties.apiBaseUrl.minProperties = 1;
  preset.properties.apiBaseUrl.additionalProperties.pattern = '^[hH][tT][tT][pP][sS]://';
  preset.properties.docsUrl.pattern = '^[hH][tT][tT][pP][sS]://';
  const quirks: JsonSchema = preset.properties.piAiQuirks;
  quirks.minProperties = 1;
  // These implications mirror the Zod refinements; model-level inheritance of
  // reasoning from a target and placeholder references remain runtime checks.
  for (const [target, definition] of Object.entries<JsonSchema>(quirks.properties)) {
    const targetSchema = definition;
    targetSchema.allOf = [
      {
        if: { type: 'object', required: ['thinkingLevelMap'] },
        then: {
          type: 'object',
          properties: { reasoning: { const: true } },
          required: ['reasoning'],
        },
      },
    ];
    // A model may inherit a target's reasoning declaration, but an explicit
    // reasoning: false cannot accompany its own reasoning-level map.
    targetSchema.properties.models.additionalProperties.allOf = [
      {
        if: { type: 'object', required: ['thinkingLevelMap'] },
        then: { type: 'object', properties: { reasoning: { const: true } } },
      },
    ];
    preset.allOf ??= [];
    preset.allOf.push({
      if: {
        type: 'object',
        properties: { piAiQuirks: { type: 'object', required: [target] } },
        required: ['piAiQuirks'],
      },
      then: { type: 'object', properties: { apiBaseUrl: { type: 'object', required: [target] } } },
    });
  }
  preset.allOf.push(
    { not: { type: 'object', required: ['piAiProvider', 'piAiQuirks'] } },
    {
      if: {
        type: 'object',
        properties: { autoCompat: { const: true } },
        required: ['autoCompat'],
      },
      then: {
        anyOf: [
          { type: 'object', required: ['piAiProvider'] },
          { type: 'object', required: ['piAiQuirks'] },
        ],
      },
    }
  );
  return schema;
}

async function main(): Promise<void> {
  const raw = `${JSON.stringify(generateSchema(), null, 2)}\n`;
  const generated = execFileSync('bunx', ['biome', 'format', '--stdin-file-path', schemaPath], {
    input: raw,
    encoding: 'utf8',
  });
  const write = process.argv.includes('--write');
  if (write) {
    await writeFile(schemaPath, generated);
  } else {
    const published = await readFile(schemaPath, 'utf8');
    if (published !== generated) {
      throw new Error(
        'Provider presets editor schema is stale; run bun run generate:provider-presets-schema'
      );
    }
  }

  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const valid = ajv.compile(schema);
  if (!valid(catalog)) {
    throw new Error(`Catalog fails editor JSON Schema: ${ajv.errorsText(valid.errors)}`);
  }
  parseAndValidatePresets(catalog, catalogPath); // includes cross-entry duplicate IDs
  console.log(
    write
      ? 'Generated and validated provider preset schema'
      : 'Provider preset schema and catalog match'
  );
}

if (import.meta.main) await main();
