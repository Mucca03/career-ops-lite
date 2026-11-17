// La relevancia es por oferta: el mismo candidato ordena distinto sus proyectos
// según lo que pida cada JD. Y las certificaciones relevantes que existen en
// cv.md no se recortan antes que un proyecto poco relevante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, checksOf, detailsOf, runScript, fixturePath, payloadVariant } from './helpers/fixtures.mjs';

const OFERTAS = [
  ['01-backend-python.md', 'payload-01-backend.yml'],
  ['02-automatizacion-ia.md', 'payload-02-automatizacion.yml'],
  ['03-java-junior.md', 'payload-03-java.yml'],
];

test('cada oferta tiene su orden: los tres payloads pasan con su propia oferta', () => {
  for (const [oferta, payload] of OFERTAS) {
    const result = validate('entry', payload, oferta);
    assert.equal(result.code, 0, `${oferta}: ${result.stdout}${result.stderr}`);
    assert.deepEqual(checksOf(result), [], oferta);
  }
});

test('el orden no es casual: el payload de backend falla contra la oferta de automatización', () => {
  // Payload ordenado para backend (Panel primero); la oferta de automatización
  // premia la CLI de Respaldos, así que el primero deja de ser el más relevante.
  const result = validate('entry', 'payload-01-backend.yml', '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.equal(result.report.mode, 'entry');
  assert.match(detailsOf(result, 'orden'), /projects/);
});

test('quitar una certificación relevante que existe en cv.md falla', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace(/ {2}- title: Linux Essentials\n {4}org: Linux Foundation\n {4}year: "2024"\n/, ''),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'certificaciones'), /Linux Essentials/);
});

test('sin oferta no se comprueba relevancia y se avisa', () => {
  const result = runScript('validate-extra.mjs', [
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    '--root', fixturePath('entry'),
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /sin oferta/);
});
