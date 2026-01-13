'use client';

import React, { forwardRef, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { cn } from '@/lib/utils';

interface MonacoEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  theme?: string;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  height?: string;
  className?: string;
}

const MonacoEditor = forwardRef<monaco.editor.IStandaloneCodeEditor, MonacoEditorProps>(
  ({ value, onChange, language = 'yaml', theme = 'vs-dark', options, height = '500px', className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
      let editor: monaco.editor.IStandaloneCodeEditor | null = null;

      const initEditor = async () => {
        if (containerRef.current && !editorRef.current) {
          editor = monaco.editor.create(containerRef.current, {
            value,
            language,
            theme,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineNumbers: 'on',
            rulers: [80],
            wordWrap: 'on',
            padding: { top: 16, bottom: 16 },
            ...options,
          });

          editorRef.current = editor;
          setIsLoaded(true);

          if (ref) {
            if (typeof ref === 'function') {
              ref(editor);
            } else {
              ref.current = editor;
            }
          }

          editor.onDidChangeModelContent(() => {
            const newValue = editor?.getValue() || '';
            if (onChange && newValue !== value) {
              onChange(newValue);
            }
          });
        }
      };

      initEditor();

      return () => {
        if (editorRef.current) {
          editorRef.current.dispose();
          editorRef.current = null;
        }
      };
      }, []);

    useEffect(() => {
      if (editorRef.current && value !== editorRef.current.getValue()) {
        editorRef.current.setValue(value);
      }
    }, [value]);

    useEffect(() => {
      if (editorRef.current) {
        editorRef.current.updateOptions({ theme });
      }
    }, [theme]);

    return (
      <div
        ref={containerRef}
        className={cn('border border-border rounded-md overflow-hidden', className)}
        style={{ height }}
      />
    );
  }
);

MonacoEditor.displayName = 'MonacoEditor';

export default MonacoEditor;
