#!/usr/bin/env node
import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Remove build output from every package.
 *
 * `tsc --build --clean` only removes what its own project emitted, which leaves
 * stale `dist` directories behind after a package is renamed or a file is
 * deleted. This is the blunt version, for when the build looks haunted.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = join(root, 'packages');

const removed = [];

for (const name of readdirSync(packages)) {
  const dir = join(packages, name);
  if (!statSync(dir).isDirectory()) continue;

  for (const target of ['dist', 'tsconfig.tsbuildinfo', join('node_modules', '.vite')]) {
    const path = join(dir, target);
    try {
      rmSync(path, { recursive: true, force: true });
      removed.push(`packages/${name}/${target.replace(/\\/g, '/')}`);
    } catch {
      // Nothing there, or nothing we are allowed to remove. Either is fine.
    }
  }
}

process.stdout.write(`${removed.length === 0 ? 'nothing to clean' : `cleaned ${removed.length} paths`}\n`);
