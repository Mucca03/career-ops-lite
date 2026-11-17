// El HTML lo escribe build-cv.mjs, no el agente. Aquí se comprueba el
// contrato visible: secciones por modo, todos los links del perfil, fechas de
// proyecto, y ni placeholders crudos ni hrefs vacíos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCv, fixturePath } from './helpers/fixtures.mjs';

const ENTRY = fixturePath('entry', 'payload-02-automatizacion.yml');

test('un CV entry no tiene sección de experiencia y sí proyectos', (t) => {
  const { code, html, stderr } = buildCv(t, ENTRY);
  assert.equal(code, 0, stderr);
  assert.match(html, /Proyectos/);
  assert.match(html, /Certificaciones/);
  assert.match(html, /Educación/);
  assert.doesNotMatch(html, /Experiencia Laboral/);
});

test('el encabezado lleva todos los links presentes en profile.yml', (t) => {
  const { html } = buildCv(t, ENTRY);
  for (const href of [
    'https://linkedin.com/in/persona-ejemplo',
    'https://github.com/persona-ejemplo',
    'https://blog.example.com',
    'https://copr.example.org/persona',
  ]) {
    assert.ok(html.includes(`href="${href}"`), `falta ${href}`);
  }
  assert.ok(html.includes('mailto:persona@example.com'));
});

test('las certificaciones relevantes se renderizan', (t) => {
  const { html } = buildCv(t, ENTRY);
  assert.match(html, /Linux Essentials/);
  assert.match(html, /Python for Everybody/);
});

test('las fechas de proyecto se pintan junto al nombre', (t) => {
  const { html } = buildCv(t, ENTRY);
  assert.match(html, /CLI de Respaldos<\/a> <span class="project-date">2026<\/span>/);
});

test('ni placeholders crudos ni hrefs vacíos', (t) => {
  const { html } = buildCv(t, ENTRY);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(html, /href=""/);
  assert.doesNotMatch(html, /href="https:\/\/"/);
});

test('un CV mixto abre con experiencia y sigue con proyectos', (t) => {
  const { code, html, stderr } = buildCv(t, fixturePath('mixed', 'payload-01-datos.yml'));
  assert.equal(code, 0, stderr);
  const experiencia = html.indexOf('Experiencia Laboral');
  const proyectos = html.indexOf('>Proyectos<');
  assert.ok(experiencia > 0, 'falta la sección de experiencia');
  assert.ok(proyectos > experiencia, 'proyectos debe ir después de la experiencia');
});
