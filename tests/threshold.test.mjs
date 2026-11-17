// El umbral es un valor por defecto, no un veto: bajo el umbral se ofrece el CV,
// y solo una petición explícita (o `force`) lo genera, con aviso y estado
// `Forced`. `min_score` es el único suelo que pide confirmación incluso cuando
// ya hay petición. Todas las fixtures son sintéticas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideThreshold, normalizeScoring } from '../lib/threshold.mjs';
import {
  REPO, buildCv, fixturePath, pdfText, renderPdf,
} from './helpers/fixtures.mjs';

const THRESHOLD = { apply_threshold: 4.0 };

test('1. bajo el umbral sin petición: no hay CV y se ofrece en una línea', () => {
  const decision = decideThreshold({ score: 3.2, scoring: THRESHOLD });
  assert.equal(decision.generate, false);
  assert.equal(decision.action, 'offer');
  assert.equal(decision.tracker_status, null);
  assert.match(decision.message, /Score 3\.2\/5/);
  assert.match(decision.message, /umbral 4\.0/);
  assert.match(decision.message, /genera igual/);
});

test('2. bajo el umbral con petición: CV, aviso solo en el chat y Forced con el score real', async (t) => {
  const decision = decideThreshold({
    score: 3.2,
    scoring: THRESHOLD,
    requested: true,
    gaps: 'requisito: X; valorado: Y',
  });
  assert.equal(decision.generate, true);
  assert.equal(decision.tracker_status, 'Forced');
  assert.match(decision.warning, /^⚠ Score 3\.2\/5, por debajo del umbral 4\.0\./);
  assert.match(decision.warning, /Generado a petición tuya\./);
  assert.match(decision.warning, /requisito: X; valorado: Y/);

  // El aviso vive en el paso de decisión, no en el generador de CV.
  const built = buildCv(t, fixturePath('entry', 'payload-04-trazabilidad.yml'));
  assert.equal(built.code, 0, built.stderr);
  assert.doesNotMatch(built.html, /⚠|por debajo del umbral/);
  assert.doesNotMatch(built.payload, /⚠|por debajo del umbral/);
  const text = pdfText(await renderPdf(built.html));
  if (text !== null) assert.doesNotMatch(text, /⚠|por debajo del umbral/);
});

test('3. below_threshold: force sin petición se comporta como el caso 2', () => {
  const decision = decideThreshold({
    score: 3.2,
    scoring: { ...THRESHOLD, below_threshold: 'force' },
  });
  assert.equal(decision.generate, true);
  assert.equal(decision.tracker_status, 'Forced');
  assert.match(decision.warning, /^⚠ Score 3\.2\/5/);
});

test('4. below_threshold: discard sin petición: línea Descartada y sin PDF', () => {
  const decision = decideThreshold({
    score: 2.9,
    scoring: { ...THRESHOLD, below_threshold: 'discard' },
    company: 'Empresa Ejemplo',
    position: 'Puesto Ejemplo',
    gap: 'idioma',
  });
  assert.equal(decision.generate, false);
  assert.equal(decision.tracker_status, 'Discarded');
  assert.match(decision.message, /^Descartada — Empresa Ejemplo · Puesto Ejemplo: score 2\.9\/5\. Brecha principal: idioma\.$/);
});

test('5. min_score: confirma una vez; sin confirmación no hay CV y con ella queda Forced', () => {
  const scoring = { apply_threshold: 4.0, min_score: 3.0 };
  const pending = decideThreshold({ score: 2.4, scoring, requested: true });
  assert.equal(pending.generate, false);
  assert.equal(pending.action, 'confirm');
  assert.equal(pending.tracker_status, null);
  assert.match(pending.message, /Score 2\.4\/5 está por debajo de tu mínimo \(3\.0\)\. ¿Confirmas\?/);

  // Una petición explícita no salta el mínimo: sigue preguntando.
  assert.equal(pending.action, 'confirm');

  const confirmed = decideThreshold({ score: 2.4, scoring, requested: true, confirmed: true });
  assert.equal(confirmed.generate, true);
  assert.equal(confirmed.tracker_status, 'Forced');
  assert.match(confirmed.warning, /^⚠ Score 2\.4\/5/);
});

test('6. Regla 1: el flujo del CV no envía ni rellena formularios', () => {
  const files = ['threshold.mjs', 'lib/threshold.mjs', 'build-cv.mjs', 'validate-extra.mjs'];
  for (const file of files) {
    const source = readFileSync(join(REPO, file), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|new\s+FormData|\.submit\s*\(/i, file);
  }
  const agents = readFileSync(join(REPO, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Nunca envíes, publiques ni rellenes un formulario/);

  // La decisión solo devuelve datos: no tiene una acción de envío.
  const decision = decideThreshold({ score: 5, scoring: THRESHOLD });
  assert.deepEqual(Object.keys(decision).sort(), [
    'action', 'generate', 'message', 'scoring', 'tracker_status', 'warning',
  ]);
});

test('valores por defecto seguros: ask y min_score 0 cuando el perfil no configura nada', () => {
  assert.deepEqual(normalizeScoring({}), {
    apply_threshold: 4.0,
    below_threshold: 'ask',
    min_score: 0,
  });
  const decision = decideThreshold({ score: 3.9, scoring: {} });
  assert.equal(decision.action, 'offer');
});
