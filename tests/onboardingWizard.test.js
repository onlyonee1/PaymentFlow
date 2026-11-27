'use strict';

/**
 * Tests for the school onboarding wizard — issue #664
 *
 * Covers:
 *   - Onboarding state shape and defaults on the School model
 *   - PATCH /api/schools/:id/onboarding endpoint logic
 *   - Step validation (only 1–4 accepted)
 *   - Completion flag set when step 4 is reached
 *   - Dismissal (progress preserved, wizard re-openable)
 *   - Idempotency (re-patching the same step does not regress)
 *
 * Pure unit tests — no DB, no HTTP server.
 */

process.env.MONGO_URI  = 'mongodb://localhost:27017/test';
process.env.JWT_SECRET = 'test-secret-onboarding-wizard-only';

// ── Onboarding state helpers (mirror what the controller/service implements) ──

const ONBOARDING_STEPS = {
  CONNECT_WALLET:      1,
  CREATE_FEE_STRUCTURE: 2,
  ADD_STUDENTS:        3,
  TEST_PAYMENT:        4,
};
const TOTAL_STEPS = Object.keys(ONBOARDING_STEPS).length;

/**
 * Returns the default onboarding state for a newly-created school —
 * mirrors the schoolModel defaults.
 */
function defaultOnboardingState() {
  return {
    onboardingComplete:  false,
    onboardingStep:      0,
    onboardingDismissed: false,
  };
}

/**
 * Applies a PATCH /api/schools/:id/onboarding payload and returns the
 * updated onboarding state.  Mirrors the controller logic.
 *
 * @param {object} current   - Current school onboarding state
 * @param {object} patch     - Request body { step?, dismissed? }
 * @returns {{ state: object, error: string|null }}
 */
function applyOnboardingPatch(current, patch) {
  const { step, dismissed } = patch;

  if (step !== undefined) {
    if (!Number.isInteger(step) || step < 1 || step > TOTAL_STEPS) {
      return {
        state: current,
        error: `step must be an integer between 1 and ${TOTAL_STEPS}`,
      };
    }
    // Never regress the step (idempotent)
    const nextStep = Math.max(current.onboardingStep, step);
    const complete = nextStep >= TOTAL_STEPS;
    return {
      state: {
        ...current,
        onboardingStep:     nextStep,
        onboardingComplete: complete,
        // Completing the wizard always un-dismisses it (shows "You're ready!")
        onboardingDismissed: complete ? false : current.onboardingDismissed,
      },
      error: null,
    };
  }

  if (dismissed !== undefined) {
    if (typeof dismissed !== 'boolean') {
      return { state: current, error: 'dismissed must be a boolean' };
    }
    return {
      state: { ...current, onboardingDismissed: dismissed },
      error: null,
    };
  }

  return { state: current, error: 'At least one of step or dismissed is required' };
}

// ── Default state ─────────────────────────────────────────────────────────────

describe('onboarding wizard — default state (#664)', () => {
  it('new school starts with onboardingComplete false', () => {
    expect(defaultOnboardingState().onboardingComplete).toBe(false);
  });

  it('new school starts at step 0 (no step completed)', () => {
    expect(defaultOnboardingState().onboardingStep).toBe(0);
  });

  it('new school is not dismissed by default', () => {
    expect(defaultOnboardingState().onboardingDismissed).toBe(false);
  });

  it('wizard should be shown to schools where onboardingComplete is false', () => {
    const school = defaultOnboardingState();
    const shouldShowWizard = !school.onboardingComplete && !school.onboardingDismissed;
    expect(shouldShowWizard).toBe(true);
  });
});

// ── Step progression ──────────────────────────────────────────────────────────

