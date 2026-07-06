#!/usr/bin/env bun
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATION_DIRS = [
  'packages/backend/drizzle/migrations',
  'packages/backend/drizzle/migrations_pg',
];

// Legacy random superhero names that are grandfathered in.
// Any NEW migration must have a descriptive name.
const LEGACY_NAMES = new Set([
  // sqlite
  '0000_elite_the_anarchist',
  '0001_absent_spencer_smythe',
  '0002_nappy_ben_parker',
  '0003_good_nebula',
  '0004_strong_mesmero',
  '0005_luxuriant_lyja',
  '0006_spooky_dagger',
  '0007_useful_gamma_corps',
  '0008_striped_gauntlet',
  '0009_concerned_nebula',
  '0010_absent_magma',
  '0011_spooky_richard_fisk',
  '0012_faulty_warbird',
  '0013_smiling_pestilence',
  '0014_boring_wolfpack',
  '0015_parched_rogue',
  '0016_superb_sally_floyd',
  '0017_cooing_rawhide_kid',
  '0018_giant_red_hulk',
  '0019_cool_the_hand',
  '0020_grey_viper',
  '0022_even_celestials',
  '0023_tan_the_santerians',
  '0024_lush_maginty',
  '0025_cynical_silver_samurai',
  '0026_mean_scrambler',
  '0027_thin_norrin_radd',
  '0028_dapper_pestilence',
  '0029_simple_skullbuster',
  '0030_illegal_forgotten_one',
  '0031_parched_patriot',
  '0032_mysterious_triathlon',
  '0033_kind_shriek',
  '0034_nebulous_carlie_cooper',
  '0035_secret_living_tribunal',
  '0036_nasty_vengeance',
  '0037_hesitant_umar',
  '0038_illegal_nextwave',
  '0039_nebulous_matthew_murdock',
  '0040_motionless_baron_zemo',
  '0041_fearless_baron_strucker',
  '0042_careless_shotgun',
  '0043_rare_skullbuster',
  // postgres
  '0000_round_millenium_guard',
  '0001_chilly_jean_grey',
  '0002_handy_paibok',
  '0003_nice_master_chief',
  '0004_fixed_iron_fist',
  '0005_military_inertia',
  '0006_tearful_sharon_ventura',
  '0007_previous_supreme_intelligence',
  '0008_wild_silver_fox',
  '0009_keen_mentor',
  '0010_flawless_diamondback',
  '0011_tense_loners',
  '0012_nosy_wild_pack',
  '0013_shocking_shotgun',
  '0014_foamy_iron_fist',
  '0015_stormy_gambit',
  '0016_sleepy_the_hand',
  '0017_uneven_maverick',
  '0018_tough_sir_ram',
  '0019_misty_cannonball',
  '0020_concerned_maximus',
  '0021_tan_tana_nile',
  '0022_clever_moon_knight',
  '0026_classy_annihilus',
  '0027_adorable_paibok',
  '0028_cute_shooting_star',
  '0029_flat_black_cat',
  '0030_acoustic_katie_power',
  '0031_eminent_alex_power',
  '0032_fast_lethal_legion',
  '0033_colossal_exiles',
  '0034_even_lady_vermin',
  '0035_crazy_mindworm',
  '0036_serious_captain_stacy',
  '0037_massive_quentin_quire',
  '0038_cultured_songbird',
  '0039_gigantic_spiral',
  '0040_fuzzy_metal_master',
  '0041_steady_the_twelve',
  '0042_mean_crusher_hogan',
  '0043_spotty_spacker_dave',
  '0044_spooky_mojo',
  '0045_clever_darkstar',
  '0046_gifted_mandrill',
  '0047_cloudy_red_skull',
  '0048_previous_squadron_sinister',
  '0049_bouncy_scrambler',
  '0050_marvelous_jackal',
  '0051_magenta_talon',
  '0052_chilly_living_mummy',
  '0053_typical_zaladane',
  '0054_huge_malice',
  '0055_mature_luke_cage',
]);

const DESCRIPTIVE_PREFIXES = [
  'add_',
  'create_',
  'drop_',
  'rename_',
  'update_',
  'fix_',
  'remove_',
  'convert_',
  'index_',
  'migrate_',
  'refactor_',
  'change_',
  'delete_',
  'insert_',
  'alter_',
  'setup_',
  'init_',
  'jsonb_',
  'replace_',
  'merge_',
  'split_',
  'extract_',
  'normalize_',
  'enable_',
  'disable_',
  'auto_',
  'test_',
  'release_',
];

const PROJECT_DOMAIN_TERMS = new Set([
  'adapter',
  'alias',
  'api',
  'auth',
  'autosync',
  'balance',
  'billing',
  'cache',
  'checker',
  'checkers',
  'compaction',
  'config',
  'cooldown',
  'debug',
  'gateway',
  'inference',
  'key',
  'keys',
  'log',
  'logs',
  'mcp',
  'metadata',
  'model',
  'models',
  'oauth',
  'provider',
  'providers',
  'quota',
  'request',
  'response',
  'route',
  'scoped',
  'server',
  'setting',
  'settings',
  'snapshot',
  'sync',
  'token',
  'tokens',
  'trace',
  'traces',
  'usage',
  'user',
]);

function isDescriptive(name: string): boolean {
  if (DESCRIPTIVE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return true;
  }

  const parts = name.split('_').filter(Boolean);
  const domainTermCount = parts.filter((part) => PROJECT_DOMAIN_TERMS.has(part)).length;

  return parts.length >= 2 && domainTermCount >= 2;
}

let hasError = false;

for (const dir of MIGRATION_DIRS) {
  const fullDir = join(process.cwd(), dir);
  let files: string[];
  try {
    files = readdirSync(fullDir).filter((f) => f.endsWith('.sql'));
  } catch {
    continue;
  }

  for (const file of files) {
    const base = file.replace(/\.sql$/, '');
    if (LEGACY_NAMES.has(base)) continue;

    const match = base.match(/^\d{4}_(.+)$/);
    if (!match) {
      console.error(
        `Error: Migration "${file}" in ${dir} does not match expected pattern "NNNN_descriptive_name.sql".`
      );
      hasError = true;
      continue;
    }

    const namePart = match[1];
    if (!isDescriptive(namePart)) {
      console.error(`Error: Migration "${file}" in ${dir} has a non-descriptive name.`);
      console.error(
        '  Names should start with a verb like: add_, create_, drop_, rename_, update_, fix_, remove_, convert_, jsonb_, etc.'
      );
      hasError = true;
    }
  }
}

if (hasError) {
  console.error(
    '\nPlease use "bun run generate-migrations --name <descriptive-name>" to generate migrations.'
  );
  process.exit(1);
}

console.log('Migration naming looks good.');
