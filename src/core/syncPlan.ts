import type { Busbar } from './model';

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface SyncPlan {
  /** Local projects the server does not have or has older – send them. */
  toPush: Busbar[];
  /** Remote projects that are new or newer – take them. */
  toApply: Busbar[];
  /** Local projects deleted on another device after their last change here – remove them. */
  toRemoveLocal: string[];
  /** Projects deleted on this device – delete them on the server. */
  toDeleteRemote: string[];
}

const t = (iso: string) => Date.parse(iso) || 0;

/**
 * Decide what to exchange with the server. The newer `updatedAt` wins (the server also keeps
 * every previous version, so a lost race can be recovered). A deletion wins over changes made
 * before it, and loses against a later change.
 */
export function planSync(
  local: Record<string, Busbar>,
  remote: Busbar[],
  remoteDeleted: Tombstone[],
  localDeleted: Tombstone[],
): SyncPlan {
  const plan: SyncPlan = { toPush: [], toApply: [], toRemoveLocal: [], toDeleteRemote: [] };
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const remoteDel = new Map(remoteDeleted.map((d) => [d.id, d.deletedAt]));
  const localDel = new Map(localDeleted.map((d) => [d.id, d.deletedAt]));

  for (const [id, deletedAt] of localDel) {
    const r = remoteById.get(id);
    // Deleted here – unless someone changed it on another device afterwards.
    if (!r || t(r.updatedAt) <= t(deletedAt)) plan.toDeleteRemote.push(id);
    else plan.toApply.push(r);
  }

  for (const r of remote) {
    if (localDel.has(r.id)) continue;
    const l = local[r.id];
    if (!l || t(r.updatedAt) > t(l.updatedAt)) plan.toApply.push(r);
    else if (t(l.updatedAt) > t(r.updatedAt)) plan.toPush.push(l);
  }

  for (const l of Object.values(local)) {
    if (remoteById.has(l.id) || localDel.has(l.id)) continue;
    const deletedAt = remoteDel.get(l.id);
    if (deletedAt && t(deletedAt) >= t(l.updatedAt)) plan.toRemoveLocal.push(l.id);
    else plan.toPush.push(l);
  }
  return plan;
}
