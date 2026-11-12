// Spec 11.2, the tab bar: one tab per open file, the + button, Save and the app menu.
// Spec 22.2: a tab is dragged along the bar to reorder the tabs. Pointer events, not HTML5
// drag and drop, because with dragDropEnabled WebView2 hands HTML5 drag events to Tauri.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { TabSnapshot } from "../session/DocumentSession";
import { dropIndex, isDrag, shiftFor, type TabEdges } from "../util/tabDrop";
import AppMenu from "./AppMenu";
import { useServices } from "./services";

const SIGNED_TOOLTIP =
  "This PDF carries a digital signature. A change that rewrites the file will break it. PDFluffer warns you first.";

/** Within this many pixels of either end of a strip that scrolls, a drag scrolls it. */
const EDGE_SCROLL_ZONE = 24;
const EDGE_SCROLL_STEP = 12;

/** A press on a tab, which becomes a drag once it has moved far enough. */
interface Press {
  id: string;
  pointerId: number;
  from: number;
  /** Where the press began: the pointer on screen, and in the strip's own coordinates. */
  startX: number;
  startY: number;
  startStripX: number;
  /** Every tab's edges when the press began, in the strip's own coordinates. */
  edges: TabEdges[];
  /** The dragged tab's width plus the gap after it: how far the others move aside. */
  step: number;
  dragging: boolean;
  /** Escape put the tab back. The press still swallows the click that ends it. */
  cancelled: boolean;
  to: number;
}

/** What the tabs render while a drag is on. */
interface DragView { id: string; from: number; to: number; dx: number; step: number; }

export default function TabBar(props: {
  tabs: TabSnapshot[];
  activeTabId: string | null;
  onSettings: () => void;
  onSavedSignatures: () => void;
  onEditText: (tabId: string) => void;
  onLicences: () => void;
}) {
  const { manager } = useServices();
  const active = props.tabs.find((t) => t.id === props.activeTabId);
  const stripRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  /** Set when a press ended a drag, so the click that follows does not activate the tab. */
  const swallowClick = useRef(false);
  const [drag, setDrag] = useState<DragView | null>(null);
  const dragOn = drag !== null;

  const ids = props.tabs.map((t) => t.id).join("\n");

  // The tab list changed under a press (a tab closed or opened): its indexes no longer hold.
  useEffect(() => {
    const p = press.current;
    if (p) p.cancelled = true;
    setDrag(null);
  }, [ids]);

  // Escape during a drag puts the tab back.
  useEffect(() => {
    if (!dragOn) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (press.current) press.current.cancelled = true;
      setDrag(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dragOn]);

  /** The pointer's x in the strip's own coordinates, so a scrolled strip still adds up. */
  const stripX = (clientX: number): number => {
    const strip = stripRef.current;
    if (!strip) return clientX;
    return clientX - strip.getBoundingClientRect().left + strip.scrollLeft;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    // The main button only. Middle-click closes, and the close button never drags.
    if (e.button !== 0 || (e.target as Element).closest(".tab-close")) return;
    const strip = stripRef.current;
    if (!strip) return;
    const from = props.tabs.findIndex((t) => t.id === id);
    const rects = Array.from(strip.querySelectorAll<HTMLElement>(":scope > .tab"))
      .map((el) => el.getBoundingClientRect());
    if (from < 0 || rects.length !== props.tabs.length) return;
    const origin = strip.getBoundingClientRect().left - strip.scrollLeft;
    const edges = rects.map((r) => ({ left: r.left - origin, right: r.right - origin }));
    const next = edges[from + 1];
    const step = next ? next.left - edges[from].left : edges[from].right - edges[from].left;
    press.current = {
      id, pointerId: e.pointerId, from, startX: e.clientX, startY: e.clientY,
      startStripX: stripX(e.clientX), edges, step, dragging: false, cancelled: false, to: from,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId || p.cancelled) return;
    if (!p.dragging) {
      if (!isDrag(p.startX, p.startY, e.clientX, e.clientY)) return;
      p.dragging = true;
    }
    const strip = stripRef.current;
    if (strip && strip.scrollWidth > strip.clientWidth) {
      const box = strip.getBoundingClientRect();
      if (e.clientX < box.left + EDGE_SCROLL_ZONE) strip.scrollLeft -= EDGE_SCROLL_STEP;
      else if (e.clientX > box.right - EDGE_SCROLL_ZONE) strip.scrollLeft += EDGE_SCROLL_STEP;
    }
    const dx = stripX(e.clientX) - p.startStripX;
    const own = p.edges[p.from];
    p.to = dropIndex((own.left + own.right) / 2 + dx, p.edges, p.from);
    setDrag({ id: p.id, from: p.from, to: p.to, dx, step: p.step });
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>, drop: boolean) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    setDrag(null);
    if (!p.dragging && !p.cancelled) return;   // a plain click: let it activate the tab
    swallowClick.current = true;
    // A click follows a pointerup on the same element. If none does, forget the flag.
    window.setTimeout(() => { swallowClick.current = false; }, 0);
    if (drop && p.dragging && !p.cancelled) manager.moveTab(p.id, p.to);
  };

  return (
    <header className="tabbar">
      <div className="tabs" role="tablist" aria-label="Open files" ref={stripRef}>
        {props.tabs.map((tab, i) => {
          let style: CSSProperties | undefined;
          if (drag) {
            const x = tab.id === drag.id ? drag.dx : shiftFor(i, drag.from, drag.to, drag.step);
            style = { transform: `translateX(${x}px)` };
          }
          return (
            <Tab
              key={tab.id}
              tab={tab}
              active={tab.id === props.activeTabId}
              dragging={drag?.id === tab.id}
              moving={dragOn}
              style={style}
              onPointerDown={(e) => onPointerDown(e, tab.id)}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => onPointerEnd(e, true)}
              onPointerCancel={(e) => onPointerEnd(e, false)}
              takeClick={() => {
                if (!swallowClick.current) return true;
                swallowClick.current = false;
                return false;
              }}
            />
          );
        })}
        <button
          type="button"
          className="tab-add"
          title="Open a PDF (Ctrl+O)"
          aria-label="Open a PDF"
          onClick={() => void manager.openWithDialog()}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="save-button"
        disabled={!active?.dirty}
        title="Save (Ctrl+S)"
        onClick={() => { if (active) void manager.save(active.id); }}
      >
        Save
      </button>
      <AppMenu active={active} onSettings={props.onSettings} onSavedSignatures={props.onSavedSignatures}
        onEditText={props.onEditText} onLicences={props.onLicences} />
    </header>
  );
}

