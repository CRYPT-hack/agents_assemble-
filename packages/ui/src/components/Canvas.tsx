import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import type { Lease, Member, Message } from '../types';
import type { Live } from '../useLive';
import { buildLinks, HUB, ringLayout, type Rect } from '../topology';
import { LinkLayer } from './LinkLayer';
import { TerminalWindow, type WindowFrame } from './TerminalWindow';

interface Props {
  members: Member[];
  messages: Message[];
  leases: Lease[];
  live: Live;
  focused?: string;
  onFocus(handle: string): void;
  onStart(handle: string): void;
  onStop(handle: string): void;
  workspaceName: string;
}

const DEFAULT_SIZE = { width: 460, height: 300 };
const EXTENT = { width: 6000, height: 4000 };
const CENTRE = { x: EXTENT.width / 2, y: EXTENT.height / 2 };
const HUB_SIZE = { width: 168, height: 92 };

type Frames = Record<string, WindowFrame>;

interface Drag {
  handle: string;
  mode: 'move' | 'resize';
  pointerX: number;
  pointerY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

/**
 * The workspace as a place rather than a list.
 *
 * Every agent is a terminal window you can move, resize and type into, and the
 * lines between them are the coordination actually happening: who is talking to
 * whom, and who is standing on the same files. Pan with a drag on the
 * background, zoom with the wheel.
 */
export function Canvas(props: Props): JSX.Element {
  const { members, messages, leases, live, focused } = props;

  const surface = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ x: number; y: number; pointerX: number; pointerY: number } | null>(null);

