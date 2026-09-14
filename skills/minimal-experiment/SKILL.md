---
name: minimal-experiment
description: Use when a consequential uncertainty can be reduced with a cheap, reversible, decision-relevant test.
version: 1.0.0
---

# Minimal Experiment

## Triggers

Use for uncertain assumptions, competing mechanisms, or implementation choices with testable outcomes.

## Anti-triggers

Do not treat production rollout, irreversible migration, unsafe action, or an unmeasurable demo as an experiment.

## Inputs

Hypothesis, decision threshold, observable metric, guardrails, cost limit, and stopping rule.

## Procedure

1. Express one falsifiable hypothesis.
2. Identify the smallest intervention that separates meaningful outcomes.
3. Define baseline, metric, threshold, guardrails, and stop condition.
4. State how each result changes the decision.

## Observable output

An experiment card with hypothesis, intervention, metric, threshold, guardrails, stopping rule, and decision mapping.

## Composition

Combine with `first-principles`, `reverse-engineering`, or `cross-domain-transfer`; use no more than three reasoning skills total.

## Permissions

This skill authorizes design only; execution needs the underlying action’s permission.
