import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_SECTIONS = [
  '## Objects',
  '## Contracts',
  '## Submissions',
  '## Verdicts and status',
  '## Cascade',
  '## Decomposition',
  '## Coordination',
  '## Frontier and closability',
  '## Deprecation',
  '## Laws',
  '## Human role',
  '## Agent playbook',
];

test('PROTOCOL.md exists and covers every required section', () => {
  const p = path.join(repoRoot, 'PROTOCOL.md');
  assert.ok(fs.existsSync(p), 'PROTOCOL.md missing');
  const text = fs.readFileSync(p, 'utf8');
  for (const section of REQUIRED_SECTIONS) {
    assert.ok(text.includes(`\n${section}`), `missing section: ${section}`);
  }
});
