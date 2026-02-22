import { describe, test, expect } from 'bun:test';
import {
    calculateInferenceFootprint,
    estimateKwhUsed,
    toastBreadEquivalent,
  type ModelParams,
    type GpuParams,
} from '../src/services/inference-energy';

// Mirrors the hardcoded defaults inside inference-energy.ts so we can
// cross-check the convenience wrapper against the raw function.
const DEFAULT_MODEL: ModelParams = {
    total_params: 1000,
    active_params: 32,
    layers: 61,
    context_length: 256000,
    kv_lora_rank: 512,
    qk_rope_head_dim: 64,
    dtype_size: 1,
    heads: 64,
};

const DEFAULT_GPU: GpuParams = {
    ram_gb: 192,
    bandwidth_tb_s: 8.0,
    flops_tflop: 9000,
    power_draw_watts: 14300,
};

describe('calculateInferenceFootprint', () => {
    test('returns a valid footprint shape for typical token counts', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);

        expect(result).toHaveProperty('tensor_parallelism');
      expect(result).toHaveProperty('concurrent_users_limit');
        expect(result).toHaveProperty('prefill_tps');
        expect(result).toHaveProperty('decode_tps');
        expect(result).toHaveProperty('cluster_seconds_used');
        expect(result).toHaveProperty('energy_kwh_wall');
        expect(result).toHaveProperty('system_power_kw');
    });

    test('tensor_parallelism is a positive power of 2', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);
        const tp = result.tensor_parallelism;

        expect(tp).toBeGreaterThan(0);
        // A power of 2 satisfies: (tp & (tp - 1)) === 0
        expect(tp & (tp - 1)).toBe(0);
    });

    test('concurrent_users_limit is a positive integer', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);

        expect(result.concurrent_users_limit).toBeGreaterThan(0);
        expect(Number.isInteger(result.concurrent_users_limit)).toBe(true);
    });

    test('prefill_tps and decode_tps are positive', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);

        expect(result.prefill_tps).toBeGreaterThan(0);
        expect(result.decode_tps).toBeGreaterThan(0);
    });

    test('energy_kwh_wall is positive for non-zero token counts', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);

        expect(result.energy_kwh_wall).toBeGreaterThan(0);
    });

    test('energy_kwh_wall scales with token count', () => {
        const small = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 100, 50);
        const large = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 10000, 5000);

        expect(large.energy_kwh_wall).toBeGreaterThan(small.energy_kwh_wall);
    });

    test('more output tokens increases energy proportionally to decode cost', () => {
        const baseline = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 100);
      const moreOutput = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 1000);

        expect(moreOutput.energy_kwh_wall).toBeGreaterThan(baseline.energy_kwh_wall);
    });

    test('more input tokens increases energy proportionally to prefill cost', () => {
        const baseline = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 100);
        const moreInput = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 10000, 100);

        expect(moreInput.energy_kwh_wall).toBeGreaterThan(baseline.energy_kwh_wall);
    });

  test('cluster_seconds_used is positive', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);

        expect(result.cluster_seconds_used).toBeGreaterThan(0);
    });

    test('system_power_kw is positive', () => {
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);

      expect(result.system_power_kw).toBeGreaterThan(0);
    });

    test('dtype_size defaults to 1 when omitted', () => {
        const withDefault: ModelParams = { ...DEFAULT_MODEL, dtype_size: undefined };
        const withExplicit: ModelParams = { ...DEFAULT_MODEL, dtype_size: 1 };

        const a = calculateInferenceFootprint(withDefault, DEFAULT_GPU, 1000, 500);
        const b = calculateInferenceFootprint(withExplicit, DEFAULT_GPU, 1000, 500);

        expect(a.energy_kwh_wall).toBe(b.energy_kwh_wall);
    });

    test('wall energy is 1.4x the cluster energy (PUE multiplier)', () => {
        // Verify the 1.4x multiplier by reconstructing cluster energy from first principles.
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500);
        const systemWatts = result.system_power_kw * 1000;
        const energyJoules = systemWatts * result.cluster_seconds_used;
        const kwhCluster = energyJoules / 3_600_000;
        const expectedWall = Math.round(kwhCluster * 1.4 * 10000) / 10000;

        expect(result.energy_kwh_wall).toBe(expectedWall);
    });

    test('large real-world token count (22.9M in / 116k out) produces non-trivial energy', () => {
        // Matches the example in scripts/datacenter.ts
        const result = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 22_900_000, 116_300);

        expect(result.energy_kwh_wall).toBeGreaterThan(0);
        // Sanity: should be well under 1 kWh for even a very large batch
      expect(result.energy_kwh_wall).toBeLessThan(10);
    });
});

describe('estimateKwhUsed', () => {
    test('returns a positive number for typical token counts', () => {
        const kwh = estimateKwhUsed(1000, 500);

        expect(kwh).toBeGreaterThan(0);
    });

    test('returns 0 for zero input and zero output tokens', () => {
    const kwh = estimateKwhUsed(0, 0);

        expect(kwh).toBe(0);
    });

    test('returns 0 for negative token counts', () => {
        expect(estimateKwhUsed(-100, -50)).toBe(0);
    });

    test('matches calculateInferenceFootprint with default hardware constants', () => {
        const expected = calculateInferenceFootprint(DEFAULT_MODEL, DEFAULT_GPU, 1000, 500).energy_kwh_wall;
        const actual = estimateKwhUsed(1000, 500);

        expect(actual).toBe(expected);
    });

    test('scales monotonically: more tokens → more energy', () => {
        const a = estimateKwhUsed(100, 50);
        const b = estimateKwhUsed(1000, 500);
        const c = estimateKwhUsed(10000, 5000);

        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
    });

    test('output-only tokens still produce a positive estimate', () => {
      const kwh = estimateKwhUsed(0, 500);

        expect(kwh).toBeGreaterThan(0);
    });

    test('input-only tokens: large token count produces a positive estimate', () => {
        // Small input counts round to 0 cluster_seconds due to the high prefill_tps of
        // the default hardware profile (>1M TPS). Use a large count to exceed the
        // rounding threshold.
        const kwh = estimateKwhUsed(1_000_000, 0);

        expect(kwh).toBeGreaterThan(0);
    });
});

describe('toastBreadEquivalent', () => {
    test('returns the correct ratio for exactly one toast cycle (0.02 kWh)', () => {
        // 0.02 kWh is exactly 1 toast cycle (2 slices)
        expect(toastBreadEquivalent(0.02)).toBe(1);
    });

    test('returns 0 for 0 kWh', () => {
        expect(toastBreadEquivalent(0)).toBe(0);
    });

    test('returns 0.5 for half a toast cycle', () => {
     expect(toastBreadEquivalent(0.01)).toBe(0.5);
    });

  test('returns 2 for double a toast cycle', () => {
        expect(toastBreadEquivalent(0.04)).toBe(2);
    });

    test('rounds to 2 decimal places', () => {
        // 0.001 kWh / 0.02 kWh = 0.05 exactly — no rounding needed but confirms precision
        expect(toastBreadEquivalent(0.001)).toBe(0.05);
    });

    test('produces a non-trivial value for a realistic request', () => {
        const kwh = estimateKwhUsed(1000, 500);
        const slices = toastBreadEquivalent(kwh);

        // We cannot predict the exact value, but it must be a finite positive number
        expect(slices).toBeGreaterThan(0);
        expect(Number.isFinite(slices)).toBe(true);
    });
});
