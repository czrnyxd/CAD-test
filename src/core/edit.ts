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

/**
 * Position (centre, in the leg's own coordinates) for a new hole on the straight part [start, end]
 * of a leg: the middle when the leg has no holes yet, otherwise the place farthest from the
 * existing hole centres, so a new hole never lands on top of another one.
 */
export function freeHolePosition(existing: number[], start: number, end: number, length: number, margin = 0): number {
  const lo = start + length / 2 + margin;
  const hi = end - length / 2 - margin;
  const mid = (start + end) / 2;
  if (!existing.length || hi <= lo) return Math.round(mid);
  let best = Math.round(mid);
  let bestScore = -Infinity;
  for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) {
    const d = Math.min(...existing.map((e) => Math.abs(e - x)));
    const score = d - Math.abs(x - mid) * 1e-3; // prefer the middle on ties
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best;
}
