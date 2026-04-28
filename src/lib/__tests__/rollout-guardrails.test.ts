import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GUARDRAIL_CONFIG,
  championBaseline,
  createDefaultGuardrailConfig,
  evaluateGuardrails,
  evaluateMetric,
} from '../rollout-guardrails';
import type { GuardrailSample } from '../types';

function sample(
  overrides: Partial<GuardrailSample>,
  fallbackVariant: GuardrailSample['variant'] = 'challenger',
): GuardrailSample {
  return {
    requestId: 'req_x',
    timestamp: '2026-04-17T00:00:00.000Z',
    variant: overrides.variant ?? fallbackVariant,
    mismatch: false,
    toolError: false,
    latencyMs: 100,
    ...overrides,
  };
}

function fill(
  count: number,
  pattern: (i: number) => Partial<GuardrailSample>,
): GuardrailSample[] {
  return Array.from({ length: count }, (_, i) => sample(pattern(i)));
}

describe('evaluateGuardrails', () => {
  const config = createDefaultGuardrailConfig();

  it('returns null when the rolling window is not yet full', () => {
    const samples = fill(5, () => ({ mismatch: true }));
    expect(evaluateGuardrails(samples, config, 100)).toBeNull();
  });

  it('returns null when no metric is above its threshold', () => {
    const samples = fill(20, () => ({}));
    expect(evaluateGuardrails(samples, config, 100)).toBeNull();
  });

  it('flags mismatch_rate once it crosses 10% over a full window', () => {
    const samples = fill(20, (i) => ({ mismatch: i < 3 }));
    const result = evaluateGuardrails(samples, config, 100);
    expect(result?.metric).toBe('mismatch_rate');
    expect(result?.value).toBeCloseTo(0.15, 5);
  });

  it('flags tool_error_rate once it crosses 15% over a full window', () => {
    const samples = fill(20, (i) => ({ toolError: i < 5 }));
    const result = evaluateGuardrails(samples, config, 100);
    expect(result?.metric).toBe('tool_error_rate');
    expect(result?.value).toBeCloseTo(0.25, 5);
  });

  it('flags latency_factor when challenger latency exceeds 1.5x champion baseline', () => {
    const samples: GuardrailSample[] = [
      ...fill(20, () => ({ variant: 'challenger', latencyMs: 300 })),
    ];
    const result = evaluateGuardrails(samples, config, 100);
    expect(result?.metric).toBe('latency_factor');
    expect(result?.value).toBeCloseTo(3, 5);
  });

  it('ignores latency_factor when baseline is null', () => {
    const samples = fill(20, () => ({ latencyMs: 10000 }));
    const result = evaluateGuardrails(samples, config, null);
    expect(result).toBeNull();
  });

  it('mismatch_rate is computed only from challenger samples', () => {
    const samples: GuardrailSample[] = [
      ...fill(20, () => ({ variant: 'champion', mismatch: true })),
      ...fill(20, () => ({ variant: 'challenger', mismatch: false })),
    ];
    const result = evaluateGuardrails(samples, config, 100);
    expect(result).toBeNull();
  });

  it('returns the first breached metric in priority order', () => {
    const samples = fill(20, (i) => ({
      mismatch: i < 5,
      toolError: i < 5,
    }));
    const result = evaluateGuardrails(samples, config, 100);
    expect(result?.metric).toBe('mismatch_rate');
  });
});

describe('evaluateMetric', () => {
  const config = DEFAULT_GUARDRAIL_CONFIG;

  it('reports zero value when no challenger samples exist', () => {
    const samples: GuardrailSample[] = fill(5, () => ({ variant: 'champion' }));
    const result = evaluateMetric('mismatch_rate', samples, config, 100);
    expect(result.value).toBe(0);
    expect(result.sampleCount).toBe(0);
  });
});

describe('championBaseline', () => {
  it('returns the mean latency of champion samples within the window', () => {
    const samples: GuardrailSample[] = [
      sample({ variant: 'champion', latencyMs: 100 }),
      sample({ variant: 'champion', latencyMs: 200 }),
      sample({ variant: 'challenger', latencyMs: 999 }),
    ];
    expect(championBaseline(samples, 20)).toBe(150);
  });

  it('returns null when no champion samples exist', () => {
    expect(championBaseline([sample({ variant: 'challenger' })], 20)).toBeNull();
  });
});
