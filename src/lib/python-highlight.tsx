import React from "react";

// Tiny token-based Python syntax highlighter.
// Returns spans styled by tailwind syntax-* tokens.

const KEYWORDS = new Set([
  "import", "from", "as", "def", "return", "if", "else", "elif",
  "for", "while", "try", "except", "with", "True", "False", "None",
  "async", "await", "class", "lambda", "in", "is", "not", "and", "or", "pass",
]);

const BUILTINS = new Set(["print", "len", "range", "str", "int", "list", "dict", "open"]);

type Token = { t: string; k: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];

    // Comment
    if (c === "#") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      out.push({ t: src.slice(i, j), k: "comment" });
      i = j;
      continue;
    }

    // Strings (single/double, including triple)
    if (c === '"' || c === "'") {
      const quote = c;
      const triple = src.slice(i, i + 3) === quote.repeat(3);
      let j = i + (triple ? 3 : 1);
      while (j < n) {
        if (src[j] === "\\" && j + 1 < n) { j += 2; continue; }
        if (triple) {
          if (src.slice(j, j + 3) === quote.repeat(3)) { j += 3; break; }
          j++;
        } else {
          if (src[j] === quote) { j++; break; }
          if (src[j] === "\n") break;
          j++;
        }
      }
      out.push({ t: src.slice(i, j), k: "string" });
      i = j;
      continue;
    }

    // Number
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9._]/.test(src[j])) j++;
      out.push({ t: src.slice(i, j), k: "number" });
      i = j;
      continue;
    }

    // Identifier
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let kind = "variable";
      if (KEYWORDS.has(word)) kind = "keyword";
      else if (BUILTINS.has(word)) kind = "function";
      else if (src[j] === "(") kind = "function";
      out.push({ t: word, k: kind });
      i = j;
      continue;
    }

    // Whitespace
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      out.push({ t: src.slice(i, j), k: "ws" });
      i = j;
      continue;
    }

    // Punctuation / operators
    out.push({ t: c, k: "punct" });
    i++;
  }
  return out;
}

const CLASS: Record<string, string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  number: "text-syntax-number",
  comment: "text-syntax-comment italic",
  function: "text-syntax-function",
  variable: "text-syntax-variable",
  punct: "text-syntax-punct",
  ws: "",
};

export function HighlightedPython({ code }: { code: string }) {
  const tokens = React.useMemo(() => tokenize(code), [code]);
  return (
    <code className="font-mono text-[13px] leading-[1.65] whitespace-pre">
      {tokens.map((tok, idx) => (
        <span key={idx} className={CLASS[tok.k] || ""}>{tok.t}</span>
      ))}
    </code>
  );
}
