// Una competencia es una promesa del CV: tiene que estar respaldada por el
// stack o un bullet de un ítem incluido. Lo que pide la oferta y no está
// respaldado es una brecha, no una competencia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, checksOf, detailsOf, fixturePath, payloadVariant } from './helpers/fixtures.mjs';

test('competencias respaldadas por el stack del ítem pasan', () => {
  const result = validate('entry', 'payload-02-automatizacion.yml', '02-automatizacion-ia.md');
  assert.equal(result.code, 0, result.stderr);
});

test('una tecnología que no aparece en ningún ítem incluido falla', (t) => {
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace('  - Bash\n', '  - Bash\n  - Kubernetes\n'),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'competencias'), /Kubernetes/);
});

test('en una competencia compuesta solo se señala la parte sin respaldo', (t) => {
  // Docker sí está en el stack del panel; GitHub Actions no aparece en ningún
  // ítem. El paréntesis "(CI/CD)" es una aclaración y no se exige literal.
  const broken = payloadVariant(
    t,
    fixturePath('entry', 'payload-02-automatizacion.yml'),
    (yaml) => yaml.replace('  - Bash\n', '  - Bash\n  - Docker / GitHub Actions (CI/CD)\n'),
  );
  const result = validate('entry', broken, '02-automatizacion-ia.md');
  assert.equal(result.code, 1);
  assert.match(detailsOf(result, 'competencias'), /falta «GitHub Actions»/);
  assert.doesNotMatch(detailsOf(result, 'competencias'), /falta «Docker»/);
});
