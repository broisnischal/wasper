import React, { useMemo, useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';

// ── Collapsible JSON tree (Insomnia-style fold/unfold with indent guides) ────

const COLORS = {
  key:     'var(--json-key,    #7dd3fc)',
  string:  'var(--json-string, #86efac)',
  number:  'var(--json-number, #fde68a)',
  boolean: 'var(--json-bool,   #c4b5fd)',
  null:    'var(--placeholder-foreground)',
  punct:   'var(--muted-foreground)',
};

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span style={{ color: COLORS.null }}>null</span>;
  switch (typeof value) {
    case 'string': return <span style={{ color: COLORS.string }}>"{value.length > 2000 ? value.slice(0, 2000) + '…' : value}"</span>;
    case 'number': return <span style={{ color: COLORS.number }}>{String(value)}</span>;
    case 'boolean': return <span style={{ color: COLORS.boolean }}>{String(value)}</span>;
    default: return <span style={{ color: COLORS.null }}>{String(value)}</span>;
  }
}

// Vertical indent guides — one faint line per nesting level (Insomnia/Postman style)
function Guides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span className="jt-guides" aria-hidden="true">
      {Array.from({ length: depth }, (_, i) => <span key={i} className="jt-guide" />)}
    </span>
  );
}

interface NodeProps {
  k: string | null;          // key in parent (null = root / array item)
  value: unknown;
  depth: number;
  path: string;
  expanded: Set<string>;
  toggle: (path: string) => void;
  isLast: boolean;
}

const PAGE = 100; // children rendered per "show more" page for huge arrays/objects

function Node({ k, value, depth, path, expanded, toggle, isLast }: NodeProps) {
  const [page, setPage] = useState(1);
  const isObj = value !== null && typeof value === 'object';
  const comma = isLast ? '' : ',';

  const keyLabel = k !== null && (
    <>
      <span style={{ color: COLORS.key }}>"{k}"</span>
      <span style={{ color: COLORS.punct }}>: </span>
    </>
  );

  if (!isObj) {
    return (
      <div className="jt-row">
        <Guides depth={depth} />
        <span className="jt-caret-space" />
        {keyLabel}
        <Primitive value={value} />
        <span style={{ color: COLORS.punct }}>{comma}</span>
      </div>
    );
  }

  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const open = expanded.has(path);
  const [openCh, closeCh] = isArr ? ['[', ']'] : ['{', '}'];
  const count = entries.length;

  if (!open) {
    return (
      <div className="jt-row jt-clickable" onClick={() => toggle(path)}>
        <Guides depth={depth} />
        <span className="jt-caret"><ChevronRight size={11} /></span>
        {keyLabel}
        <span style={{ color: COLORS.punct }}>{openCh}</span>
        <span className="jt-count">{count} {isArr ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'key' : 'keys')}</span>
        <span style={{ color: COLORS.punct }}>{closeCh}{comma}</span>
      </div>
    );
  }

  const visible = entries.slice(0, page * PAGE);

  return (
    <>
      <div className="jt-row jt-clickable" onClick={() => toggle(path)}>
        <Guides depth={depth} />
        <span className="jt-caret jt-caret-open"><ChevronRight size={11} /></span>
        {keyLabel}
        <span style={{ color: COLORS.punct }}>{openCh}</span>
      </div>
      {visible.map(([ck, cv], i) => (
        <Node
          key={ck}
          k={isArr ? null : ck}
          value={cv}
          depth={depth + 1}
          path={`${path}.${ck}`}
          expanded={expanded}
          toggle={toggle}
          isLast={i === entries.length - 1}
        />
      ))}
      {visible.length < entries.length && (
        <div className="jt-row">
          <Guides depth={depth + 1} />
          <span className="jt-caret-space" />
          <button className="jt-more" onClick={() => setPage(p => p + 1)}>
            … {entries.length - visible.length} more
          </button>
        </div>
      )}
      <div className="jt-row">
        <Guides depth={depth} />
        <span className="jt-caret-space" />
        <span style={{ color: COLORS.punct }}>{closeCh}{comma}</span>
      </div>
    </>
  );
}

function collectPaths(value: unknown, path: string, depth: number, maxDepth: number, out: Set<string>) {
  if (value === null || typeof value !== 'object' || depth > maxDepth) return;
  out.add(path);
  const entries = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries) collectPaths(v, `${path}.${k}`, depth + 1, maxDepth, out);
}

export interface JsonTreeControls { expandAll: () => void; collapseAll: () => void; }

export function JsonTree({ data, controlsRef }: { data: unknown; controlsRef?: React.MutableRefObject<JsonTreeControls | null> }) {
  // Default: expand the first two levels
  const initial = useMemo(() => {
    const s = new Set<string>();
    collectPaths(data, '$', 0, 1, s);
    return s;
  }, [data]);
  const [expanded, setExpanded] = useState<Set<string>>(initial);
  const [, setVersion] = useState(0);

  const toggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    const s = new Set<string>();
    collectPaths(data, '$', 0, 50, s);
    setExpanded(s);
    setVersion(v => v + 1);
  };
  const collapseAll = () => setExpanded(new Set());

  useEffect(() => {
    if (controlsRef) controlsRef.current = { expandAll, collapseAll };
  });

  return (
    <div className="jt-scroll flex-1 overflow-auto py-2 font-mono text-[12.5px] leading-[1.65]">
      <Node k={null} value={data} depth={0} path="$" expanded={expanded} toggle={toggle} isLast />
    </div>
  );
}
