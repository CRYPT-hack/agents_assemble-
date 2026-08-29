import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLinks, curveBetween, HUB, ringLayout } from '../src/topology.ts';
import type { Lease, Member, Message } from '../src/types.ts';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

function member(handle: string): Member {
  return {
    id: `mbr_${handle}`,
    handle,
    agentId: 'claude',
    mission: '',
    status: 'working',
    worktree: `/tmp/${handle}`,
    branch: `assemble/${handle}`,
    createdAt: new Date(NOW).toISOString(),
  };
}

function message(from: string, to: string[], secondsAgo: number, subject = 'hello'): Message {
  return {
    id: `msg_${from}_${to.join('_')}_${secondsAgo}`,
    kind: to.length > 0 ? 'direct' : 'broadcast',
    from,
    to,
    subject,
    body: '',
    priority: 'normal',
    threadId: 'thr',
    createdAt: new Date(NOW - secondsAgo * 1000).toISOString(),
  };
}

function lease(holder: string, paths: string[]): Lease {
  return {
    id: `lse_${holder}`,
    holder,
    paths,
    mode: 'exclusive',
    reason: 'editing',
    acquiredAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
  };
}

describe('links', () => {
  const crew = [member('alice'), member('bob')];

  it('ties every member to the bus', () => {
    const links = buildLinks(crew, [], [], NOW);
    const spines = links.filter((link) => link.kind === 'spine');

    assert.equal(spines.length, 2);
    assert.ok(spines.every((link) => link.from === HUB));
  });

  it('draws a line only between members who have talked', () => {
    const links = buildLinks(crew, [message('alice', ['bob'], 2)], [], NOW);
    const talk = links.filter((link) => link.kind === 'message');

    assert.equal(talk.length, 1);
    assert.equal(talk[0]?.from, 'alice');
    assert.equal(talk[0]?.to, 'bob');
    assert.equal(talk[0]?.live, true);
    assert.equal(talk[0]?.label, 'hello');
  });

  it('cools a line down once the traffic is old', () => {
    const links = buildLinks(crew, [message('alice', ['bob'], 600)], [], NOW);
    assert.equal(links.find((link) => link.kind === 'message')?.live, false);
  });

  it('thickens the busier line', () => {
    const links = buildLinks(
      crew,
      [
        message('alice', ['bob'], 3, 'one'),
        message('alice', ['bob'], 4, 'two'),
        message('bob', ['alice'], 5, 'back'),
      ],
      [],
      NOW,
    );

    const forward = links.find((link) => link.kind === 'message' && link.from === 'alice');
    const back = links.find((link) => link.kind === 'message' && link.from === 'bob');

    assert.equal(forward?.weight, 1);
    assert.ok((back?.weight ?? 1) < 1);
  });

  it('routes a broadcast through the bus', () => {
    const links = buildLinks(crew, [message('alice', [], 2)], [], NOW);
    const talk = links.find((link) => link.kind === 'message');

    assert.equal(talk?.from, 'alice');
    assert.equal(talk?.to, HUB);
  });

  it('ignores mail to somebody who has left', () => {
    const links = buildLinks(crew, [message('alice', ['ghost'], 2)], [], NOW);
    assert.equal(links.some((link) => link.kind === 'message'), false);
  });

  it('marks two members standing on the same files', () => {
    const links = buildLinks(crew, [], [lease('alice', ['src/**']), lease('bob', ['src/parser.ts'])], NOW);
    const clash = links.find((link) => link.kind === 'conflict');

    assert.ok(clash);
    assert.equal(clash?.from, 'alice');
    assert.equal(clash?.to, 'bob');
  });

  it('leaves separate files alone', () => {
    const links = buildLinks(crew, [], [lease('alice', ['src/**']), lease('bob', ['docs/**'])], NOW);
    assert.equal(links.some((link) => link.kind === 'conflict'), false);
  });
});

describe('geometry', () => {
  it('leaves and arrives on the faces that point at each other', () => {
    const left = { x: 0, y: 0, width: 100, height: 100 };
    const right = { x: 400, y: 0, width: 100, height: 100 };

    const { d } = curveBetween(left, right);
    assert.match(d, /^M 100 50 C /);
    assert.match(d, /400 50$/);
  });

  it('spreads members around the bus without stacking them', () => {
    const placed = ringLayout(['a', 'b', 'c'], { width: 400, height: 260 }, { x: 1000, y: 1000 });
    const points = Object.values(placed);

    assert.equal(points.length, 3);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const gap = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        assert.ok(gap > 300, `windows ${i} and ${j} are only ${Math.round(gap)}px apart`);
      }
    }
  });
});
