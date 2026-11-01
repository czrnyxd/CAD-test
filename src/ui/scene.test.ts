import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildAssembly } from '../core/assembly';
import { DEFAULT_SETTINGS, bend, newBusbar, straight } from '../core/model';
import { buildPartObjects } from './scene';

const settings = { ...DEFAULT_SETTINGS, minLeg: 0 };

function hitsAt(obj: THREE.Mesh, x: number, z: number): boolean {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(obj).length > 0;
}

describe('3D holes', () => {
  const bar = newBusbar({ width: 40, thickness: 10, material: 'Cu' }, [
    straight(200, [
      { position: 50, offset: 0, diameter: 13, slot: 0 },
      { position: 120, offset: 0, diameter: 13, slot: 30 },
    ]),
    bend(90, 'up', 10),
    straight(100),
  ]);
  const [obj] = buildPartObjects(buildAssembly(bar, settings).parts);
  const mesh = obj.mesh;

  it('round hole is a real opening', () => {
    expect(hitsAt(mesh, 50, 0)).toBe(false); // through the hole centre
    expect(hitsAt(mesh, 50, 5)).toBe(false); // inside Ø13
    expect(hitsAt(mesh, 50, 8)).toBe(true); // outside the hole
    expect(hitsAt(mesh, 30, 0)).toBe(true); // solid material
  });

  it('slot is open along its length', () => {
    expect(hitsAt(mesh, 120 - 10, 0)).toBe(false);
    expect(hitsAt(mesh, 120 + 10, 0)).toBe(false);
    expect(hitsAt(mesh, 120 + 17, 0)).toBe(true);
  });

  it('hole walls exist (side ray hits the wall inside the hole)', () => {
    const ray = new THREE.Raycaster(new THREE.Vector3(50, 0, 0), new THREE.Vector3(1, 0, 0));
    const hit = ray.intersectObject(mesh)[0];
    expect(hit).toBeDefined();
    expect(hit.point.x).toBeCloseTo(56.5, 0);
  });

  it('mesh normals point outwards on the top face', () => {
    const ray = new THREE.Raycaster(new THREE.Vector3(30, 100, 0), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(mesh)[0];
    expect(hit.face!.normal.y).toBeGreaterThan(0.9);
  });
});
