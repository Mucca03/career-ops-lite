// Defectos visuales que rompen la lectura: pipes huérfanos, fechas que caen
// debajo de su título, certificaciones apiladas, skills en varias columnas,
// etiquetas tipo pill y colores fuera de la escala de grises. Todo se comprueba
// sobre el HTML que emite build-cv.mjs y sobre el PDF real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCv, fixturePath, pdfPageCount, renderPdf,
} from './helpers/fixtures.mjs';

const cssOf = (html) => html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

const sectionTitles = (html) => [...html.matchAll(/<div class="section-title">([^<]*)<\/div>/g)]
  .map((match) => match[1]);

const ruleOf = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`)) ?? [''])[0];
};

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

  // C4: una línea por categoría, con la categoría en negrita. La sección es
  // única: `competencies[]` se integra aquí, no crea otra sección.
  assert.equal((body.match(/<div class="skill-item">/g) ?? []).length, 3);
  for (const category of ['Categoría 1', 'Categoría 2', 'Categoría 3']) {
    assert.match(body, new RegExp(`<strong class="skill-category">${category}:</strong>`));
  }
  assert.match(html, /\.skills-grid\s*\{[^}]*display:\s*block/);
  assert.equal(sectionTitles(html).filter((title) => /Competencias|Habilidades|Skills/.test(title)).length, 1);

  // C5: el CV completo cabe en una página.
  const pdf = await renderPdf(html);
  assert.equal(pdfPageCount(pdf), 1);
});

test('monocromático y ejecutivo: sin pills, solo negro/gris, orden ATS y sin alturas fijas', async (t) => {
  const { code, html, stderr } = buildCv(t, fixturePath('layout', 'payload-01-layout.yml'));
  assert.equal(code, 0, stderr);
  const body = html.slice(html.indexOf('<body>'));
  const css = cssOf(html);

  // Sin etiquetas redondeadas ni fondos: competencias y proyectos son texto.
  assert.doesNotMatch(body, /competency-tag|competencies-grid|project-badge/);
  assert.doesNotMatch(css, /\.competency-tag|\.competencies-grid|\.project-badge/);
  assert.doesNotMatch(ruleOf(css, '.skill-item'), /border-radius|background|padding/);

  // Un solo color: cada literal hexadecimal del CSS es gris (r = g = b).
  assert.doesNotMatch(css, /hsla?\(|rgba?\(/);
  const colors = css.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) ?? [];
  assert.ok(colors.length >= 2, 'el CSS debe declarar sus colores explícitamente');
  for (const color of colors) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(r === g && g === b, `color fuera de la escala de grises: ${color}`);
  }

  // Cero alturas fijas en el encabezado y en las secciones.
  for (const selector of ['.header', '.section']) {
    const rule = ruleOf(css, selector);
    assert.ok(rule, `falta la regla ${selector}`);
    assert.doesNotMatch(rule, /(?:^|[;{])\s*(?:max-)?height\s*:/, `${selector} tiene altura fija`);
  }

  // Orden ATS estricto, una sola sección de competencias, sin duplicados.
  assert.deepEqual(sectionTitles(html), [
    'Perfil Profesional',
    'Experiencia Laboral',
    'Proyectos',
    'Educación',
    'Competencias',
    'Certificaciones',
  ]);

  // Sin experiencia formal, Proyectos sube justo después del resumen.
  const entry = buildCv(t, fixturePath('entry', 'payload-04-trazabilidad.yml'));
  assert.equal(entry.code, 0, entry.stderr);
  assert.deepEqual(sectionTitles(entry.html), [
    'Perfil Profesional',
    'Proyectos',
    'Educación',
    'Competencias',
    'Certificaciones',
  ]);

  // La cabecera sigue recortando enlaces largos y sin pipe literal en el cuerpo.
  assert.doesNotMatch(body, /\|/);
  const pdf = await renderPdf(html);
  assert.equal(pdfPageCount(pdf), 1);
});
