// ============================================================================
// STEP 1 - top of App.jsx: replace the first two import lines with these
// ============================================================================
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, BookOpen, Check, ChevronDown, ChevronUp, Cloud, Download,
  ExternalLink, LayoutDashboard, LoaderCircle, Maximize2, Minimize2, RefreshCw, Search, Server, X,
  ShieldCheck, Trophy, Container, Tags, Workflow, Bell, Moon, Sun, Terminal,
} from 'lucide-react';


// ============================================================================
// STEP 2 - in App.jsx, delete the old `LABS_URL` constant and the whole old
// `function TerminalDrawer() { ... }`, and paste everything below in their place.
// (<TerminalDrawer /> is already rendered at the bottom of <main>, so no other
//  change is needed.)
// ============================================================================

// Where TWS Labs is running. Hardcode your public URL here if you prefer.
const LABS_URL = import.meta.env.VITE_TWS_LABS_URL
  || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'http://localhost:8080' : '');

const TERMINAL_KEY = 'finops-terminal';
const TERMINAL_HEADER_H = 36;   // collapsed height: just the tab strip, like VS Code's panel bar
const TERMINAL_MIN_H = 160;

const DRAWER_CSS = `
.vsc-spacer { flex: none; transition: height .22s cubic-bezier(.4,0,.2,1); }
.vsc-terminal {
  position: fixed; right: 0; bottom: 0; z-index: 40; display: flex; flex-direction: column;
  background: #1e1e1e; color: #cccccc; border-top: 1px solid #3c3c3c;
  box-shadow: 0 -6px 18px rgba(0,0,0,.22); overflow: hidden;
  transition: height .22s cubic-bezier(.4,0,.2,1);
}
.vsc-spacer.vsc-resizing, .vsc-terminal.vsc-resizing { transition: none; }
.vsc-handle {
  position: absolute; top: 0; left: 0; right: 0; height: 5px; z-index: 2;
  cursor: ns-resize; touch-action: none; background: transparent; transition: background .15s;
}
.vsc-handle:hover, .vsc-handle.vsc-handle-active { background: #0078d4; }
.vsc-header {
  flex: none; height: ${TERMINAL_HEADER_H}px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 6px 0 4px; background: #252526; user-select: none;
}
.vsc-tab {
  display: inline-flex; align-items: center; gap: 7px; height: 100%; padding: 0 12px; border: 0; background: transparent;
  color: #e7e7e7; font: 600 11px/1 system-ui, sans-serif; letter-spacing: .07em; text-transform: uppercase;
  cursor: pointer; border-bottom: 1px solid #e7e7e7; box-sizing: border-box;
}
.vsc-tab small { color: #9d9d9d; font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 4px; }
.vsc-actions { display: flex; align-items: center; gap: 2px; }
.vsc-actions a, .vsc-actions button {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 28px; height: 26px; padding: 0 6px;
  border: 0; border-radius: 4px; background: transparent; color: #cccccc; font: 12px system-ui, sans-serif;
  text-decoration: none; cursor: pointer;
}
.vsc-actions a:hover, .vsc-actions button:hover { background: rgba(255,255,255,.12); color: #fff; }
.vsc-kbd { color: #9d9d9d; font-size: 11px; margin-right: 6px; }
.vsc-body { flex: 1; min-height: 0; position: relative; background: #1e1e1e; }
.vsc-body[hidden] { display: none; }
.vsc-frame { display: block; width: 100%; height: 100%; border: 0; background: #1e1e1e; }
.vsc-frame.vsc-frame-dragging { pointer-events: none; }
.vsc-setup { padding: 18px 22px; font: 13px/1.6 system-ui, sans-serif; color: #cccccc; }
.vsc-setup p { margin: 0 0 8px; }
.vsc-setup code { background: #333; padding: 1px 6px; border-radius: 4px; }
.vsc-setup a { color: #3794ff; }
/* The page-wide dark theme inverts everything; undo that for this panel so it stays VS Code dark. */
html[data-theme="dark"] .vsc-terminal { filter: invert(1) hue-rotate(180deg); }
html[data-theme="dark"] .vsc-terminal iframe { filter: none; }
@media (prefers-reduced-motion: reduce) { .vsc-spacer, .vsc-terminal { transition: none; } }
`;

function readTerminalPrefs() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(TERMINAL_KEY) || '{}');
    return { open: Boolean(saved.open), height: Number(saved.height) || 0 };
  } catch {
    return { open: false, height: 0 };
  }
}

