import { AssembleError, invalid } from '../errors.js';
import { newId, nowIso } from '../ids.js';
import type { EventStore } from '../store/events.js';
import type { LeaseStore } from '../store/leases.js';
import type { Lease, LeaseMode } from '../types.js';
import { normalisePattern, overlappingPairs } from '../leases/overlap.js';

export interface AcquireOptions {
  holder: string;
  paths: string[];
  mode?: LeaseMode;
  reason?: string;
  ttlSeconds?: number;
}

export interface LeaseConflict {
  /** The lease already held by somebody else. */
  lease: Lease;
  /** Which requested pattern collides with which held pattern. */
  pairs: Array<[string, string]>;
}

export interface AcquireResult {
  granted?: Lease;
  conflicts: LeaseConflict[];
}

/**
 * Advisory file leases.
 *
 * An agent says "I am about to edit these paths" before it edits them. Nothing
 * stops it from editing anyway — the filesystem is not locked — but the
 * workspace can now answer "who else is in this file", which is the question
 * that actually prevents two agents rewriting the same module.
 *
 * Two `shared` leases coexist; anything involving an `exclusive` lease does not.
 */
export class Leases {
  constructor(
    private readonly store: LeaseStore,
    private readonly events: EventStore,
    private readonly defaultTtlSeconds: number,
  ) {}

  acquire(options: AcquireOptions): AcquireResult {
    const paths = options.paths.map(normalisePattern).filter(Boolean);
    if (paths.length === 0) throw invalid('A lease needs at least one path');

    const mode = options.mode ?? 'exclusive';
    const now = nowIso();
    const conflicts = this.conflictsFor(options.holder, paths, mode, now);

    if (conflicts.length > 0) {
      this.events.append('lease.conflict', options.holder, {
        paths,
        mode,
        blockedBy: conflicts.map((conflict) => conflict.lease.holder),
      });
      return { conflicts };
    }

    const ttl = options.ttlSeconds ?? this.defaultTtlSeconds;
    const lease: Lease = {
      id: newId('lse'),
      holder: options.holder,
      paths,
      mode,
      reason: options.reason ?? '',
      acquiredAt: now,
      expiresAt: new Date(Date.parse(now) + ttl * 1000).toISOString(),
    };

    this.store.insert(lease);
    this.events.append('lease.acquired', options.holder, {
      leaseId: lease.id,
      paths,
      mode,
      expiresAt: lease.expiresAt,
    });

    return { granted: lease, conflicts: [] };
  }

  /** Live leases held by someone else that collide with `paths`. */
  conflictsFor(holder: string, paths: string[], mode: LeaseMode, at: string = nowIso()): LeaseConflict[] {
    const conflicts: LeaseConflict[] = [];

    for (const lease of this.store.active(at)) {
      if (lease.holder === holder) continue;
      if (mode === 'shared' && lease.mode === 'shared') continue;

      const pairs = overlappingPairs(paths, lease.paths);
      if (pairs.length > 0) conflicts.push({ lease, pairs });
    }

    return conflicts;
  }

  release(leaseId: string, holder: string): void {
    const lease = this.store.find(leaseId);
    if (!lease) throw new AssembleError('not_found', `No lease ${leaseId}`, { leaseId });
    if (lease.holder !== holder) {
      throw new AssembleError('conflict', `Lease ${leaseId} belongs to ${lease.holder}`, {
        leaseId,
        holder: lease.holder,
      });
    }

    if (this.store.release(leaseId)) {
      this.events.append('lease.released', holder, { leaseId, paths: lease.paths });
    }
  }

  /** Hand back everything a member holds — called when its process exits. */
  releaseAll(holder: string): number {
    const count = this.store.releaseAllFor(holder);
    if (count > 0) this.events.append('lease.released', holder, { count, reason: 'member ended' });
    return count;
  }

  renew(leaseId: string, holder: string, ttlSeconds?: number): Lease {
    const lease = this.store.find(leaseId);
    if (!lease) throw new AssembleError('not_found', `No lease ${leaseId}`, { leaseId });
    if (lease.holder !== holder) {
      throw new AssembleError('conflict', `Lease ${leaseId} belongs to ${lease.holder}`, { leaseId });
    }

    // A lapsed claim is one somebody else may already have taken over. Renewing
    // it would quietly hand the same paths to two members at once.
    if (lease.releasedAt || Date.parse(lease.expiresAt) <= Date.now()) {
      throw new AssembleError('conflict', `Lease ${leaseId} has already lapsed — claim the paths again`, {
        leaseId,
        expiresAt: lease.expiresAt,
        releasedAt: lease.releasedAt,
      });
    }

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const renewed = this.store.renew(leaseId, expiresAt);
    if (!renewed) throw new AssembleError('conflict', `Lease ${leaseId} has already lapsed`, { leaseId });

    return { ...lease, expiresAt };
  }

  active(): Lease[] {
    return this.store.active();
  }

  heldBy(holder: string): Lease[] {
    return this.store.activeFor(holder);
  }

  /** Who currently claims each of these paths, if anyone. */
  whoHolds(paths: string[]): Array<{ path: string; holders: string[] }> {
    const active = this.store.active();
    return paths.map((path) => {
      const normalised = normalisePattern(path);
      const holders = active
        .filter((lease) => overlappingPairs([normalised], lease.paths).length > 0)
        .map((lease) => lease.holder);
      return { path: normalised, holders: [...new Set(holders)] };
    });
  }
}
