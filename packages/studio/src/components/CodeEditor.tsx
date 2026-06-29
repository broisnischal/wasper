import React, { useEffect, useRef, useState } from 'react';
import type { OnMount, OnChange } from '@monaco-editor/react';
import { useApp } from '../context';

// Loaded lazily so Monaco (and its workers) never touch the SSR bundle.
const LazyEditor = React.lazy(() => import('@monaco-editor/react'));

export interface CodeEditorHandle {
  format: () => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Hide the line-number gutter (handy for short inline bodies). */
  lineNumbers?: boolean;
  /** JSON Schema to drive completions + validation (only meaningful for json). */
  schema?: object;
  /**
   * Stable model path. Distinct paths give each editor its own model so schemas
   * don't leak between tabs. Defaults to a per-instance id.
   */
  path?: string;
}

const FONT = "'JetBrains Mono', GeistMono, ui-monospace, 'SFMono-Regular', monospace";

let MODEL_SEQ = 0;

/**
 * Full Monaco editor wired to the studio theme. Renders a plain pre-styled
 * fallback during SSR / initial load so layout never shifts.
 */
export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, language = 'json', placeholder, readOnly = false, lineNumbers = true, schema, path },
  ref,
) {
  const { theme } = useApp();
  const [ready, setReady] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(!value);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // A stable, unique model URI for this editor instance.
  const modelPath = useRef(path ?? `body-${++MODEL_SEQ}.json`);

  // Kick off the client-only Monaco setup (workers + themes) before rendering.
  useEffect(() => {
    let alive = true;
    import('../lib/monaco').then(m => m.MONACO_READY).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { setShowPlaceholder(!value); }, [value]);

  // Bind / unbind the JSON schema to this editor's model.
  useEffect(() => {
    if (!ready || language !== 'json') return;
    let uri: string | null = null;
    let cancelled = false;
    import('../lib/monaco').then(m => {
      if (cancelled) return;
      uri = editorRef.current?.getModel()?.uri.toString() ?? null;
      if (!uri) return;
      if (schema && Object.keys(schema).length) m.registerJsonSchema(uri, schema);
      else m.unregisterJsonSchema(uri);
    });
    return () => {
      cancelled = true;
      if (uri) import('../lib/monaco').then(m => m.unregisterJsonSchema(uri!));
    };
  }, [ready, schema, language]);

  React.useImperativeHandle(ref, () => ({
    format: () => {
      editorRef.current?.getAction('editor.action.formatDocument')?.run();
    },
  }), []);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleChange: OnChange = (v) => {
    const next = v ?? '';
    setShowPlaceholder(!next);
    onChange(next);
  };

  const monacoTheme = theme === 'light' ? 'wasper-light' : 'wasper-dark';

  return (
    <div className="relative h-full w-full" style={{ background: 'var(--background)' }}>
      {ready ? (
        <React.Suspense fallback={null}>
          <LazyEditor
            value={value}
            language={language}
            path={modelPath.current}
            theme={monacoTheme}
            onMount={handleMount}
            onChange={handleChange}
            options={{
              readOnly,
              fontFamily: FONT,
              fontSize: 12.5,
              lineHeight: 20,
              fontLigatures: true,
              lineNumbers: lineNumbers ? 'on' : 'off',
              lineNumbersMinChars: 3,
              lineDecorationsWidth: 8,
              glyphMargin: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
              padding: { top: 10, bottom: 10 },
              folding: true,
              tabSize: 2,
              automaticLayout: true,
              formatOnPaste: true,
              // Neutral braces that follow the theme delimiter color (no rainbow).
              bracketPairColorization: { enabled: false },
              guides: { bracketPairs: false, highlightActiveBracketPair: false, indentation: true },
              matchBrackets: 'near',
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              renderWhitespace: 'none',
              stickyScroll: { enabled: false },
              wordWrap: language === 'json' ? 'off' : 'on',
              fixedOverflowWidgets: true,
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
              tabCompletion: 'on',
            }}
          />
        </React.Suspense>
      ) : (
        // Pre-hydration fallback — same font/metrics to avoid a visible jump.
        <pre
          className="absolute inset-0 m-0 overflow-auto text-[var(--foreground)]"
          style={{ padding: '10px 16px', fontFamily: FONT, fontSize: 12.5, lineHeight: '20px', whiteSpace: 'pre' }}
        >
          {value}
        </pre>
      )}
      {showPlaceholder && placeholder && (
        <div
          className="pointer-events-none absolute top-0 text-[var(--placeholder-foreground)]"
          style={{
            left: lineNumbers ? 60 : 16,
            padding: '10px 0',
            fontFamily: FONT,
            fontSize: 12.5,
            lineHeight: '20px',
            whiteSpace: 'pre',
            opacity: 0.5,
          }}
        >
          {placeholder}
        </div>
      )}
    </div>
  );
});
