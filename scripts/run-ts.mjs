#!/usr/bin/env node
// Bundles a TypeScript entry with rolldown (ships with Vite) and runs it in Node.
// Lets tests import the simulation exactly as the browser does.
import { build } from 'rolldown';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const entry = process.argv[2];
if (!entry) { console.error('usage: run-ts <entry.ts>'); process.exit(2); }
const out = path.resolve('node_modules/.cache/run-ts', path.basename(entry).replace(/\.ts$/, '.mjs'));
await build({ input: entry, platform: 'node', logLevel: 'warn', output: { file: out, format: 'esm' } });
await import(pathToFileURL(out).href);
