import { useRef, useCallback } from "react";
import "./monacoSetup";
import Editor, { OnMount, OnChange, BeforeMount } from "@monaco-editor/react";
import { getLanguageFromPath } from "./languages";
import { trackEditor } from "./activeEditor";
import type { editor } from "monaco-editor";

interface MonacoCodeEditorProps {
  filePath: string;
  content: string;
  isDirty?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onCursorChange?: (line: number, column: number) => void;
  onTriggerInlineAI?: (selectedText: string, range: any | null) => void;
  fontSize?: number;
  wordWrap?: "on" | "off";
  minimap?: boolean;
  readOnly?: boolean;
  theme?: "dark" | "light";
}

export { getLanguageFromPath };

export function MonacoCodeEditor({
  filePath,
  content,
  onChange,
  onSave,
  onSaveAs,
  onCursorChange,
  onTriggerInlineAI,
  fontSize = 13.5,
  wordWrap = "off",
  minimap = true,
  readOnly = false,
  theme = "dark",
}: MonacoCodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const language = getLanguageFromPath(filePath);

  // Keep refs updated to prevent stale closures inside Monaco addCommand listeners
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onSaveAsRef = useRef(onSaveAs);
  onSaveAsRef.current = onSaveAs;

  const onTriggerInlineAIRef = useRef(onTriggerInlineAI);
  onTriggerInlineAIRef.current = onTriggerInlineAI;

  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("forge-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "71717A", fontStyle: "italic" },
        { token: "keyword", foreground: "F87171", fontStyle: "bold" },
        { token: "identifier", foreground: "F4F4F5" },
        { token: "string", foreground: "34D399" },
        { token: "number", foreground: "FBBF24" },
        { token: "type", foreground: "FB7185" },
        { token: "class", foreground: "FB7185", fontStyle: "bold" },
        { token: "function", foreground: "FF4D4D" },
        { token: "variable", foreground: "E4E4E7" },
        { token: "delimiter", foreground: "A1A1AA" },
      ],
      colors: {
        "editor.background": "#070203",
        "editor.foreground": "#f4f4f5",
        "editor.lineHighlightBackground": "#28070d35",
        "editor.selectionBackground": "#ef444435",
        "editor.inactiveSelectionBackground": "#ef444418",
        "editorCursor.foreground": "#ef4444",
        "editorWhitespace.foreground": "#33181c50",
        "editorLineNumber.foreground": "#52525b",
        "editorLineNumber.activeForeground": "#ef4444",
        "editorIndentGuide.background1": "#27121660",
        "editorIndentGuide.activeBackground1": "#ef444450",
        "editorGutter.background": "#070203",
        "minimap.background": "#070203dd",
      },
    });

    monaco.editor.defineTheme("forge-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "64748B", fontStyle: "italic" },
        { token: "keyword", foreground: "DC2626", fontStyle: "bold" },
        { token: "identifier", foreground: "0F172A" },
        { token: "string", foreground: "059669" },
        { token: "number", foreground: "D97706" },
        { token: "type", foreground: "E11D48" },
        { token: "class", foreground: "E11D48", fontStyle: "bold" },
        { token: "function", foreground: "DC2626" },
        { token: "variable", foreground: "1E293B" },
        { token: "delimiter", foreground: "64748B" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#0f172a",
        "editor.lineHighlightBackground": "#fef2f260",
        "editor.selectionBackground": "#fca5a560",
        "editor.inactiveSelectionBackground": "#fee2e240",
        "editorCursor.foreground": "#dc2626",
        "editorWhitespace.foreground": "#e2e8f0",
        "editorLineNumber.foreground": "#94a3b8",
        "editorLineNumber.activeForeground": "#dc2626",
        "editorIndentGuide.background1": "#f1f5f9",
        "editorIndentGuide.activeBackground1": "#fca5a5",
        "editorGutter.background": "#ffffff",
        "minimap.background": "#ffffffdd",
      },
    });

    // ── Register Salivo Language (.sal, .salivo) ──
    const registeredLangs = monaco.languages.getLanguages();
    if (!registeredLangs.some((l: any) => l.id === "salivo")) {
      monaco.languages.register({
        id: "salivo",
        extensions: [".sal", ".salivo"],
        aliases: ["Salivo", "salivo", "sal"],
      });

      monaco.languages.setLanguageConfiguration("salivo", {
        comments: {
          lineComment: "//",
          blockComment: ["/*", "*/"],
        },
        brackets: [
          ["{", "}"],
          ["[", "]"],
          ["(", ")"],
        ],
        autoClosingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: "(", close: ")" },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
        surroundingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: "(", close: ")" },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
      });

      monaco.languages.setMonarchTokensProvider("salivo", {
        defaultToken: "",
        tokenPostfix: ".sal",

        keywords: [
          "module", "func", "return", "let", "if", "else", "while", "for",
          "struct", "enum", "impl", "use", "pub", "type", "const", "match",
          "break", "continue", "mut", "true", "false", "null", "import", "in", "as",
          "extern", "static", "loop"
        ],

        typeKeywords: [
          "bool", "byte", "char", "short", "int", "long", "float", "double",
          "string", "ref", "void", "usize", "isize", "i8", "i16", "i32", "i64",
          "u8", "u16", "u32", "u64", "f32", "f64"
        ],

        builtins: [
          "outln", "println", "print", "salivo_panic", "malloc", "salivo_free",
          "salivo_arc_retain", "salivo_arc_release", "assert", "panic", "sizeof"
        ],

        operators: [
          "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=",
          "&&", "||", "++", "--", "+", "-", "*", "/", "&", "|", "^",
          "%", "<<", ">>", "+=", "-=", "*=", "/=", "&=", "|=", "^=",
          "%=", "<<=", ">>=", "->"
        ],

        symbols: /[=><!~?:&|+\-*\/\^%]+/,
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        tokenizer: {
          root: [
            // Identifiers and keywords
            [/[a-zA-Z_$][\w$]*/, {
              cases: {
                "@keywords": "keyword",
                "@typeKeywords": "type",
                "@builtins": "function",
                "@default": "identifier"
              }
            }],

            // Whitespace
            { include: "@whitespace" },

            // Delimiters and brackets
            [/[{}()\[\]]/, "@brackets"],
            [/[<>](?!@symbols)/, "@brackets"],
            [/@symbols/, {
              cases: {
                "@operators": "operator",
                "@default": ""
              }
            }],

            // Numbers
            [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
            [/0[xX][0-9a-fA-F]+/, "number.hex"],
            [/\d+/, "number"],

            // Delimiters
            [/[;,.]/, "delimiter"],

            // Strings
            [/"([^"\\]|\\.)*$/, "string.invalid"],
            [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

            // Characters
            [/'[^\\']'/, "string"],
            [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
            [/'/, "string.invalid"]
          ],

          string: [
            [/[^\\"]+/, "string"],
            [/@escapes/, "string.escape"],
            [/\\./, "string.escape.invalid"],
            [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }]
          ],

          whitespace: [
            [/[ \t\r\n]+/, "white"],
            [/\/\*/, "comment", "@comment"],
            [/\/\/.*$/, "comment"],
          ],

          comment: [
            [/[^\/*]+/, "comment"],
            [/\/\*/, "comment", "@push"],
            ["\\*/", "comment", "@pop"],
            [/[\/*]/, "comment"]
          ],
        }
      });

      monaco.languages.registerCompletionItemProvider("salivo", {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions = [
            {
              label: "func",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: "func ${1:name}(${2:args}) -> ${3:int} {\n\t${0}\n}",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Salivo Function Declaration",
              range,
            },
            {
              label: "let",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: "let ${1:name}: ${2:int} = ${3:value};",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Salivo Variable Declaration",
              range,
            },
            {
              label: "module",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: "module ${1:main};",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Salivo Module Declaration",
              range,
            },
            {
              label: "outln",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'outln("${1:message}");',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Salivo Print with newline intrinsic",
              range,
            },
            {
              label: "if",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: "if (${1:condition}) {\n\t${0}\n}",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Salivo Conditional Statement",
              range,
            },
            {
              label: "while",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: "while (${1:condition}) {\n\t${0}\n}",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Salivo While Loop",
              range,
            },
          ];
          return { suggestions };
        }
      });
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    trackEditor(editor);

    // Register Save command Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });

    // Register Save As command Ctrl+Shift+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
      onSaveAsRef.current?.();
    });

    // Register Inline AI Copilot command Ctrl+K
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && model) {
        const selectedText = model.getValueInRange(selection);
        onTriggerInlineAIRef.current?.(selectedText, selection);
      }
    });

    // Cursor position listener
    editor.onDidChangeCursorPosition((e) => {
      onCursorChangeRef.current?.(e.position.lineNumber, e.position.column);
    });
  };

  const handleChange: OnChange = useCallback((value) => {
    onChangeRef.current?.(value ?? "");
  }, []);

  // External content changes (tab switch, AI apply) are synced by @monaco-editor/react itself:
  // `path` swaps to that file's model, and a changed `value` is applied with executeEdits,
  // which keeps undo history. A manual setValue here would wipe undo and fire a spurious onChange.

  return (
    <div className="monaco-wrapper" style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
      <Editor
        height="100%"
        width="100%"
        path={filePath}
        language={language}
        value={content}
        theme={theme === "light" ? "forge-light" : "forge-dark"}
        beforeMount={handleBeforeMount}
        onMount={handleEditorDidMount}
        onChange={handleChange}
        options={{
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
          fontLigatures: true,
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          minimap: { enabled: minimap, maxColumn: 80, scale: 0.8 },
          wordWrap,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          readOnly,
          padding: { top: 8, bottom: 8 },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: "all",
          tabSize: 2,
        }}
      />
    </div>
  );
}
