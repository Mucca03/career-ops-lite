// Utilidades compartidas por los tests: ejecutan los scripts por su CLI real,
// sin importarlos (`validate-extra.mjs` y `build-cv.mjs` corren `main()` al
// importarse). Cada test trabaja contra una fixture sintética de tests/fixtures.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function fixturePath(...parts) {
  return join(REPO, 'tests', 'fixtures', ...parts);
}

export function offerPath(name) {
  return fixturePath('jds', name);
}

export function runScript(script, args) {
  const result = spawnSync(process.execPath, [join(REPO, script), ...args], {
    encoding: 'utf8',
    cwd: REPO,
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Ejecuta validate-extra.mjs contra una fixture.
 * `payload` puede ser un nombre dentro de la fixture o una ruta absoluta
 * (las variantes rotas que crea payloadVariant()).
 */
export function validate(root, payload, offer = null, extraArgs = []) {
  const payloadPath = payload.startsWith('/') ? payload : fixturePath(root, payload);
  const args = [payloadPath];
  if (offer) args.push(offerPath(offer));
  args.push('--root', fixturePath(root), '--json', ...extraArgs);
  const { code, stdout, stderr } = runScript('validate-extra.mjs', args);
  let report = null;
  try {
    report = JSON.parse(stdout);
  } catch {
    // Sin JSON en stdout: el test mostrará stdout/stderr al fallar.
  }
  return { code, report, stdout, stderr, args };
}

export const problemsOf = (result) => result.report?.problems ?? [];
export const checksOf = (result) => problemsOf(result).map((problem) => problem.check);
export const detailsOf = (result, check) => problemsOf(result)
  .filter((problem) => problem.check === check)
  .map((problem) => problem.detail)
  .join('\n');

/**
 * Copia un payload aplicando `transform` y devuelve la ruta del temporal.
 * Falla si la transformación no cambió nada: una variante que no varía probaría
 * lo que ya cubre el caso positivo.
 */
export function payloadVariant(t, sourcePath, transform) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lite-payload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = readFileSync(sourcePath, 'utf8');
  const changed = transform(original);
  if (changed === original) throw new Error(`la variante no cambió ${sourcePath}`);
  const target = join(dir, 'payload.yml');
  writeFileSync(target, changed);
  return target;
}

/** Renderiza un payload con build-cv.mjs y devuelve el HTML. */
export function buildCv(t, payloadPath) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lite-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'cv.html');
  const result = runScript('build-cv.mjs', [payloadPath, out]);
  return {
    ...result,
    html: result.code === 0 ? readFileSync(out, 'utf8') : '',
  };
}
