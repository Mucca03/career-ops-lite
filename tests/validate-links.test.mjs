// El encabezado del CV sale de profile.yml: si el perfil tiene un link, el CV
// lo lleva; y ningún campo de contacto puede viajar vacío (un <a href=""> deja
// su separador "|" colgando).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, checksOf, detailsOf, fixturePath, payloadVariant } from './helpers/fixtures.mjs';

test('un payload completo incluye todos los links del perfil y no falla', () => {
  const result = validate('entry', 'payload-01-backend.yml', '01-backend-python.md');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(checksOf(result), []);
});

test('quitar un link que está en profile.yml falla y dice cuál', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-01-backend.yml'),
    (yaml) => yaml.replace('github: github.com/persona-ejemplo\n', ''),
  );
  const result = validate('entry', broken, '01-backend-python.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'links'), /github/);
});

test('un campo de contacto presente pero vacío falla', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-01-backend.yml'),
    (yaml) => yaml.replace('phone: "+57 300 111 2233"', 'phone: ""'),
  );
  const result = validate('entry', broken, '01-backend-python.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'contacto'), /phone/);
});

test('un link extra de profile.yml (links[]) también debe estar en el CV', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-01-backend.yml'),
    (yaml) => yaml.replace(/links:\n {2}- label: Copr\n {4}url: .*\n/, ''),
  );
  const result = validate('entry', broken, '01-backend-python.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'links'), /Copr/);
});
