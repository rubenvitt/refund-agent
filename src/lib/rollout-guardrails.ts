import { generatePrefixedId } from './audit';
import type {
  CanaryPercent,
  GuardrailBreach,
  GuardrailConfig,
  GuardrailMetricEvaluation,
  GuardrailMetricId,
  GuardrailSample,
} from './types';

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  mismatch_rate: { threshold: 0.1, window: 20 },
  tool_error_rate: { threshold: 0.15, window: 20 },
  latency_factor: { threshold: 1.5, window: 20 },
};

export function createDefaultGuardrailConfig(): GuardrailConfig {
  return {
    mismatch_rate: { ...DEFAULT_GUARDRAIL_CONFIG.mismatch_rate },
    tool_error_rate: { ...DEFAULT_GUARDRAIL_CONFIG.tool_error_rate },
    latency_factor: { ...DEFAULT_GUARDRAIL_CONFIG.latency_factor },
  };
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.slice(Math.max(0, arr.length - n));
}

function rateOf(samples: GuardrailSample[], pick: (s: GuardrailSample) => boolean): number {
  if (samples.length === 0) return 0;
  const hits = samples.reduce((n, s) => (pick(s) ? n + 1 : n), 0);
  return hits / samples.length;
}

function meanLatency(samples: GuardrailSample[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, s) => sum + s.latencyMs, 0) / samples.length;
}

export function evaluateMetric(
  metric: GuardrailMetricId,
  samples: GuardrailSample[],
  config: GuardrailConfig,
  championBaselineLatencyMs: number | null,
): GuardrailMetricEvaluation {
  const { threshold, window } = config[metric];
  const challengerSamples = lastN(
    samples.filter((s) => s.variant === 'challenger'),
    window,
  );
  const sampleCount = challengerSamples.length;

  let value = 0;
  if (metric === 'mismatch_rate') {
    value = rateOf(challengerSamples, (s) => s.mismatch);
  } else if (metric === 'tool_error_rate') {
    value = rateOf(challengerSamples, (s) => s.toolError);
  } else if (metric === 'latency_factor') {
    if (
      championBaselineLatencyMs == null ||
      championBaselineLatencyMs <= 0 ||
      sampleCount === 0
    ) {
      value = 0;
    } else {
      value = meanLatency(challengerSamples) / championBaselineLatencyMs;
    }
  }

  return { metric, value, threshold, window, sampleCount };
}

/**
 * Returns the first metric that has collected at least `window` samples and
 * crossed its threshold, or null if nothing has breached yet.
 */
export function evaluateGuardrails(
  samples: GuardrailSample[],
  config: GuardrailConfig,
  championBaselineLatencyMs: number | null,
): GuardrailMetricEvaluation | null {
  const metrics: GuardrailMetricId[] = [
    'mismatch_rate',
    'tool_error_rate',
    'latency_factor',
  ];
  for (const metric of metrics) {
    const result = evaluateMetric(
      metric,
      samples,
      config,
      championBaselineLatencyMs,
    );
    if (result.sampleCount >= result.window && result.value > result.threshold) {
      return result;
    }
  }
  return null;
}

export function championBaseline(
  samples: GuardrailSample[],
  window: number,
): number | null {
  const championSamples = lastN(
    samples.filter((s) => s.variant === 'champion'),
    window,
  );
  if (championSamples.length === 0) return null;
  return meanLatency(championSamples);
}

export function createBreachRecord(
  evaluation: GuardrailMetricEvaluation,
  previousCanaryPercent: CanaryPercent,
): GuardrailBreach {
  return {
    id: generatePrefixedId('grb'),
    timestamp: new Date().toISOString(),
    previousCanaryPercent,
    ...evaluation,
  };
}
