// El modo del CV sale de cv.md, nunca del nombre del candidato ni de una
// corazonada: entry (solo proyectos/open source), experienced (roles con
// empresa y fechas), mixed (ambos). Forzarlo con cv.mode es posible, pero
// cuando lo que hay es entry y el payload inventa roles, hay que fallar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, checksOf, fixturePath, payloadVariant } from './helpers/fixtures.mjs';

test('entry: sin roles en cv.md, el modo es entry y experience queda vacío', () => {
  const result = validate('entry', 'payload-02-automatizacion.yml', '02-automatizacion-ia.md');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.report.mode, 'entry');
  assert.equal(result.report.counts.experience, 0);
});

test('experienced: dos roles con empresa y fechas dan modo experienced', () => {
  const result = validate('experienced', 'payload-01-backend.yml', '01-backend-python.md');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.report.mode, 'experienced');
  assert.equal(result.report.counts.experience, 2);
  assert.equal(result.report.counts.projects, 0);
});

test('mixed: un rol real y además proyectos dan modo mixed', () => {
  const result = validate('mixed', 'payload-01-datos.yml', '01-backend-python.md');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.report.mode, 'mixed');
  assert.equal(result.report.counts.experience, 1);
  assert.equal(result.report.counts.projects, 1);
});

test('entry con un proyecto convertido en rol falla con un error claro', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace('experience: []', [
      'experience:',
      '  - company: CLI de Respaldos',
      '    role: Desarrollador',
      '    dates: 2026',
      '    bullets:',
      '      - "Automaticé el respaldo diario en Linux."',
    ].join('\n')),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.ok(checksOf(result).includes('modo'), JSON.stringify(result.report));
});

test('cv.mode fuerza el modo: con mode=entry, un rol en el payload falla', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lite-profile-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, readFileSync(fixturePath('entry', 'config', 'profile.yml'), 'utf8')
    .replace('mode: auto', 'mode: entry'));

  const result = validate('entry', fixturePath('experienced', 'payload-01-backend.yml'), '01-backend-python.md', [
    '--profile', profile,
  ]);
  assert.equal(result.code, 1);
  assert.ok(checksOf(result).includes('modo'), JSON.stringify(result.report));
});

test('un cv.md generado por Pandoc también se lee: la cabecera con spans no oculta la experiencia', (t) => {
  // `## **[Professional Experience]{.smallcaps}**` y `---` como raya: el
  // formato que sale de convertir un Word con Pandoc. Un regex sobre la
  // cabecera en crudo lo leía como "sin experiencia" y degradaba el chequeo.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lite-cv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cvPath = join(dir, 'cv.md');
  writeFileSync(cvPath, [
    '# Nombre Apellido',
    '',
    '## **[Professional Experience]{.smallcaps}**',
    '',
    '### **Empresa Datos** --- Bogotá',
    '',
    '**Analista de Datos**\\',
    '**09/2021 -- Present**',
    '',
    '- Tableros de Power BI sobre SQL y Python.',
    '- Automaticé la extracción con Python y Docker.',
    '',
    '### **Empresa Soporte** --- Bogotá',
    '',
    '**Soporte Técnico**\\',
    '**2020 -- 2022**',
    '',
    '- Atendí usuarios y documenté incidentes con Linux.',
    '',
  ].join('\n'));

  const result = validate('experienced', 'payload-01-backend.yml', null, ['--cv', cvPath]);
  assert.equal(result.report?.mode, 'experienced', result.stderr);
  assert.equal(result.code, 0, result.stderr);
});
