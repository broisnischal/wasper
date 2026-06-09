import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Search, Command } from 'lucide-react';

interface Op {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  tags: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  operations: Op[];
  onSelect: (op: Op) => void;
}

export function CommandPalette({ open, onClose, operations, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const filtered = query.trim()
    ? operations.filter(op => {
        const q = query.toLowerCase();
        return (
          op.path.toLowerCase().includes(q) ||
          (op.summary ?? '').toLowerCase().includes(q) ||
          op.method.toLowerCase().includes(q) ||
          op.tags.some(t => t.toLowerCase().includes(q))
        );
      }).slice(0, 12)
    : operations.slice(0, 12);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => { setSel(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && filtered[sel]) {
        pick(filtered[sel]);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, filtered, sel]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const pick = (op: Op) => {
    onSelect(op);
    onClose();
    router.navigate({ to: '/explorer' });
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-dialog" onMouseDown={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="cmd-input-wrap">
          <Search size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search endpoints…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}
              onClick={() => setQuery('')}
            >
              ×
            </button>
          )}
        </div>

        {/* Results */}
        <div className="cmd-results" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmd-empty">
              No endpoints match "{query}"
            </div>
          ) : filtered.map((op, i) => (
            <div
              key={op.operationId}
              className={`cmd-item${i === sel ? ' selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(op)}
            >
              <span className={`method-badge method-${op.method.toUpperCase()}`}>{op.method.toUpperCase()}</span>
              <span style={{ flex: 1, fontFamily: 'GeistMono, monospace', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>
                {op.path}
              </span>
              {op.tags[0] && (
                <span style={{ fontSize: 10, color: 'var(--placeholder-foreground)', background: 'var(--elevated)', borderRadius: 4, padding: '1px 7px', flexShrink: 0 }}>
                  {op.tags[0]}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="cmd-footer">
          <span><kbd className="cmd-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="cmd-kbd">↵</kbd> open in Explorer</span>
          <span><kbd className="cmd-kbd">Esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>
            <Command size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />
            <span style={{ marginLeft: 3 }}>K</span>
          </span>
        </div>
      </div>
    </div>
  );
}
