import Editor, { type BeforeMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

import { cn } from "@/lib/utils";

interface CodeEditorProps {
  value: string;
  filename: string;
  onChange: (value: string) => void;
  wordWrap?: boolean;
  className?: string;
}

const defineCurlCraftTheme: BeforeMount = (monaco) => {
  if ((window as unknown as { __curlCraftMonacoTheme?: boolean }).__curlCraftMonacoTheme) return;
  (window as unknown as { __curlCraftMonacoTheme?: boolean }).__curlCraftMonacoTheme = true;

  monaco.languages.setMonarchTokensProvider("python", {
    defaultToken: "variable",
    tokenPostfix: ".python",
    keywords: [
      "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
      "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
      "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
    ],
    builtins: [
      "bool", "bytes", "dict", "enumerate", "float", "int", "json", "len", "list", "map", "max", "min",
      "open", "print", "range", "repr", "set", "str", "sum", "tuple", "type", "zip",
    ],
    operators: [
      "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||", "++", "--", "+", "-", "*",
      "/", "&", "|", "^", "%", "<<", ">>", "**", "+=", "-=", "*=", "/=", "%=",
    ],
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    tokenizer: {
      root: [
        [/"""/, { token: "string.delimiter", next: "@tripleDouble" }],
        [/'''/, { token: "string.delimiter", next: "@tripleSingle" }],
        [/[a-zA-Z_]\w*(?=\s*\()/, { cases: { "@builtins": "predefined", "@keywords": "keyword", "@default": "function" } }],
        [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@builtins": "predefined", "@default": "variable" } }],
        [/"([^"\\]|\\.)*"(?=\s*:)/, "dictkey"],
        [/'([^'\\]|\\.)*'(?=\s*:)/, "dictkey"],
        [/".*?"/, "string"],
        [/'.*?'/, "string"],
        [/#.*$/, "comment"],
        [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
        [/\d+/, "number"],
        [/[{}()[\]]/, "@brackets"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
      ],
      tripleDouble: [
        [/\b(query|mutation|fragment|subscription|on)\b/, "graphqlKeyword"],
        [/\$[A-Za-z_]\w*/, "graphqlVariable"],
        [/[A-Za-z_]\w*(?=\s*[{(:])/, "graphqlField"],
        [/"""/, { token: "string.delimiter", next: "@pop" }],
        [/./, "string"],
      ],
      tripleSingle: [
        [/\b(query|mutation|fragment|subscription|on)\b/, "graphqlKeyword"],
        [/\$[A-Za-z_]\w*/, "graphqlVariable"],
        [/[A-Za-z_]\w*(?=\s*[{(:])/, "graphqlField"],
        [/'''/, { token: "string.delimiter", next: "@pop" }],
        [/./, "string"],
      ],
    },
  });

  monaco.editor.defineTheme("curlcraft-dark", {
    base: "vs-dark",
    inherit: true,
    colors: {
      "editor.background": "#181912",
      "editor.foreground": "#e0ded0",
      "editorLineNumber.foreground": "#6e6d60",
      "editorLineNumber.activeForeground": "#a6c97b",
      "editorCursor.foreground": "#9fbd6d",
      "editor.selectionBackground": "#5f7d403f",
      "editor.inactiveSelectionBackground": "#42493655",
      "editor.lineHighlightBackground": "#24261d",
      "editorBracketMatch.background": "#5f7d4038",
      "editorBracketMatch.border": "#9fbd6d66",
      "editorIndentGuide.background1": "#34362b",
      "editorIndentGuide.activeBackground1": "#5b6049",
      "editor.findMatchBackground": "#8a6f324d",
      "editor.findMatchHighlightBackground": "#8a6f322e",
      "scrollbarSlider.background": "#4b4d4166",
      "scrollbarSlider.hoverBackground": "#686b5a88",
    },
    rules: [
      { token: "keyword", foreground: "c586c0" },
      { token: "string", foreground: "ce9178" },
      { token: "string.delimiter", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "comment", foreground: "6a9955", fontStyle: "italic" },
      { token: "function", foreground: "dcdcaa" },
      { token: "variable", foreground: "d4d4d4" },
      { token: "operator", foreground: "d4d4d4" },
      { token: "dictkey", foreground: "9cdcfe" },
      { token: "predefined", foreground: "4ec9b0" },
      { token: "graphqlKeyword", foreground: "c586c0" },
      { token: "graphqlVariable", foreground: "9cdcfe" },
      { token: "graphqlField", foreground: "dcdcaa" },
    ],
  } satisfies Monaco.editor.IStandaloneThemeData);
};

export function CodeEditor({ value, filename, onChange, wordWrap = false, className }: CodeEditorProps) {
  return (
    <div className={cn("min-h-0 h-full", className)}>
      <Editor
        path={filename}
        language="python"
        theme="curlcraft-dark"
        value={value}
        beforeMount={defineCurlCraftTheme}
        onChange={(next) => onChange(next ?? "")}
        options={{
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          detectIndentation: false,
          folding: true,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          fontLigatures: true,
          fontSize: 13,
          formatOnPaste: true,
          formatOnType: false,
          lineHeight: 21,
          lineNumbers: "on",
          matchBrackets: "always",
          minimap: { enabled: value.split("\n").length > 250 },
          multiCursorModifier: "alt",
          overviewRulerBorder: false,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          stickyScroll: { enabled: false },
          tabSize: 4,
          wordWrap: wordWrap ? "on" : "off",
          wrappingIndent: "indent",
        }}
      />
    </div>
  );
}
