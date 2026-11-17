// Defectos visuales que rompen la lectura: pipes huérfanos en la cabecera,
// fechas que caen debajo de su título, certificaciones agrupadas arriba y
// skills en varias columnas. Todo se comprueba sobre el HTML que emite
// build-cv.mjs y sobre el PDF real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCv, fixturePath, pdfPageCount, renderPdf,
} from './helpers/fixtures.mjs';

test('C1-C5: sin pipes sueltos, una fila por certificación, skills por línea y una página', async (t) => {
  const { code, html, stderr } = buildCv(t, fixturePath('layout', 'payload-01-layout.yml'));
  assert.equal(code, 0, stderr);
  const body = html.slice(html.indexOf('<body>'));

  // C1/C2/C3: en el marcado no hay ningún "|" literal; el separador de contacto
  // es contenido CSS. Un "|  |" o un pipe al inicio de línea saldría aquí.
  assert.ok(!body.includes('|'), `el cuerpo contiene un pipe suelto: ${(body.match(/.{0,50}\|.{0,50}/) ?? [''])[0]}`);
  assert.doesNotMatch(body, /\|\s*\|/);

  // C1: la cabecera recorta cualquier enlace que sobresalga.
  assert.match(html, /\.header\s*\{[^}]*overflow:\s*hidden/);

  // C2: experiencia y educación son filas flex con la fecha a la derecha.
  assert.equal((body.match(/<div class="job-header">/g) ?? []).length, 2);
  assert.equal((body.match(/<div class="edu-header">/g) ?? []).length, 2);
  assert.match(html, /\.job-period\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(html, /\.edu-year\s*\{[^}]*flex-shrink:\s*0/);

  // C3: tres certificaciones, tres filas, cada una con su nombre y su año; la
  // que no tiene emisor no deja un separador vacío.
  assert.equal((body.match(/<div class="cert-item">/g) ?? []).length, 3);
  assert.equal((body.match(/<span class="cert-year">/g) ?? []).length, 3);
  assert.doesNotMatch(body, /class="cert-org"><\/span>/);
  for (const row of body.split('<div class="cert-item">').slice(1)) {
    assert.match(row, /class="cert-title"/);
    assert.match(row, /class="cert-year"/);
  }

  // C4: una línea por categoría, con la categoría en negrita.
  assert.equal((body.match(/<div class="skill-item">/g) ?? []).length, 3);
  for (const category of ['Categoría 1', 'Categoría 2', 'Categoría 3']) {
    assert.match(body, new RegExp(`<strong class="skill-category">${category}:</strong>`));
  }
  assert.match(html, /\.skills-grid\s*\{[^}]*display:\s*block/);

  // C5: el CV completo cabe en una página.
  const pdf = await renderPdf(html);
  assert.equal(pdfPageCount(pdf), 1);
});
