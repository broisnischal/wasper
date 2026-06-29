import type { Highlighter } from 'shiki';

let promise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!promise) {
    promise = import('shiki').then(({ createHighlighter, createJavaScriptRegexEngine }) =>
      createHighlighter({
        themes: ['github-dark-dimmed', 'github-light'],
        langs: ['json', 'bash', 'typescript', 'javascript', 'yaml', 'xml', 'html', 'text', 'python', 'go', 'rust', 'sql'],
        engine: createJavaScriptRegexEngine(),
      }),
    );
  }
  return promise;
}

// Warm the highlighter when the browser is idle — never block first paint /
// hydration. (Shiki + its grammars are ~MBs; eager-loading them at startup was
// a major source of perceived lag.)
if (typeof window !== 'undefined') {
  const warm = () => getHighlighter();
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback(warm, { timeout: 2500 });
  } else {
    setTimeout(warm, 1200);
  }
}
