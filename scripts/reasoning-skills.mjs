export const REASONING_METHOD_GROUPS = Object.freeze({
  "problem-framing": Object.freeze(["socratic-clarification", "first-principles", "reverse-engineering", "dual-layer-explanation"]),
  "solution-comparison": Object.freeze(["horizontal-vertical-analysis", "expert-perspectives", "steelman-comparison", "cross-domain-transfer"]),
  "evidence-and-experiments": Object.freeze(["fact-checking", "minimal-experiment"]),
});

export const REASONING_SKILL_NAMES = Object.freeze(Object.keys(REASONING_METHOD_GROUPS));

function normalizedTerms(values, field) {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`invalid reasoning skill ${field}`);
  }
  return values.map(value => value.trim().toLocaleLowerCase());
}

export function evaluateTriggerExample(contract, example) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) throw new Error("invalid reasoning skill contract");
  if (typeof example !== "string" || example.trim().length === 0) throw new Error("invalid trigger example");
  const input = example.toLocaleLowerCase();
  const triggers = normalizedTerms(contract.triggerTerms, "trigger terms");
  const antiTriggers = normalizedTerms(contract.antiTriggerTerms, "anti-trigger terms");
  return triggers.some(term => input.includes(term)) && !antiTriggers.some(term => input.includes(term));
}
