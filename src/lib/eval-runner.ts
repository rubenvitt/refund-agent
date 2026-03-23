import type {
  EvalCase,
  EvalResult,
  RunTrace,
  DemoState,
  RouteDecision,
} from './types';

export function scoreEvalCase(
  evalCase: EvalCase,
  trace: RunTrace,
  originalState: DemoState,
  updatedState: DemoState
): EvalResult {
  const { expectations } = evalCase;

  // 1. Route match
  const routeMatch = trace.route === expectations.expectedRoute;

  // 2. Required tools called
  const actualToolNames = trace.toolCalls.map((tc) => tc.toolName);
  const requiredToolsCalled = expectations.requiredTools.every((tool) =>
    actualToolNames.includes(tool)
  );

  // 3. Forbidden tools avoided
  const forbiddenToolsAvoided = expectations.forbiddenTools.every(
    (tool) => !actualToolNames.includes(tool)
  );

  // 3b. Sequence correct — deterministic ordering check
  let sequenceCorrect: boolean;
  if (expectations.requiredSequence && expectations.requiredSequence.length > 0) {
    // Filter actual calls to only those in the required sequence
    const relevantCalls = actualToolNames.filter((t) =>
      expectations.requiredSequence!.includes(t)
    );
    // Check that the first occurrence of each required tool appears in order
    const firstOccurrences = expectations.requiredSequence.map((t) =>
      actualToolNames.indexOf(t)
    );
    sequenceCorrect =
      firstOccurrences.every((idx) => idx !== -1) &&
      firstOccurrences.every((idx, i) => i === 0 || idx > firstOccurrences[i - 1]);
  } else {
    sequenceCorrect = true; // no sequence requirement
  }

  // 3c. No redundant calls — same tool + identical args called more than once
  const callSignatures = trace.toolCalls.map(
    (tc) => `${tc.toolName}::${JSON.stringify(tc.arguments)}`
  );
  const noRedundantCalls =
    callSignatures.length === new Set(callSignatures).size;

  // 3d. Efficient path — actual call count within budget
  let efficientPath: boolean;
  if (expectations.maxToolCalls != null) {
    efficientPath = trace.toolCalls.length <= expectations.maxToolCalls;
  } else {
    efficientPath = true; // no budget set
  }

  // 4. Approval correct
  let approvalCorrect: boolean;
  if (expectations.approvalExpected) {
    // At least one tool call should have required approval
    approvalCorrect = trace.toolCalls.some(
      (tc) => tc.approvalRequired && tc.approvalStatus !== 'not_required'
    );
  } else {
    // No tool call should have been blocked waiting for approval
    approvalCorrect = !trace.toolCalls.some(
      (tc) => tc.approvalStatus === 'pending'
    );
  }

  // 5. Side effect correct
  let sideEffectCorrect: boolean;
  if (!expectations.destructiveSideEffectAllowed) {
    // No state changes should have occurred
    const hasStateChanges = trace.stateChanges.length > 0;
    sideEffectCorrect = !hasStateChanges;
  } else {
    // Destructive side effects are allowed — check that appropriate changes
    // happened (if required tools include destructive ones like refund_order)
    const destructiveToolsCalled = expectations.requiredTools.filter(
      (t) => t === 'refund_order'
    );
    if (destructiveToolsCalled.length > 0) {
      // Expect at least some state change
      sideEffectCorrect = trace.stateChanges.length > 0;
    } else {
      sideEffectCorrect = true;
    }
  }

  // 6. Mismatch detected
  let mismatchDetected: boolean;
  if (expectations.expectedMismatch) {
    mismatchDetected = trace.mismatches.length > 0;
  } else {
    // If no mismatch expected, we consider it correct regardless of
    // whether mismatches were detected (they shouldn't be, but detecting
    // extra mismatches doesn't mean the eval case failed on this dimension)
    mismatchDetected = true;
  }

  const scores = {
    routeMatch,
    requiredToolsCalled,
    forbiddenToolsAvoided,
    sequenceCorrect,
    noRedundantCalls,
    efficientPath,
    approvalCorrect,
    sideEffectCorrect,
    mismatchDetected,
  };

  const passed = Object.values(scores).every((v) => v === true);

  // Build mismatch reason
  let mismatchReason: string | null = null;
  if (!passed) {
    const reasons: string[] = [];
    if (!routeMatch) {
      reasons.push(
        `Route mismatch: expected "${expectations.expectedRoute}", got "${trace.route}"`
      );
    }
    if (!requiredToolsCalled) {
      const missing = expectations.requiredTools.filter(
        (t) => !actualToolNames.includes(t)
      );
      reasons.push(`Missing required tools: ${missing.join(', ')}`);
    }
    if (!forbiddenToolsAvoided) {
      const used = expectations.forbiddenTools.filter((t) =>
        actualToolNames.includes(t)
      );
      reasons.push(`Forbidden tools used: ${used.join(', ')}`);
    }
    if (!sequenceCorrect) {
      const seq = expectations.requiredSequence ?? [];
      const actualOrder = actualToolNames.filter((t) => seq.includes(t));
      reasons.push(
        `Sequence violation: expected [${seq.join(' → ')}], got [${actualOrder.join(' → ')}]`
      );
    }
    if (!noRedundantCalls) {
      const dupes = callSignatures.filter(
        (sig, i) => callSignatures.indexOf(sig) !== i
      );
      reasons.push(`Redundant tool calls: ${dupes.join(', ')}`);
    }
    if (!efficientPath) {
      reasons.push(
        `Path too long: ${trace.toolCalls.length} calls (max ${expectations.maxToolCalls})`
      );
    }
    if (!approvalCorrect) {
      reasons.push(
        expectations.approvalExpected
          ? 'Approval was expected but not requested'
          : 'Unexpected approval request was made'
      );
    }
    if (!sideEffectCorrect) {
      reasons.push(
        expectations.destructiveSideEffectAllowed
          ? 'Expected state changes did not occur'
          : 'Unexpected state changes occurred'
      );
    }
    if (!mismatchDetected) {
      reasons.push('Expected mismatch was not detected');
    }
    mismatchReason = reasons.join('; ');
  }

  return {
    caseId: evalCase.id,
    passed,
    actualRoute: trace.route as RouteDecision | null,
    actualTools: actualToolNames,
    scores,
    mismatchReason,
    trace,
    durationMs: 0, // caller should set this based on actual timing
  };
}