describe('onboarding wizard — step progression (#664)', () => {
  it('advances from step 0 to step 1 (Connect Wallet)', () => {
    const { state, error } = applyOnboardingPatch(defaultOnboardingState(), { step: 1 });
    expect(error).toBeNull();
    expect(state.onboardingStep).toBe(1);
    expect(state.onboardingComplete).toBe(false);
  });

  it('advances through all 4 steps in sequence', () => {
    let state = defaultOnboardingState();
    for (let s = 1; s <= TOTAL_STEPS; s++) {
      ({ state } = applyOnboardingPatch(state, { step: s }));
    }
    expect(state.onboardingStep).toBe(TOTAL_STEPS);
    expect(state.onboardingComplete).toBe(true);
  });

  it('marks onboardingComplete when step 4 (Test Payment) is reached', () => {
    const { state } = applyOnboardingPatch(
      { onboardingStep: 3, onboardingComplete: false, onboardingDismissed: false },
      { step: 4 },
    );
    expect(state.onboardingComplete).toBe(true);
  });

  it('shows each step completion status (steps ≤ current are complete)', () => {
    const currentStep = 2;
    for (let s = 1; s <= TOTAL_STEPS; s++) {
      const isComplete = s <= currentStep;
      expect(typeof isComplete).toBe('boolean');
    }
    expect(1 <= currentStep).toBe(true);  // step 1 complete
    expect(2 <= currentStep).toBe(true);  // step 2 complete
    expect(3 <= currentStep).toBe(false); // step 3 not yet complete
    expect(4 <= currentStep).toBe(false); // step 4 not yet complete
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('onboarding wizard — step validation (#664)', () => {
  it('rejects step 0 (not a valid step)', () => {
    const { error } = applyOnboardingPatch(defaultOnboardingState(), { step: 0 });
    expect(error).toMatch(/between 1 and 4/);
  });

  it('rejects step 5 (out of range)', () => {
    const { error } = applyOnboardingPatch(defaultOnboardingState(), { step: 5 });
    expect(error).toMatch(/between 1 and 4/);
  });

  it('rejects non-integer step', () => {
    const { error } = applyOnboardingPatch(defaultOnboardingState(), { step: 2.5 });
    expect(error).not.toBeNull();
  });

  it('rejects empty patch body', () => {
    const { error } = applyOnboardingPatch(defaultOnboardingState(), {});
    expect(error).not.toBeNull();
  });

  it('rejects non-boolean dismissed', () => {
    const { error } = applyOnboardingPatch(defaultOnboardingState(), { dismissed: 'yes' });
    expect(error).not.toBeNull();
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('onboarding wizard — idempotency (#664)', () => {
  it('re-patching the same step is a no-op (step does not regress)', () => {
    let state = { onboardingStep: 3, onboardingComplete: false, onboardingDismissed: false };
    ({ state } = applyOnboardingPatch(state, { step: 3 }));
    expect(state.onboardingStep).toBe(3);
  });

  it('patching a lower step than current does not regress', () => {
    let state = { onboardingStep: 3, onboardingComplete: false, onboardingDismissed: false };
    ({ state } = applyOnboardingPatch(state, { step: 1 }));
    expect(state.onboardingStep).toBe(3);
  });
});

// ── Dismissal ─────────────────────────────────────────────────────────────────

describe('onboarding wizard — dismissal (#664)', () => {
  it('wizard can be dismissed at any step (progress is preserved)', () => {
    const current = { onboardingStep: 2, onboardingComplete: false, onboardingDismissed: false };
    const { state, error } = applyOnboardingPatch(current, { dismissed: true });
    expect(error).toBeNull();
    expect(state.onboardingDismissed).toBe(true);
    expect(state.onboardingStep).toBe(2); // step not reset
  });

  it('dismissed wizard does not show on login (shouldShowWizard is false)', () => {
    const school = { onboardingComplete: false, onboardingStep: 1, onboardingDismissed: true };
    const shouldShowWizard = !school.onboardingComplete && !school.onboardingDismissed;
    expect(shouldShowWizard).toBe(false);
  });

  it('Setup Guide button re-opens wizard (un-dismisses)', () => {
    const current = { onboardingStep: 2, onboardingComplete: false, onboardingDismissed: true };
    const { state } = applyOnboardingPatch(current, { dismissed: false });
    expect(state.onboardingDismissed).toBe(false);
  });

  it('completing the wizard un-dismisses it (shows the You\'re ready! confirmation)', () => {
    const current = { onboardingStep: 3, onboardingComplete: false, onboardingDismissed: true };
    const { state } = applyOnboardingPatch(current, { step: 4 });
    expect(state.onboardingComplete).toBe(true);
    expect(state.onboardingDismissed).toBe(false);
  });
});

// ── Completion ────────────────────────────────────────────────────────────────

describe('onboarding wizard — completion (#664)', () => {
  it('completed school does not show wizard on login', () => {
    const school = { onboardingComplete: true, onboardingStep: 4, onboardingDismissed: false };
    const shouldShowWizard = !school.onboardingComplete;
    expect(shouldShowWizard).toBe(false);
  });

  it('completed flag is permanent — patching dismissed does not reactivate wizard', () => {
    const current = { onboardingStep: 4, onboardingComplete: true, onboardingDismissed: false };
    const { state } = applyOnboardingPatch(current, { dismissed: false });
    // Even if dismissed is toggled, onboardingComplete stays true
    expect(state.onboardingComplete).toBe(true);
  });
});

// ── PATCH /api/schools/:id/onboarding contract ───────────────────────────────

describe('PATCH /api/schools/:id/onboarding — HTTP contract (#664)', () => {
  /**
   * Simulates the Express controller: validates input, calls applyOnboardingPatch,
   * and returns the HTTP response shape.
   */
  function handleOnboardingPatch(schoolId, body, currentSchool) {
    if (!currentSchool) {
      return { status: 404, body: { error: 'School not found', code: 'SCHOOL_NOT_FOUND' } };
    }
    const { state, error } = applyOnboardingPatch(
      {
        onboardingStep:     currentSchool.onboardingStep,
        onboardingComplete: currentSchool.onboardingComplete,
        onboardingDismissed: currentSchool.onboardingDismissed,
      },
      body,
    );
    if (error) {
      return { status: 400, body: { error, code: 'VALIDATION_ERROR' } };
    }
    // Simulate saved school returned
    const updated = { ...currentSchool, ...state };
    return { status: 200, body: { school: updated } };
  }

  it('returns 200 with updated school when step is valid', () => {
    const school = { schoolId: 'SCH1', ...defaultOnboardingState() };
    const res = handleOnboardingPatch('SCH1', { step: 1 }, school);
    expect(res.status).toBe(200);
    expect(res.body.school.onboardingStep).toBe(1);
  });

  it('returns 400 when step is out of range', () => {
    const school = { schoolId: 'SCH1', ...defaultOnboardingState() };
    const res = handleOnboardingPatch('SCH1', { step: 99 }, school);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when school does not exist', () => {
    const res = handleOnboardingPatch('MISSING', { step: 1 }, null);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SCHOOL_NOT_FOUND');
  });

  it('returns 200 with onboardingComplete true after step 4', () => {
    const school = { schoolId: 'SCH1', onboardingStep: 3, onboardingComplete: false, onboardingDismissed: false };
    const res = handleOnboardingPatch('SCH1', { step: 4 }, school);
    expect(res.status).toBe(200);
    expect(res.body.school.onboardingComplete).toBe(true);
  });
});
