import { describe, expect, it } from 'vitest';
import { straight } from './core/model';
import { stampAfter, useStore } from './store';

const at = () => Date.parse(useStore.getState().bar.updatedAt);

describe('undo / redo and the date of the last change', () => {
  it('a restored version is newer than the one it replaces', () => {
    const { updateSteps, undo, redo } = useStore.getState();
    const original = useStore.getState().bar;

    updateSteps((steps) => [...steps, straight(50)]);
    const edited = useStore.getState().bar;
    expect(edited.steps).toHaveLength(original.steps.length + 1);
    expect(at()).toBeGreaterThan(Date.parse(original.updatedAt));

    // The server keeps the version with the newer date, so undo must not bring the old date back.
    undo();
    expect(useStore.getState().bar.steps).toEqual(original.steps);
    expect(at()).toBeGreaterThan(Date.parse(edited.updatedAt));

    const undone = useStore.getState().bar;
    redo();
    expect(useStore.getState().bar.steps).toEqual(edited.steps);
    expect(at()).toBeGreaterThan(Date.parse(undone.updatedAt));
  });

  it('stampAfter is later than a date from a clock that runs ahead', () => {
    const ahead = new Date(Date.now() + 60_000).toISOString();
    expect(Date.parse(stampAfter(ahead))).toBe(Date.parse(ahead) + 1);
    expect(Date.parse(stampAfter('not a date'))).toBeLessThanOrEqual(Date.now());
  });
});
