#!/usr/bin/env node
// Runs every frontend test script (src/**/__tests__/*.test.{ts,mjs}) with tsx.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (/__tests__/.test(path) && /\.test\.(ts|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const files = collect(join(root, 'src')).sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], {
    cwd: root,
    encoding: 'utf8',
  });
  const label = relative(root, file);
  if (result.status === 0) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}\n${result.stdout}${result.stderr}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed === 0 ? 0 : 1);
