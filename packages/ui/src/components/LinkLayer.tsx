import type { JSX } from 'react';

import { curveBetween, type Link, type Rect } from '../topology';

interface Props {
  links: Link[];
  /** Where every node currently sits, including the hub. */
  rects: Record<string, Rect>;
  /** Handle the operator is looking at; its links come forward. */
  focused?: string;
  /** Canvas extent, so the svg covers everything that can be dragged to. */
  extent: { width: number; height: number };
}

const STROKE: Record<Link['kind'], string> = {
  spine: 'var(--rule-strong)',
  message: 'var(--phos)',
  conflict: 'var(--coral)',
};

/**
 * The lines between terminals.
 *
 * One SVG under the windows, so a curve can pass behind a window rather than
 * over it. Message lines carry a travelling dot while they are warm, which is
 * the only motion on the canvas — when something moves here, something actually
 * moved between two agents.
 */
export function LinkLayer({ links, rects, focused, extent }: Props): JSX.Element {
  const drawn = links
    .map((link) => {
      const a = rects[link.from];
      const b = rects[link.to];
      if (!a || !b) return null;

      const { d, mid } = curveBetween(a, b);
      return { link, d, mid };
    })
    .filter((entry): entry is { link: Link; d: string; mid: { x: number; y: number } } => entry !== null)
    // Spines first so live traffic is drawn over the resting structure.
    .sort((left, right) => rank(left.link) - rank(right.link));

  return (
    <svg className="links" width={extent.width} height={extent.height} aria-hidden="true">
      <defs>
        <marker
          id="arrow-message"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--phos)" />
        </marker>
        <marker
          id="arrow-spine"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--rule-strong)" />
        </marker>
      </defs>

      {drawn.map(({ link, d, mid }) => {
        const touchesFocus = focused === link.from || focused === link.to;
        const width =
          link.kind === 'spine' ? 1 : link.kind === 'conflict' ? 1.75 : 1.25 + link.weight * 2.25;

        return (
          <g
            key={link.id}
            className={`link ${link.kind}${link.live ? ' warm' : ''}${touchesFocus ? ' near' : ''}`}
          >
            <path
              id={`path-${cssId(link.id)}`}
              d={d}
              fill="none"
              stroke={STROKE[link.kind]}
              strokeWidth={width}
              strokeLinecap="round"
              strokeDasharray={link.kind === 'conflict' ? '5 5' : undefined}
              markerEnd={
                link.kind === 'message'
                  ? 'url(#arrow-message)'
                  : link.kind === 'spine'
                    ? 'url(#arrow-spine)'
                    : undefined
              }
            />

            {link.kind === 'message' && link.live ? (
              <circle r="3" fill="var(--phos)" className="packet">
                <animateMotion dur="1.9s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1">
                  <mpath href={`#path-${cssId(link.id)}`} />
                </animateMotion>
              </circle>
            ) : null}

            {link.label && (link.live || link.kind === 'conflict') ? (
              <text x={mid.x} y={mid.y - 6} className="link-label" textAnchor="middle">
                {link.label.length > 34 ? `${link.label.slice(0, 33)}…` : link.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function rank(link: Link): number {
  if (link.kind === 'spine') return 0;
  if (link.kind === 'message') return 1;
  return 2;
}

/** Link ids carry handles, which may contain characters a selector cannot. */
function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
