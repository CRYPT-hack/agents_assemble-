import type { JSX } from 'react';

import type { Lease } from '../types';

interface Props {
  leases: Lease[];
}

function remaining(expiresAt: string): string {
  const seconds = Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `${seconds}s left`;
  return `${Math.round(seconds / 60)}m left`;
}

/** Who has declared intent over which files, right now. */
export function Leases({ leases }: Props): JSX.Element {
  if (leases.length === 0) {
    return <p className="empty">No files are claimed. Everyone is out of each other&apos;s way.</p>;
  }

  return (
    <ul className="leases">
      {leases.map((lease) => (
        <li key={lease.id}>
          <div className="row">
            <strong>{lease.holder}</strong>
            <span className={`mode ${lease.mode}`}>{lease.mode}</span>
            <time>{remaining(lease.expiresAt)}</time>
          </div>
          <ul className="paths">
            {lease.paths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          {lease.reason ? <p className="reason">{lease.reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}
