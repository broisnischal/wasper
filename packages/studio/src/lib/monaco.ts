// Client-only Monaco setup. This module is dynamically imported from the
// CodeEditor component inside a useEffect so it never runs during SSR (it
// references `self` and pulls in web-worker entry points via Vite's ?worker).
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Route language services to bundled workers instead of a CDN.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Themes mirror the studio's JSON token palette (see styles.css .json-* rules)
// on the pure-black / pure-white surfaces, so Monaco feels native here.
monaco.editor.defineTheme('wasper-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'fafafa' },
    { token: 'string.key.json', foreground: '7dd3fc' },
    { token: 'string.value.json', foreground: '86efac' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: 'fde68a' },
    { token: 'keyword', foreground: 'c4b5fd' },
    { token: 'keyword.json', foreground: 'c4b5fd' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'delimiter', foreground: 'a1a1aa' },
  ],
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#fafafa',
    'editorLineNumber.foreground': '#3f3f46',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editor.selectionBackground': '#1d4ed840',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorCursor.foreground': '#fafafa',
    'editorIndentGuide.background1': '#ffffff10',
    'editorIndentGuide.activeBackground1': '#ffffff24',
    'editorWidget.background': '#0a0a0a',
    'editorWidget.border': '#ffffff24',
    'editorSuggestWidget.background': '#0a0a0a',
    'editorSuggestWidget.border': '#ffffff24',
    'editorBracketMatch.background': '#3b82f626',
    'editorBracketMatch.border': '#3b82f6',
  },
});

monaco.editor.defineTheme('wasper-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '09090b' },
    { token: 'string.key.json', foreground: '0369a1' },
    { token: 'string.value.json', foreground: '15653a' },
    { token: 'string', foreground: '15653a' },
    { token: 'number', foreground: '92400e' },
    { token: 'keyword', foreground: '5b21b6' },
    { token: 'keyword.json', foreground: '5b21b6' },
    { token: 'comment', foreground: '9ca3af', fontStyle: 'italic' },
    { token: 'delimiter', foreground: '71717a' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#09090b',
    'editorLineNumber.foreground': '#d4d4d8',
    'editorLineNumber.activeForeground': '#71717a',
    'editor.selectionBackground': '#3b82f626',
    'editor.lineHighlightBackground': '#00000005',
    'editorCursor.foreground': '#09090b',
    'editorIndentGuide.background1': '#00000010',
    'editorIndentGuide.activeBackground1': '#00000024',
    'editorBracketMatch.background': '#3b82f614',
    'editorBracketMatch.border': '#3b82f6',
  },
});

loader.config({ monaco });

// ── JSON schema registry ────────────────────────────────────────────────────
// Monaco's JSON worker validates/completes a model against any schema whose
// `fileMatch` includes the model's URI. We keep one entry per editor model so
// multiple open editors (different endpoints) don't clobber each other's schema.
interface SchemaEntry { uri: string; fileMatch?: string[]; schema?: object }
const schemaRegistry = new Map<string, SchemaEntry>();

interface JsonDiagnosticsOptions {
  validate?: boolean;
  allowComments?: boolean;
  enableSchemaRequest?: boolean;
  schemaValidation?: 'error' | 'warning' | 'ignore';
  schemas?: SchemaEntry[];
}
// monaco-editor 0.55 marks the monolithic `languages.json` namespace deprecated
// in its types, but the runtime API is still present once the json language
// contribution loads (it does, via the editor.main bundle).
const jsonDefaults = (monaco.languages as unknown as {
  json: { jsonDefaults: { setDiagnosticsOptions(o: JsonDiagnosticsOptions): void } };
}).json.jsonDefaults;

function applySchemas() {
  jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    enableSchemaRequest: false,
    schemaValidation: 'warning',
    schemas: Array.from(schemaRegistry.values()),
  });
}

/** Bind a JSON schema to a specific editor model URI (enables completions + validation). */
export function registerJsonSchema(modelUri: string, schema: object) {
  schemaRegistry.set(modelUri, {
    uri: `inmemory://schema/${encodeURIComponent(modelUri)}.json`,
    fileMatch: [modelUri],
    schema,
  });
  applySchemas();
}

/** Drop the schema bound to a model URI (call on unmount / when schema clears). */
export function unregisterJsonSchema(modelUri: string) {
  if (schemaRegistry.delete(modelUri)) applySchemas();
}

export { monaco };
export const MONACO_READY = loader.init();
