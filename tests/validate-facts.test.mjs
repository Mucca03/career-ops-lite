// Dato inventado = CV que no se puede defender en la entrevista. El validador
// compara cifras y nombres propios contra cv.md; una cifra verdadera
// ("8 s a 2 s") no debe dispararse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, checksOf, detailsOf, fixturePath, payloadVariant } from './helpers/fixtures.mjs';

test('una cifra y un nombre que sí están en cv.md no fallan', () => {
  const result = validate('entry', 'payload-01-backend.yml', '01-backend-python.md');
  assert.equal(result.code, 0, result.stderr);
  // El payload usa "8 s a 2 s" y "PostgreSQL": ambos están en cv.md.
  assert.deepEqual(checksOf(result), []);
});

test('una cifra que no está en cv.md falla', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace('Automaticé el respaldo diario', 'Automaticé 17 respaldos diarios'),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'cifras'), /17/);
});

test('un nombre propio inventado falla', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace('con un script en Bash y una cuarentena', 'con AWS Lambda y una cuarentena'),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'nombres'), /AWS/);
});

test('el resumen no puede introducir una tecnología que cv.md no menciona', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace('y una contribución mergeada en open source.', 'y una contribución mergeada en open source. También uso Rust.'),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'summary'), /Rust/);
});
