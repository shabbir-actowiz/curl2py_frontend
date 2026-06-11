import Editor, { type BeforeMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CodeEditorProps {
  value: string;
  filename: string;
  onChange: (value: string) => void;
  wordWrap?: boolean;
  readOnly?: boolean;
  className?: string;
  parserInsertGroups?: Array<{ requestName: string; keys: string[] }>;
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

function cursorIsInsideQuotes(line: string, column: number): boolean {
  const before = line.slice(0, Math.max(0, column - 1));
  let single = false;
  let double = false;
  let escape = false;
  for (const char of before) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "'" && !double) single = !single;
    if (char === '"' && !single) double = !double;
  }
  return single || double;
}

const VARIABLE_TYPE_OPTIONS = ["string", "int", "float", "bool"] as const;
const VARIABLE_TYPES = new Set<string>(VARIABLE_TYPE_OPTIONS);
const PIPELINE_DEFAULTS_PREFIX = "# curl2py-pipeline-defaults: ";
type VariableType = typeof VARIABLE_TYPE_OPTIONS[number];

type PendingVariableDialog = {
  mode: "parser" | "manual";
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: Parameters<BeforeMount>[0];
  model: Monaco.editor.ITextModel;
  position: Monaco.Position;
  range: Monaco.Range | Monaco.Selection | null;
  selectedText: string;
  requestName?: string;
  key?: string;
};

function sanitizePythonName(value: string): string {
  let next = value.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (!next) next = "value";
  if (!/^[A-Za-z_]/.test(next)) next = `value_${next}`;
  return next;
}

function parsePythonLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed.startsWith("'") ? `"${trimmed.slice(1, -1).replace(/"/g, '\\"')}"` : trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed === "True") return true;
  if (trimmed === "False") return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?(?:\d+\.\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return Number.parseFloat(trimmed);
  return trimmed;
}

function coerceDefaultValue(value: unknown, type: string): unknown {
  if (type === "string") return String(value);
  if (type === "int") {
    const converted = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isInteger(converted)) throw new Error("Default value cannot be converted to int");
    return converted;
  }
  if (type === "float") {
    const converted = typeof value === "number" ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(converted)) throw new Error("Default value cannot be converted to float");
    return converted;
  }
  if (type === "bool") {
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    throw new Error("Default value cannot be converted to bool");
  }
  return value;
}

function pythonLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  return String(value);
}

function findValueRange(model: Monaco.editor.ITextModel, position: Monaco.Position, monaco: Parameters<BeforeMount>[0]): Monaco.Range | null {
  const line = model.getLineContent(position.lineNumber);
  const columnIndex = position.column - 1;
  const quoted = /(['"])(?:\\.|(?!\1).)*\1/g;
  for (const match of line.matchAll(quoted)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (columnIndex >= start && columnIndex <= end) {
      return new monaco.Range(position.lineNumber, start + 1, position.lineNumber, end + 1);
    }
  }
  const scalar = /(?:\bTrue\b|\bFalse\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const match of line.matchAll(scalar)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (columnIndex >= start && columnIndex <= end) {
      return new monaco.Range(position.lineNumber, start + 1, position.lineNumber, end + 1);
    }
  }
  return null;
}

function addFunctionArgument(code: string, variableName: string, defaultLiteral: string): string {
  const lines = code.split("\n");
  const index = lines.findIndex((line) => /^def\s+[A-Za-z_][A-Za-z0-9_]*\([^)]*\):\s*$/.test(line));
  if (index < 0) return code;
  lines[index] = lines[index].replace(/\(([^)]*)\)/, (_match, args) => {
    const existing = String(args).trim();
    if (new RegExp(`(^|,\\s*)${variableName}(\\s*=|\\s*,|$)`).test(existing)) return `(${existing})`;
    const arg = `${variableName}=${defaultLiteral}`;
    return `(${existing ? `${arg}, ${existing}` : arg})`;
  });
  return lines.join("\n");
}

function pipelinePathFromKey(key: string): string {
  return key.startsWith("[") ? key : `.${key}`;
}

function setNestedDefault(root: Record<string, unknown>, requestName: string, path: string, value: unknown) {
  const tokens = Array.from(path.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[(\d+)\]/g)).map((match) => {
    const raw = match[1] ?? match[2];
    return /^\d+$/.test(raw) ? Number(raw) : raw;
  });
  if (tokens.length === 0) return;
  let current: unknown = root[requestName] ?? {};
  root[requestName] = current;
  tokens.forEach((token, index) => {
    const last = index === tokens.length - 1;
    const nextToken = tokens[index + 1];
    if (typeof token === "string") {
      if (!current || typeof current !== "object" || Array.isArray(current)) return;
      const obj = current as Record<string, unknown>;
      if (last) {
        obj[token] = value;
        return;
      }
      if (!(token in obj)) obj[token] = typeof nextToken === "number" ? [] : {};
      current = obj[token];
      return;
    }
    if (!Array.isArray(current)) return;
    while (current.length <= token) current.push(typeof nextToken === "number" ? [] : {});
    if (last) {
      current[token] = value;
      return;
    }
    current = current[token];
  });
}