type PointerHandler = (e: ReactPointerEvent<HTMLDivElement>) => void;

function Tab({ tab, active, dragging, moving, style, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, takeClick }: {
  tab: TabSnapshot;
  active: boolean;
  dragging: boolean;
  moving: boolean;
  style: CSSProperties | undefined;
  onPointerDown: PointerHandler;
  onPointerMove: PointerHandler;
  onPointerUp: PointerHandler;
  onPointerCancel: PointerHandler;
  /** False when the click ends a drag, which must not activate the tab. */
  takeClick: () => boolean;
}) {
  const { manager, files } = useServices();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const classes = ["tab"];
  if (active) classes.push("active");
  if (moving) classes.push("moving");
  if (dragging) classes.push("dragging");

  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      className={classes.join(" ")}
      style={style}
      title={files.describe(tab.ref)}
      onClick={() => { if (takeClick()) void manager.activate(tab.id); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void manager.activate(tab.id);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // Middle-click closes. Stopping mousedown on the middle button stops the scroll cursor.
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        void manager.closeTab(tab.id);
      }}
    >
      <span className="tab-name">{tab.name}</span>
      {tab.dirty && <span className="tab-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
      {tab.hasDigitalSignature && <span className="tab-signed" title={SIGNED_TOOLTIP}>Signed</span>}
      <button
        type="button"
        className="tab-close"
        title="Close tab (Ctrl+W)"
        aria-label={`Close ${tab.name}`}
        onClick={(e) => {
          e.stopPropagation();
          void manager.closeTab(tab.id);
        }}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M1 1 9 9M9 1 1 9" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}
