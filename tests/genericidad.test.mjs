// El proyecto sirve para cualquier área: las mismas reglas se ejecutan sobre una
// fixture de desarrollo y otra de análisis de datos, y ninguna tecnología de las
// fixtures puede estar cableada en los scripts o en AGENTS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadYaml } from '../lib/yaml-document.mjs';
import {
  REPO, buildCv, checksOf, fixturePath, validate,
} from './helpers/fixtures.mjs';

const CASES = [
  ['entry', 'payload-04-trazabilidad.yml', '02-automatizacion-ia.md'],
  ['experienced', 'payload-01-backend.yml', '01-backend-python.md'],
];

const stripJsComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(?<!:)\/\/[^\n]*/g, ' ');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function techTermsOf(root, payloadName) {
  const data = loadYaml(readFileSync(fixturePath(root, payloadName), 'utf8')) ?? {};
  const terms = new Set();
  for (const item of [...(data.experience ?? []), ...(data.projects ?? [])]) {
    for (const part of String(item.tech ?? '').split(/[;,/·|]+/)) {
      const term = part.trim();
      if (term) terms.add(term);
    }
  }
  return terms;
}

test('A1-A10: las mismas reglas pasan en dos áreas distintas', () => {
  for (const [root, payload, offer] of CASES) {
    const result = validate(root, payload, offer);
    assert.equal(result.code, 0, `${root}: ${result.stdout}${result.stderr}`);
    assert.deepEqual(checksOf(result), [], root);
  }
});

test('A4/A5: projects con bullets, skills agrupadas y tech en su propia línea', (t) => {
  const { code, html, stderr } = buildCv(t, fixturePath('entry', 'payload-04-trazabilidad.yml'));
  assert.equal(code, 0, stderr);
  assert.match(html, /<li>PR #42 mergeado/);
  assert.match(html, /<div class="project-tech">C\+\+, D-Bus, Flatpak<\/div>/);
  for (const category of ['Lenguajes', 'Sistemas', 'Contribución']) {
    assert.match(html, new RegExp(`<strong class="skill-category">${category}:</strong>`));
  }
  // Compatibilidad: un payload antiguo con solo `description` sigue generando.
  const legacy = buildCv(t, fixturePath('entry', 'payload-01-backend.yml'));
  assert.equal(legacy.code, 0, legacy.stderr);
  assert.match(legacy.html, /<div class="project-desc">/);
});

test('genericidad: AGENTS.md y los scripts no cablean tecnologías ni identidades de las fixtures', () => {
  const terms = new Set([
    ...techTermsOf('entry', 'payload-04-trazabilidad.yml'),
    ...techTermsOf('experienced', 'payload-01-backend.yml'),
  ]);
  assert.ok(terms.size >= 4, `las fixtures deben aportar tecnologías: ${[...terms].join(', ')}`);

  const sources = [
    ['validate-extra.mjs', stripJsComments(readFileSync(join(REPO, 'validate-extra.mjs'), 'utf8'))],
    ['build-cv.mjs', stripJsComments(readFileSync(join(REPO, 'build-cv.mjs'), 'utf8'))],
    ['threshold.mjs', stripJsComments(readFileSync(join(REPO, 'threshold.mjs'), 'utf8'))],
    ['lib/threshold.mjs', stripJsComments(readFileSync(join(REPO, 'lib', 'threshold.mjs'), 'utf8'))],
    ['AGENTS.md', readFileSync(join(REPO, 'AGENTS.md'), 'utf8').replace(/^```[a-z]*$/gm, '')],
  ];

  for (const [file, source] of sources) {
    for (const term of terms) {
      const pattern = new RegExp(`(?<![a-z0-9])${escapeRegex(term.toLowerCase())}(?![a-z0-9])`, 'i');
      assert.doesNotMatch(source, pattern, `${file} cablea la tecnología «${term}» de una fixture`);
    }
    for (const identity of ['persona@example.com', 'persona-ejemplo', 'Empresa Datos', 'Universidad Ejemplo']) {
      assert.ok(!source.includes(identity), `${file} contiene el dato sintético «${identity}»`);
    }
  }
});
