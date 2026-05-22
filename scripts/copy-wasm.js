import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");

const wasmFiles = [
  {
    name: "tree-sitter.wasm",
    candidates: [
      join(rootDir, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
    ],
  },
  {
    name: "tree-sitter-bash.wasm",
    candidates: [
      join(rootDir, "node_modules", "curlconverter", "dist", "tree-sitter-bash.wasm"),
      join(rootDir, "node_modules", "tree-sitter-bash", "tree-sitter-bash.wasm"),
    ],
  },
];

function findSource(candidates) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

mkdirSync(publicDir, { recursive: true });

let copied = 0;
const missing = [];

for (const wasm of wasmFiles) {
  const source = findSource(wasm.candidates);
  const destination = join(publicDir, wasm.name);

  if (!source) {
    missing.push(`${wasm.name} (${wasm.candidates.join(", ")})`);
    continue;
  }

  copyFileSync(source, destination);
  copied += 1;
  console.log(`[copy-wasm] ${wasm.name} -> public/${wasm.name}`);
}

if (missing.length > 0) {
  console.error("[copy-wasm] Missing required WASM file(s):");
  for (const item of missing) {
    console.error(`  - ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[copy-wasm] Copied ${copied} WASM file(s).`);
}
