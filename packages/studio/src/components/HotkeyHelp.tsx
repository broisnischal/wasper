import { useEffect, useRef } from 'react';
import { formatForDisplay } from '@tanstack/hotkeys';
import { HOTKEY_DEFS, type HotkeySection } from '../lib/hotkeys';
import { X, Keyboard } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: HotkeySection[] = ['Global', 'Navigation', 'Explorer'];

function KbdDisplay({ hotkey }: { hotkey: string }) {
  const display = formatForDisplay(hotkey as Parameters<typeof formatForDisplay>[0]);
  // Split on + that's not inside a key name (handles Mod+Shift+K → ['Mod','Shift','K'])
  const parts = display.split(/(?<=[^+])\+(?=[^+])/);
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      {parts.map((p, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-[4px] font-mono text-[10.5px] font-semibold text-[var(--foreground)] bg-[var(--elevated)] border border-[var(--border)] shadow-[0_1px_0_var(--border)] select-none"
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}

export function HotkeyHelp({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape (native, without useHotkey to avoid circular deps)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (open) setTimeout(() => dialogRef.current?.focus(), 30);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="cmd-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={e => e.stopPropagation()}
        className="w-full mx-4 bg-[var(--popover)] border border-[var(--border-strong)] rounded-xl overflow-hidden focus:outline-none"
        style={{ maxWidth: 700, boxShadow: 'var(--shadow)', animation: 'dialog-in 0.12s ease' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <Keyboard size={15} className="text-[var(--muted-foreground)]" />
          <h2 className="text-[14px] font-semibold tracking-tight text-[var(--foreground)] flex-1">
            Keyboard Shortcuts
          </h2>
          <span className="text-[11.5px] text-[var(--placeholder-foreground)] mr-3">
            Press <KbdDisplay hotkey="?" /> anywhere to toggle
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--elevated)] transition-colors bg-transparent border-0 cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>

        {/* Body — 3-column grid */}
        <div className="grid grid-cols-3 gap-0 divide-x divide-[var(--border)] max-h-[60vh] overflow-y-auto">
          {SECTIONS.map(section => {
            const defs = HOTKEY_DEFS.filter(d => d.section === section);
            return (
              <div key={section} className="px-4 py-4">
                <div className="text-[10.5px] font-semibold uppercase tracking-widest text-[var(--placeholder-foreground)] mb-3 px-1">
                  {section}
                </div>
                <div className="flex flex-col gap-0.5">
                  {defs.map(def => (
                    <div
                      key={def.id}
                      className="flex items-center justify-between gap-3 px-1 py-1.5 rounded-md hover:bg-[var(--elevated)] transition-colors group"
                    >
                      <span className="text-[12.5px] text-[var(--muted-foreground)] group-hover:text-[var(--foreground)] transition-colors truncate">
                        {def.description}
                      </span>
                      <KbdDisplay hotkey={def.hotkey} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-[var(--border)] bg-[var(--card)]">
          <span className="text-[11.5px] text-[var(--placeholder-foreground)]">
            <span className="text-[var(--foreground)] font-medium">Mod</span> = ⌘ on macOS, Ctrl on Windows/Linux
          </span>
          <div className="ml-auto flex items-center gap-2 text-[11.5px] text-[var(--placeholder-foreground)]">
            <KbdDisplay hotkey="Escape" />
            <span>to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