  const [frames, setFrames] = useState<Frames>(() => restore(props.workspaceName));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 0, y: 0, scale: 0.85 });
  const [now, setNow] = useState(() => Date.now());

  // Links fade as traffic ages, so the canvas needs a slow heartbeat of its own.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, []);

  // Place anybody who has just been enlisted, and forget anybody discharged.
  useEffect(() => {
    setFrames((current) => {
      const handles = members.map((member) => member.handle);
      const missing = handles.filter((handle) => !current[handle]);
      if (missing.length === 0 && Object.keys(current).length === handles.length) return current;

      const seeded = ringLayout(handles, DEFAULT_SIZE, CENTRE);
      const next: Frames = {};

      for (const handle of handles) {
        next[handle] = current[handle] ??
          (seeded[handle] ? { ...seeded[handle], ...DEFAULT_SIZE } : { x: CENTRE.x, y: CENTRE.y, ...DEFAULT_SIZE });
      }
      return next;
    });
  }, [members]);

  useEffect(() => {
    persist(props.workspaceName, frames);
  }, [frames, props.workspaceName]);

  /** Centre the view on the crew — also what the "fit" control does. */
  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;

    const list = Object.values(frames);
    if (list.length === 0) {
      setView({ x: box.width / 2 - CENTRE.x * 0.85, y: box.height / 2 - CENTRE.y * 0.85, scale: 0.85 });
      return;
    }

    const minX = Math.min(...list.map((frame) => frame.x));
    const minY = Math.min(...list.map((frame) => frame.y));
    const maxX = Math.max(...list.map((frame) => frame.x + frame.width));
    const maxY = Math.max(...list.map((frame) => frame.y + frame.height));

    // Never fit below the point where terminal text stops being readable — a
    // crew that does not fit is meant to be panned around, not squinted at.
    const scale = Math.max(
      0.55,
      Math.min(1, (box.width - 120) / (maxX - minX), (box.height - 160) / (maxY - minY)),
    );

    setView({
      x: box.width / 2 - ((minX + maxX) / 2) * scale,
      y: box.height / 2 - ((minY + maxY) / 2) * scale,
      scale,
    });
  }, [frames]);

  // Fit once, as soon as there is something to fit.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || members.length === 0) return;
    fitted.current = true;
    fit();
  }, [members.length, fit]);

  const rects = useMemo<Record<string, Rect>>(() => {
    const map: Record<string, Rect> = {
      [HUB]: { x: CENTRE.x - HUB_SIZE.width / 2, y: CENTRE.y - HUB_SIZE.height / 2, ...HUB_SIZE },
    };

    for (const member of members) {
      const frame = frames[member.handle];
      if (!frame) continue;
      map[member.handle] = collapsed.has(member.handle)
        ? { x: frame.x, y: frame.y, width: frame.width, height: 66 }
        : frame;
    }
    return map;
  }, [members, frames, collapsed]);

  const links = useMemo(
    () => buildLinks(members, messages, leases, now),
    [members, messages, leases, now],
  );

  // -- pointer handling ----------------------------------------------------

  const startDrag = (handle: string, mode: Drag['mode']) => (event: ReactPointerEvent) => {
    const frame = frames[handle];
    if (!frame || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    props.onFocus(handle);

    dragRef.current = {
      handle,
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: frame.x,
      startY: frame.y,
      startWidth: frame.width,
      startHeight: frame.height,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    const drag = dragRef.current;
    const pan = panRef.current;

    if (drag) {
      const dx = (event.clientX - drag.pointerX) / view.scale;
      const dy = (event.clientY - drag.pointerY) / view.scale;

      setFrames((current) => {
        const frame = current[drag.handle];
        if (!frame) return current;

        const next =
          drag.mode === 'move'
            ? { ...frame, x: Math.round(drag.startX + dx), y: Math.round(drag.startY + dy) }
            : {
                ...frame,
                width: Math.max(320, Math.round(drag.startWidth + dx)),
                height: Math.max(180, Math.round(drag.startHeight + dy)),
              };

        return { ...current, [drag.handle]: next };
      });
      return;
    }

    if (pan) {
      setView((current) => ({
        ...current,
        x: pan.x + (event.clientX - pan.pointerX),
        y: pan.y + (event.clientY - pan.pointerY),
      }));
    }
  };

  const endPointer = (): void => {
    dragRef.current = null;
    panRef.current = null;
  };

  const onSurfaceDown = (event: ReactPointerEvent): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    panRef.current = { x: view.x, y: view.y, pointerX: event.clientX, pointerY: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  /** Zoom toward the cursor, so the thing under the pointer stays under it. */
  const onWheel = (event: ReactWheelEvent): void => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;

    const scale = Math.min(1.6, Math.max(0.2, view.scale * (event.deltaY < 0 ? 1.08 : 0.926)));
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;

    setView({
      scale,
      x: px - ((px - view.x) / view.scale) * scale,
      y: py - ((py - view.y) / view.scale) * scale,
    });
  };

  const toggleCollapse = (handle: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  };

  const talking = links.some((link) => link.kind === 'message' && link.live);

  return (
    <div
      className="canvas"
      ref={surface}
      onPointerDown={onSurfaceDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
    >
      <div
        className="world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <LinkLayer links={links} rects={rects} extent={EXTENT} {...(focused ? { focused } : {})} />

        <div
          className={`hub${talking ? ' busy' : ''}`}
          style={{ transform: `translate(${rects[HUB]!.x}px, ${rects[HUB]!.y}px)` }}
        >
          <span className="label">workspace bus</span>
          <strong>{props.workspaceName}</strong>
          <span className="hub-meta">
            {members.length} member{members.length === 1 ? '' : 's'} · {leases.length} claim
            {leases.length === 1 ? '' : 's'}
          </span>
        </div>

        {members.map((member) => {
          const frame = frames[member.handle];
          if (!frame) return null;

          return (
            <TerminalWindow
              key={member.handle}
              member={member}
              frame={frame}
              live={live}
              focused={focused === member.handle}
              collapsed={collapsed.has(member.handle)}
              onFocus={() => props.onFocus(member.handle)}
              onDragStart={startDrag(member.handle, 'move')}
              onResizeStart={startDrag(member.handle, 'resize')}
              onCollapse={() => toggleCollapse(member.handle)}
              onStart={() => props.onStart(member.handle)}
              onStop={() => props.onStop(member.handle)}
            />
          );
        })}
      </div>

      <div className="viewport-tools">
        <button className="ghost" onClick={fit} title="Frame the whole crew">
          fit
        </button>
        <button
          className="ghost"
          onClick={() => setView((current) => ({ ...current, scale: Math.max(0.2, current.scale - 0.12) }))}
        >
          −
        </button>
        <span className="zoom">{Math.round(view.scale * 100)}%</span>
        <button
          className="ghost"
          onClick={() => setView((current) => ({ ...current, scale: Math.min(1.6, current.scale + 0.12) }))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* Window positions are a per-viewer convenience, so they live in the browser. */

function storageKey(workspace: string): string {
  return `assemble:layout:${workspace}`;
}

function restore(workspace: string): Frames {
  try {
    const raw = window.localStorage.getItem(storageKey(workspace));
    return raw ? (JSON.parse(raw) as Frames) : {};
  } catch {
    return {};
  }
}

function persist(workspace: string, frames: Frames): void {
  try {
    window.localStorage.setItem(storageKey(workspace), JSON.stringify(frames));
  } catch {
    // Private windows and blocked site data are fine; the layout just resets.
  }
}