function updatePipelineDefaultsComment(code: string, requestName: string, key: string, defaultValue: unknown): string {
  const lines = code.split("\n");
  const existingIndex = lines.findIndex((line) => line.startsWith(PIPELINE_DEFAULTS_PREFIX));
  let defaults: Record<string, unknown> = {};
  if (existingIndex >= 0) {
    try {
      defaults = JSON.parse(lines[existingIndex].slice(PIPELINE_DEFAULTS_PREFIX.length)) as Record<string, unknown>;
    } catch {
      defaults = {};
    }
  }
  setNestedDefault(defaults, requestName, pipelinePathFromKey(key), defaultValue);
  const comment = `${PIPELINE_DEFAULTS_PREFIX}${JSON.stringify(defaults)}`;
  if (existingIndex >= 0) {
    lines[existingIndex] = comment;
    return lines.join("\n");
  }
  let insertAt = 0;
  while (insertAt < lines.length && (/^(import |from )/.test(lines[insertAt]) || lines[insertAt].trim() === "")) insertAt += 1;
  lines.splice(insertAt, 0, comment);
  return lines.join("\n");
}

export function CodeEditor({ value, filename, onChange, wordWrap = false, readOnly = false, className, parserInsertGroups = [] }: CodeEditorProps) {
  const [pendingDialog, setPendingDialog] = useState<PendingVariableDialog | null>(null);
  const [variableName, setVariableName] = useState("");
  const [variableType, setVariableType] = useState<VariableType>("string");
  const [dialogError, setDialogError] = useState("");

  const openParserVariableDialog = (dialog: PendingVariableDialog) => {
    setPendingDialog(dialog);
    setVariableName("");
    setVariableType("string");
    setDialogError("");
  };

  const openManualVariableDialog = (dialog: PendingVariableDialog) => {
    setPendingDialog(dialog);
    setVariableName(sanitizePythonName(dialog.selectedText.replace(/^['"]|['"]$/g, "")));
    setVariableType("string");
    setDialogError("");
  };

  const closeVariableDialog = () => {
    setPendingDialog(null);
    setDialogError("");
  };

  const submitVariableDialog = () => {
    if (!pendingDialog) return;
    const expectedType = variableType;
    if (!VARIABLE_TYPES.has(expectedType)) {
      setDialogError("Type must be one of: string, int, float, bool");
      return;
    }

    const { editor, monaco, model, position, range, selectedText } = pendingDialog;
    if (pendingDialog.mode === "parser") {
      const requestName = pendingDialog.requestName;
      const key = pendingDialog.key;
      if (!requestName || !key) return;
      const placeholder = `{{${requestName}.${key}|${expectedType}}}`;
      const line = model.getLineContent(position.lineNumber);
      const text = range && selectedText
        ? ((selectedText.startsWith('"') && selectedText.endsWith('"')) || (selectedText.startsWith("'") && selectedText.endsWith("'")) ? `"${placeholder}"` : placeholder)
        : cursorIsInsideQuotes(line, position.column) ? placeholder : `"${placeholder}"`;
      const editRange = range ?? new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
      editor.executeEdits("insert-parser-output", [{ range: editRange, text, forceMoveMarkers: true }]);
      if (range && selectedText) {
        try {
          const defaultValue = coerceDefaultValue(parsePythonLiteral(selectedText), expectedType);
          const nextValue = updatePipelineDefaultsComment(model.getValue(), requestName, key, defaultValue);
          model.setValue(nextValue);
          onChange(nextValue);
        } catch (error) {
          setDialogError(error instanceof Error ? error.message : "Default value conversion failed");
          return;
        }
      }
      editor.focus();
      closeVariableDialog();
      return;
    }

    const nextVariableName = sanitizePythonName(variableName);
    if (!nextVariableName) {
      setDialogError("Variable name is required");
      return;
    }
    let defaultLiteral: string;
    try {
      defaultLiteral = pythonLiteral(coerceDefaultValue(parsePythonLiteral(selectedText), expectedType));
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Default value conversion failed");
      return;
    }
    if (!range) return;
    const currentCode = model.getValue();
    const offset = model.getOffsetAt(range.getStartPosition());
    const length = model.getValueLengthInRange(range);
    const replacedCode = `${currentCode.slice(0, offset)}${nextVariableName}${currentCode.slice(offset + length)}`;
    const nextValue = addFunctionArgument(replacedCode, nextVariableName, defaultLiteral);
    model.setValue(nextValue);
    onChange(nextValue);
    editor.focus();
    closeVariableDialog();
  };

  return (
    <div className={cn("min-h-0 h-full", className)}>
      <Editor
        key={`${filename}:${parserInsertGroups.map((group) => `${group.requestName}:${group.keys.join(",")}`).join("|")}`}
        path={filename}
        language="python"
        theme="curlcraft-dark"
        value={value}
        beforeMount={defineCurlCraftTheme}
        onMount={(editor, monaco) => {
          parserInsertGroups.forEach((group) => {
            group.keys.forEach((key) => {
              const actionId = `insert-parser-output-${group.requestName}-${key}`;
              editor.addAction({
                id: actionId,
                label: `Insert From Parser Output / ${group.requestName} / ${key}`,
                contextMenuGroupId: `navigation/${group.requestName}`,
                contextMenuOrder: 1,
                run: (ed) => {
                  const model = ed.getModel();
                  const position = ed.getPosition();
                  if (!model || !position) return;
                  const selection = ed.getSelection();
                  const range = selection && !selection.isEmpty() ? selection : findValueRange(model, position, monaco);
                  const selectedText = range ? model.getValueInRange(range).trim() : "";
                  openParserVariableDialog({
                    mode: "parser",
                    editor: ed,
                    monaco,
                    model,
                    position,
                    range,
                    selectedText,
                    requestName: group.requestName,
                    key,
                  });
                },
              });
            });
          });
          editor.addAction({
            id: "make-request-value-variable",
            label: "Make variable",
            contextMenuGroupId: "navigation/manual-variable",
            contextMenuOrder: 0,
            run: (ed) => {
              const model = ed.getModel();
              const position = ed.getPosition();
              if (!model || !position) return;
              const selection = ed.getSelection();
              const range = selection && !selection.isEmpty() ? selection : findValueRange(model, position, monaco);
              if (!range) return;
              const selectedText = model.getValueInRange(range).trim();
              if (!selectedText) return;
              openManualVariableDialog({
                mode: "manual",
                editor: ed,
                monaco,
                model,
                position,
                range,
                selectedText,
              });
            },
          });
        }}
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
          readOnly,
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          stickyScroll: { enabled: false },
          tabSize: 4,
          wordWrap: wordWrap ? "on" : "off",
          wrappingIndent: "indent",
        }}
      />
      <Dialog open={!!pendingDialog} onOpenChange={(open) => !open && closeVariableDialog()}>
        <DialogContent className="max-w-sm border-border bg-background font-mono text-foreground">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              {pendingDialog?.mode === "manual" ? "Make Variable" : "Insert Parser Value"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[12px]">
            {pendingDialog?.mode === "manual" ? (
              <label className="block space-y-1">
                <span className="text-muted-foreground">Variable Name</span>
                <input
                  value={variableName}
                  onChange={(event) => setVariableName(event.target.value)}
                  className="h-8 w-full rounded-sm border border-border bg-background px-2 text-foreground outline-none focus:border-border-strong"
                  autoFocus
                />
              </label>
            ) : (
              <div className="rounded-sm border border-border bg-surface/50 px-2 py-1.5 text-muted-foreground">
                {pendingDialog?.requestName}.{pendingDialog?.key}
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-muted-foreground">Type</span>
              <select
                value={variableType}
                onChange={(event) => setVariableType(event.target.value as VariableType)}
                className="h-8 w-full rounded-sm border border-border bg-background px-2 text-foreground outline-none focus:border-border-strong"
                autoFocus={pendingDialog?.mode === "parser"}
              >
                {VARIABLE_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            {pendingDialog?.selectedText ? (
              <div className="space-y-1">
                <span className="text-muted-foreground">Current Value</span>
                <div className="max-h-20 overflow-auto rounded-sm border border-border bg-surface/50 px-2 py-1.5 text-foreground">
                  {pendingDialog.selectedText}
                </div>
              </div>
            ) : null}
            {dialogError ? (
              <div className="rounded-sm border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-destructive">
                {dialogError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={closeVariableDialog}
              className="inline-flex h-8 items-center justify-center rounded-sm border border-border bg-background/40 px-3 text-[12px] text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitVariableDialog}
              className="inline-flex h-8 items-center justify-center rounded-sm border border-primary/60 bg-primary/10 px-3 text-[12px] font-medium text-primary transition-colors hover:bg-primary/15"
            >
              Apply
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
