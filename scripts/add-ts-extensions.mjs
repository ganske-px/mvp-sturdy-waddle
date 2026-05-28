#!/usr/bin/env node
// Adds .ts extensions to internal imports (relative or @/...) across lib/.
// Idempotent: skips imports that already end with an extension.
// Required by the Supabase Edge Functions bundler (Deno-style resolution).

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const FILES = walk('lib');

// Matches `from 'X'` or `from "X"` where X is './foo', '../foo' or '@/foo'.
const IMPORT_RE = /(from\s+['"])(\.{1,2}\/[^'"]+|@\/[^'"]+)(['"])/g;
const HAS_EXT_RE = /\.(ts|tsx|js|jsx|json|mjs|cjs|css|svg|png|jpg|jpeg|gif|webp|mdx)$/;

let touched = 0;
for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(IMPORT_RE, (full, lead, path, trail) => {
    if (HAS_EXT_RE.test(path)) return full;
    return `${lead}${path}.ts${trail}`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    touched++;
    console.info(`  ${file}`);
  }
}
console.info(`Updated ${touched} files.`);
