import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  activeLine: number;
}

export function CodeEditor({ value, onChange, activeLine }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || activeLine <= 0) return;
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, [
      {
        range: { startLineNumber: activeLine, endLineNumber: activeLine, startColumn: 1, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'active-line-highlight',
          glyphMarginClassName: 'active-line-glyph',
        },
      },
    ]);
  }, [activeLine]);

  return (
    <div className="editor-container">
      <div className="panel-header">Java Code</div>
      <Editor
        height="calc(100% - 36px)"
        defaultLanguage="java"
        theme="vs-dark"
        value={value}
        onChange={v => onChange(v ?? '')}
        onMount={ed => { editorRef.current = ed; }}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          glyphMargin: true,
          folding: false,
          renderLineHighlight: 'none',
          wordWrap: 'on',
        }}
      />
    </div>
  );
}