function TerminalDrawer() {
  const [prefs] = useState(readTerminalPrefs);
  const [open, setOpen] = useState(prefs.open);
  const [mounted, setMounted] = useState(prefs.open);   // iframe loads on first open, then stays alive while collapsed
  const [maximized, setMaximized] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  const [height, setHeight] = useState(() => prefs.height || Math.round(window.innerHeight * 0.4));
  const [left, setLeft] = useState(0);
  const collapseOnRelease = useRef(false);

  const maxH = Math.max(viewportH - 80, TERMINAL_MIN_H);
  const panelH = Math.min(Math.max(height, TERMINAL_MIN_H), maxH);
  const total = !open ? TERMINAL_HEADER_H : maximized ? Math.max(viewportH - 48, TERMINAL_MIN_H) : panelH;

  useEffect(() => { if (open) setMounted(true); }, [open]);

  useEffect(() => {
    try { window.localStorage.setItem(TERMINAL_KEY, JSON.stringify({ open, height: panelH })); } catch { /* per-visit only */ }
  }, [open, panelH]);

  // Sit beside the sidebar (like VS Code's panel under the editor) instead of covering it.
  useEffect(() => {
    const el = document.querySelector('.main-content');
    const update = () => {
      setViewportH(window.innerHeight);
      setLeft(el ? Math.max(0, Math.round(el.getBoundingClientRect().left)) : 0);
    };
    update();
    window.addEventListener('resize', update);
    const observer = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (observer) observer.observe(el);
    return () => { window.removeEventListener('resize', update); if (observer) observer.disconnect(); };
  }, []);

  // Ctrl + ` toggles the panel, same shortcut as VS Code.
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === '`' || event.code === 'Backquote')) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = () => { setOpen((value) => !value); setMaximized(false); };

  const startResize = (event) => {
    if (!open || maximized) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    collapseOnRelease.current = false;
    setResizing(true);
  };
  const moveResize = (event) => {
    if (!resizing) return;
    const next = window.innerHeight - event.clientY;
    collapseOnRelease.current = next < TERMINAL_MIN_H * 0.6;   // dragged almost to the bottom: snap closed
    setHeight(Math.min(Math.max(next, TERMINAL_MIN_H), maxH));
  };
  const stopResize = (event) => {
    if (!resizing) return;
    setResizing(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (collapseOnRelease.current) setOpen(false);
  };

  const dragClass = resizing ? 'vsc-resizing' : '';

  return <>
    <style>{DRAWER_CSS}</style>
    <div className={`vsc-spacer ${dragClass}`} style={{ height: total }} aria-hidden="true" />
    <aside className={`vsc-terminal ${dragClass}`} style={{ height: total, left }} aria-label="Terminal panel">
      {open && !maximized && <div
        className={`vsc-handle ${resizing ? 'vsc-handle-active' : ''}`}
        role="separator" aria-orientation="horizontal" aria-label="Resize terminal panel"
        onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}
        onDoubleClick={() => setHeight(Math.round(window.innerHeight * 0.4))}
      />}
      <div className="vsc-header" onDoubleClick={toggle}>
        <button type="button" className="vsc-tab" onClick={toggle} aria-expanded={open}>
          <Terminal size={14} /> Terminal <small>TWS Labs</small>
        </button>
        <div className="vsc-actions" onDoubleClick={(event) => event.stopPropagation()}>
          <span className="vsc-kbd" aria-hidden="true">Ctrl + `</span>
          {LABS_URL && <a href={LABS_URL} target="_blank" rel="noopener noreferrer" title="Open in a new tab" aria-label="Open terminal in a new tab"><ExternalLink size={14} /></a>}
          {open && <button type="button" onClick={() => setMaximized((value) => !value)} title={maximized ? 'Restore panel size' : 'Maximize panel'} aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}>
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>}
          <button type="button" onClick={toggle} title={open ? 'Hide panel' : 'Show panel'} aria-label={open ? 'Hide terminal panel' : 'Show terminal panel'}>
            {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {open && <button type="button" onClick={toggle} title="Close panel" aria-label="Close terminal panel"><X size={14} /></button>}
        </div>
      </div>
      <div className="vsc-body" hidden={!open}>
        {mounted && (LABS_URL
          ? <iframe
              className={`vsc-frame ${resizing ? 'vsc-frame-dragging' : ''}`}
              title="TWS Labs terminal"
              src={LABS_URL}
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          : <div className="vsc-setup">
              <p>The lab terminal is not connected yet.</p>
              <p>Run TWS Labs (<code>./start_local_labs.sh</code>) and set <code>VITE_TWS_LABS_URL</code> to its address, or hardcode <code>LABS_URL</code> above.</p>
              <a href="https://github.com/TrainWithShubham/tws-labs" target="_blank" rel="noopener noreferrer">TWS Labs on GitHub</a>
            </div>)}
      </div>
    </aside>
  </>;
}
