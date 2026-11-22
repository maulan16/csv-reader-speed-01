// main.ts: the program the harness runs (node /bot/main.ts). Reads every case from /input/cases.json, answers each
// alone with run() from solve.js, writes /output/answers.json. MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR override the dirs.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const mod = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
  runBytes: (input: unknown) => Uint8Array;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
// Each answer is the UTF-8 JSON text runBytes returns (the same value run returns); they are written as one array.
const parts: Uint8Array[] = [];
const COMMA = Buffer.from(',');
parts.push(Buffer.from('['));
for (let i = 0; i < cases.length; i++) {
  if (i > 0) parts.push(COMMA);
  parts.push(mod.runBytes(cases[i].input));
}
parts.push(Buffer.from(']'));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), Buffer.concat(parts));
