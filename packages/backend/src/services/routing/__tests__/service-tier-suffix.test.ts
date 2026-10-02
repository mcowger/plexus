import { describe, expect, test } from 'vitest';
import { serviceTierNames, splitServiceTierSuffix } from '../service-tier-suffix';

describe('splitServiceTierSuffix', () => {
  test.each(['auto', 'default', 'standard', 'flex', 'priority', 'fast', 'ultrafast'])(
    'splits @%s off the model',
    (tier) => {
      expect(splitServiceTierSuffix(`gpt-6-luna@${tier}`)).toEqual({
        model: 'gpt-6-luna',
        serviceTier: tier,
      });
    }
  );

  test('matches the tier case-insensitively and normalises it to lower case', () => {
    expect(splitServiceTierSuffix('gpt-6-luna@FLEX')).toEqual({
      model: 'gpt-6-luna',
      serviceTier: 'flex',
    });
  });

  test('splits on the last delimiter, leaving earlier ones in the model', () => {
    expect(splitServiceTierSuffix('vendor@2024@flex')).toEqual({
      model: 'vendor@2024',
      serviceTier: 'flex',
    });
  });

  test.each([
    ['has no delimiter', 'gpt-6-luna'],
    ['names an unknown tier', 'gpt-6-luna@turbo'],
    ['has an empty tier', 'gpt-6-luna@'],
    ['has no model before the delimiter', '@flex'],
    ['has more after the tier', 'gpt-6-luna@flex:high'],
    ['uses a preset-style suffix', 'gpt-6-luna@preset/flex'],
    ['has whitespace around the tier', 'gpt-6-luna@flex '],
  ])('leaves a name unchanged when it %s', (_label, name) => {
    expect(splitServiceTierSuffix(name)).toEqual({ model: name });
  });
});

describe('serviceTierNames', () => {
  test.each(['auto', 'flex', 'ultrafast'])('names only @%s for a tier with no alias', (tier) => {
    expect(serviceTierNames('gpt-6-luna', tier)).toEqual([`gpt-6-luna@${tier}`]);
  });

  test.each(['priority', 'fast'])('names both spellings of the priority tier for @%s', (tier) => {
    expect(serviceTierNames('gpt-6-luna', tier)).toEqual([
      'gpt-6-luna@priority',
      'gpt-6-luna@fast',
    ]);
  });

  test.each(['default', 'standard'])(
    'names both spellings of the standard tier for @%s',
    (tier) => {
      expect(serviceTierNames('gpt-6-luna', tier)).toEqual([
        'gpt-6-luna@default',
        'gpt-6-luna@standard',
      ]);
    }
  );
});
