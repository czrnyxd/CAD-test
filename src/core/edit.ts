import type { Step } from './model';

/**
 * Remove step i from the chain, keeping the chain valid (legs and bends alternating):
 * - removing a bend merges its two neighbouring legs (lengths add up, holes of the second leg
 *   keep their place on the bar),
 * - removing a leg also removes the bend before it (or after it, for the first leg).
 * The last remaining leg cannot be removed.
 */
export function removeStep(steps: Step[], i: number): Step[] {
  const s = steps[i];
  if (!s) return steps;
  if (s.kind === 'straight') {
    if (steps.length <= 1) return steps;
    if (i > 0 && steps[i - 1].kind !== 'straight') return steps.filter((_, k) => k !== i && k !== i - 1);
    if (steps[i + 1] && steps[i + 1].kind !== 'straight') return steps.filter((_, k) => k !== i && k !== i + 1);
    return steps.filter((_, k) => k !== i);
  }
  const prev = steps[i - 1];
  const next = steps[i + 1];
  if (prev?.kind === 'straight' && next?.kind === 'straight') {
    const holes = [...(prev.holes ?? []), ...(next.holes ?? []).map((h) => ({ ...h, position: h.position + prev.length }))];
    const merged = { ...prev, length: prev.length + next.length, ...(holes.length ? { holes } : {}) };
    return [...steps.slice(0, i - 1), merged, ...steps.slice(i + 2)];
  }
  return steps.filter((_, k) => k !== i);
}
