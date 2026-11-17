#!/usr/bin/env node
/**
 * validate-extra.mjs — comprobaciones deterministas del CV adaptado, sin LLM.
 *
 * Existe porque un modelo pequeño (7B-9B) inventa con seguridad: añade una
 * métrica que suena bien, convierte un proyecto en un puesto de trabajo o lista
 * una tecnología que nunca usó. Un juez probabilístico no lo detecta de forma
 * fiable; estas ocho comprobaciones sí, y son idioma-agnósticas (comparan
 * texto normalizado, sin diccionarios de inglés).
 *
 * Uso:
 *   node validate-extra.mjs <payload.yml> [<oferta.md>]
 *   node validate-extra.mjs <payload.yml> <oferta.md> --json
 *   node validate-extra.mjs <payload.yml> --root /tmp/fixture
 *
 * Sin oferta, las comprobaciones de relevancia (orden y certificaciones) se
 * omiten y se avisa; el resto se ejecuta igual.
 *
 * Salida: exit 0 si todo pasa, exit 1 con la lista de problemas. Corrige el
 * YAML; nunca el HTML.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { normalizePandocLine, headingText, toPlainText, isExperienceHeading } from './lib/cv-markdown.mjs';

// ── normalización ───────────────────────────────────────────────────────────

/** Minúsculas, sin diacríticos, espacios colapsados. Base de toda comparación. */
const fold = (value) => String(value ?? '')
  .normalize('NFKC')       // dígitos y signos de ancho completo → ASCII
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const str = (value) => (value == null ? '' : String(value).trim());
const list = (value) => (Array.isArray(value) ? value.filter((v) => v != null && v !== '') : []);
const pick = (obj, ...keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

const URL_KEYS = ['linkedin', 'github', 'portfolio'];

/** URL comparable: sin esquema, sin www., sin barra final. */
const normUrl = (value) => fold(value).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/** Texto visible de un enlace, igual que en build-cv.mjs. */
const displayUrl = (value) => str(value)
  .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

// ── vocabulario ─────────────────────────────────────────────────────────────
// Palabras vacías de es/en/pt y verbos de currículum en primera persona. No
// describen el puesto ni la tecnología, así que ni puntúan relevancia ni se
// tratan como nombres propios.

const STOPWORDS = new Set(`
a al algo algun alguna algunas alguno algunos ante antes aquel aqui asi aun
bajo bien cada como con contra cual cuales cuando de del desde donde dos durante
e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estan
estas este esto estos estoy fue fueron ha hace hacen hacia han hasta hay la las
le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otras
otro otros para pero poco por porque que quien quienes se sea segun ser si sin
sobre sois somos son soy su sus tambien tan tanto te tengo ti tiene tienen todo
todos tu tus un una unas uno unos vosotros y ya yo

the a an and or but if then than that this these those there here with without
from into onto over under between among through during before after above below
for of to in on at by as is are was were be been being have has had do does did
will would can could should may might must not no nor so such own same very more
most much many few some any each every all both either neither other another
i you he she it we they me him her us them my your his its our their mine ours
yours theirs this these what which who whom whose when where why how
built build builds building developed develop develops developing designed
create created creates creating implemented implement implements implementing
led lead leads leading reduced reduce reduces reducing automated automate
automates automating migrated migrate migrates migrating documented document
documents documenting published publish publishes publishing avoided avoid
avoids avoiding resolved resolve resolves resolving validated validate
validates validating protected protect protects protecting controlled control
maintained maintain maintains maintaining configured configure configures
enabled enable enables enabling created designed achieved achieve achieves
delivered deliver delivers delivering improved improve improves improving
increased increase increases increasing decreased decrease decreases decreasing
saved save saves saving wrote write writes writing ran run runs running made make
makes making used use uses using worked work works working helped help helps
helping ensured ensure ensures ensuring provided provide provides providing
generated generate generates generating analyzed analyze analyzes analyzing
optimized optimize optimizes optimizing supported support supports supporting
managed manage manages managing coordinated coordinate coordinates coordinating

um uma uns umas o a os as de do da dos das em no na nos nas por para com sem
sobre entre ate apos antes depois como quando onde que quem qual quais seu sua
seus suas ele ela eles elas eu nos vos e ou mas nao sim ja foi ser estar ter
tem tem sido sendo feito feita

janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro
dezembro enero febrero marzo abril mayo junio julio agosto septiembre octubre
noviembre diciembre january february march april may june july august september
october november december jpg png pdf http https www com org net
`.trim().split(/\s+/));

const WORD_NUMBERS = new Map(Object.entries({
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
  quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, mil: 1000,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  thousand: 1000, cem: 100, duzentos: 200, duzentas: 200,
}));

const MONTHS = new Set([
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

// ── texto ───────────────────────────────────────────────────────────────────

const wordTokens = (text) => (
  fold(text).match(/[a-z0-9][a-z0-9+#.]*/g) || []
);

/** ¿Aparece `needle` como palabra (o como subcadena si trae C++, .NET, /)? */
function mentions(haystackFold, needle) {
  const raw = fold(needle);
  if (!raw) return true;
  if (/[^a-z0-9 ]/.test(raw)) {
    const compactHay = haystackFold.replace(/\s+/g, '');
    return haystackFold.includes(raw) || compactHay.includes(raw.replace(/\s+/g, ''));
  }
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystackFold);
}

/**
 * Une los grupos de millares separados por espacio ("16 181" → "16181"), el
 * formato de fr/ru y de un número copiado de un PDF. Sin esto, "16 181" y
 * "16.181" se comparan como números distintos y una cifra verdadera se reporta
 * como inventada. El guardia `(?<!\d)\d{1,3}` evita unir "2026 100".
 */
const joinDigitGroups = (text) => String(text ?? '')
  .replace(/(?<!\d)(\d{1,3})[\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1');

/** Variantes de un número: "1.234,56" → 123456 / 1234.56 / "51,6" → 516 / 51.6. */
function addNumberVariants(set, raw) {
  const clean = str(raw).replace(/[.,]+$/, '');
  if (!clean || !/\d/.test(clean)) return;
  set.add(clean.replace(/[.,]/g, ''));
  set.add(clean.replace(/,/g, '.'));
  set.add(clean.replace(/\./g, '').replace(/,/g, '.'));
  const plain = clean.replace(/\./g, '').replace(/,/g, '');
  if (/^\d+$/.test(plain)) set.add(String(Number(plain)));
}

function stripMarkdown(line) {
  const flat = String(line)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/`/g, '');
  return toPlainText(flat);
}

const hasDates = (text) => /\b(19|20)\d{2}\b|\bpresente\b|\bpresent\b|\bactual\b|\bcurrent\b|\batual\b/i.test(text);

// ── cv.md ───────────────────────────────────────────────────────────────────
// La estructura se lee con `lib/cv-markdown.mjs` (el mismo módulo que usa
// verify-cv-structure.mjs): normaliza el Markdown que produce Pandoc —`## **[Professional
// Experience]{.smallcaps}**`— y reconoce los nombres de sección en es/en/pt.
// Un regex casero sobre la cabecera en crudo convertía esos cv.md en "sin
// experiencia" y degradaba la comprobación sin avisar.

const SECTION_RX = {
  // isExperienceHeading() cubre "Experience"/"Experiencia (Laboral)"; esto
  // recoge los alias que usa un CV en español y no son ese nombre exacto.
  experience: /trayectoria|\blaboral\b|\bempleo\b|work history|employment history/,
  projects: /proyect|projeto|project|open source|contribuci|contribui|portafolio|portfolio|repositorio/,
  education: /educaci|formaci|education|forma[cç][aã]o|estudios|academic/,
  certifications: /certific|licencia|license|curso|course|idioma|language|reconocimiento|award/,
};

function sectionKind(name) {
  if (isExperienceHeading(name) || SECTION_RX.experience.test(fold(name))) return 'experience';
  for (const kind of ['projects', 'education', 'certifications']) {
    if (SECTION_RX[kind].test(fold(name))) return kind;
  }
  return 'other';
}

/**
 * Lee cv.md sin depender de un formato exacto: secciones por `##`, ítems por
 * `###` y, si la sección no usa `###` (certificaciones e idiomas suelen ser
 * viñetas), cada viñeta cuenta como ítem.
 */
function parseCv(text) {
  const lines = String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizePandocLine);
  const sections = [];
  let current = { name: '', raw: [] };
  for (const line of lines) {
    const h2 = headingText(line, 2);
    if (h2 !== null) {
      if (current.name || current.raw.length) sections.push(current);
      current = { name: h2, raw: [] };
      continue;
    }
    current.raw.push(line);
  }
  sections.push(current);

  return sections.map((section) => {
    const entries = [];
    let entry = null;
    for (const line of section.raw) {
      const h3 = headingText(line, 3);
      if (h3 !== null) {
        entry = { title: h3, body: [] };
        entries.push(entry);
        continue;
      }
      if (entry) entry.body.push(stripMarkdown(line));
    }
    const bullets = section.raw
      .map((line) => line.match(/^\s*[-*]\s+(.+)$/))
      .filter(Boolean)
      .map((m) => stripMarkdown(m[1]))
      .filter((line) => line.length > 3);

    const items = entries.length
      ? entries.map((e) => ({ title: e.title, text: [e.title, ...e.body].join('\n') }))
      : bullets.map((b) => ({ title: b, text: b }));

    return {
      name: section.name,
      kind: sectionKind(section.name),
      text: section.raw.map(stripMarkdown).join('\n'),
      items: items.map((item) => ({ ...item, dated: hasDates(item.text) })),
    };
  });
}

function cvSectionsBy(cv, kind) {
  return cv.filter((section) => section.kind === kind);
}

function parseProfile(raw) {
  const candidate = raw?.candidate ?? {};
  return {
    candidate,
    cv: raw?.cv ?? {},
    language: raw?.language ?? {},
  };
}

// ── relevancia ──────────────────────────────────────────────────────────────

/** Términos comparables de un texto: sin vacías, sin números sueltos, ≥3 letras. */
function termSet(text) {
  return new Set(wordTokens(text).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)));
}

function relevanceScore(text, terms) {
  let hits = 0;
  for (const term of termSet(text)) if (terms.has(term)) hits += 1;
  return hits;
}

const itemText = (item) => [
  pick(item, 'name', 'nombre', 'role', 'title', 'puesto', 'cargo') ?? '',
  pick(item, 'tech', 'stack', 'tecnologias') ?? '',
  pick(item, 'description', 'descripcion') ?? '',
  ...list(pick(item, 'bullets', 'logros', 'achievements') ?? []),
].join('\n');

/**
 * Partes de una competencia: "Docker / GitHub Actions (CI/CD)" → ["Docker",
 * "GitHub Actions"]. El paréntesis es una aclaración, no un requisito aparte:
 * sacarlo evita pedir un "CI/CD" literal en los bullets.
 */
function competencyParts(competency) {
  return String(competency)
    .replace(/\([^)]*\)/g, ' ')      // primero el paréntesis: "(CI/CD)" no es una ruta
    .split(/\s*[/,]\s*/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * ¿Un ítem incluido respalda esta parte? Se acepta la frase exacta o, si es
 * multi-palabra, alguno de sus términos con peso ("Automatización CLI" se
 * respalda con un bullet que hable de CLI). Un término inventado —"Kubernetes"
 * sin Kubernetes en ningún ítem— no pasa.
 */
function competencyBacked(haystackFold, part) {
  if (mentions(haystackFold, part)) return true;
  const terms = wordTokens(part)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
  if (!terms.length) return false;
  return terms.some((token) => mentions(haystackFold, token));
}

/** Nombre de la certificación: el encabezado antes de "— entidad (año)". */
function certName(text) {
  return str(text)
    .split(/\s+[—–-]\s+|\s*\(/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solapamiento de términos entre dos cadenas, 0..1 sobre el primer conjunto. */
function overlap(a, b) {
  const left = termSet(a);
  if (left.size === 0) return 0;
  const right = termSet(b);
  let hits = 0;
  for (const term of left) if (right.has(term)) hits += 1;
  return hits / left.size;
}

// ── validación ──────────────────────────────────────────────────────────────

const PROJECT_FORBIDDEN = [
  ['role', 'cargo'], ['title', 'puesto'], ['company', 'empresa'], ['location', 'ubicacion'],
];

function validate(payload, profile, cvText, jdText) {
  const problems = [];
  const fail = (check, detail) => problems.push({ check, detail });
  const cv = parseCv(cvText);
  const cvFold = fold(cvText);

  // ── 1. links del perfil y campos de contacto ──────────────────────────────
  const candidate = profile.candidate;
  const payloadUrls = new Set();
  for (const key of URL_KEYS) {
    const value = str(payload[key]);
    if (value) payloadUrls.add(normUrl(value));
  }
  for (const link of list(payload.links)) {
    const url = typeof link === 'string' ? link : pick(link, 'url', 'href', 'link');
    if (str(url)) payloadUrls.add(normUrl(url));
  }

  const expectedLinks = [];
  for (const key of URL_KEYS) {
    const value = str(candidate[key]);
    if (value) expectedLinks.push({ label: displayUrl(value), url: normUrl(value), key });
  }
  for (const link of list(candidate.links)) {
    const url = typeof link === 'string' ? link : pick(link, 'url', 'href', 'link');
    const label = typeof link === 'string' ? '' : str(pick(link, 'label', 'name', 'nombre'));
    if (str(url)) {
      expectedLinks.push({
        label: label ? `${label} (${displayUrl(url)})` : displayUrl(url),
        url: normUrl(url),
        key: 'links',
      });
    }
  }
  for (const link of expectedLinks) {
    if (!payloadUrls.has(link.url)) {
      fail('links', `falta el link de profile.yml (${link.key}): ${link.label}`);
    }
  }
  for (const key of ['email', 'phone', 'location', 'linkedin', 'github', 'portfolio']) {
    if (key in payload && str(payload[key]) === '') {
      fail('contacto', `campo de contacto vacío: ${key}`);
    }
  }

  // ── 2. modo del CV ────────────────────────────────────────────────────────
  const employment = cvSectionsBy(cv, 'experience').flatMap((s) => s.items).filter((i) => i.dated);
  const cvProjects = cvSectionsBy(cv, 'projects').flatMap((s) => s.items);
  const configured = fold(pick(profile.cv, 'mode') ?? pick(payload, 'mode') ?? 'auto');
  const mode = ['experienced', 'entry', 'mixed'].includes(configured)
    ? configured
    : employment.length
      ? (cvProjects.length ? 'mixed' : 'experienced')
      : 'entry';

  const experience = list(payload.experience);
  if (mode === 'entry' && experience.length > 0) {
    fail('modo', `mode=entry pero experience tiene ${experience.length} ítem(s): `
      + 'un proyecto, open source o trabajo académico no es un rol');
  }

  // ── 3. proyectos disfrazados de empleo ────────────────────────────────────
  const projects = list(payload.projects);
  projects.forEach((project, index) => {
    for (const [key, alias] of PROJECT_FORBIDDEN) {
      const value = pick(project, key, alias);
      if (str(value)) {
        fail('proyectos', `projects[${index}] tiene \`${key}: ${str(value)}\`: un proyecto no tiene cargo, empresa ni ubicación`);
      }
    }
  });

  // ── 4. competencias respaldadas por un ítem incluido ──────────────────────
  const includedText = [...experience, ...projects].map(itemText).join('\n');
  const includedFold = fold(includedText);
  const competencies = list(payload.competencies);
  for (const competency of competencies) {
    const parts = competencyParts(competency);
    const missing = parts.filter((part) => !competencyBacked(includedFold, part));
    if (missing.length) {
      fail('competencias', `sin respaldo en ningún bullet ni stack incluido: ${competency}`
        + (missing.length < parts.length ? ` (falta «${missing.join('», «')}»)` : ''));
    }
  }

  // ── 5. cifras y nombres propios de los bullets ────────────────────────────
  const cvNumbers = new Set();
  for (const match of joinDigitGroups(cvText).matchAll(/\d[\d.,]*/g)) addNumberVariants(cvNumbers, match[0]);
  for (const [word, number] of WORD_NUMBERS) {
    if (mentions(cvFold, word)) addNumberVariants(cvNumbers, String(number));
  }

  const reported = new Set();
  const report = (check, detail) => {
    const key = `${check}:${detail}`;
    if (reported.has(key)) return;
    reported.add(key);
    fail(check, detail);
  };

  const bulletSources = [
    ...experience.flatMap((item, index) => [
      ...list(pick(item, 'bullets', 'logros') ?? []).map((bullet) => ({ where: `experience[${index}]`, bullet })),
      { where: `experience[${index}].description`, bullet: pick(item, 'description', 'descripcion') ?? '' },
    ]),
    ...projects.flatMap((item, index) => [
      ...list(pick(item, 'bullets', 'logros') ?? []).map((bullet) => ({ where: `projects[${index}]`, bullet })),
      { where: `projects[${index}].description`, bullet: pick(item, 'description', 'descripcion') ?? '' },
    ]),
  ].filter((source) => str(source.bullet));

  for (const { where, bullet } of bulletSources) {
    for (const match of joinDigitGroups(bullet).matchAll(/\d[\d.,]*/g)) {
      const found = new Set();
      addNumberVariants(found, match[0]);
      if (![...found].some((variant) => cvNumbers.has(variant))) {
        report('cifras', `${where}: la cifra ${match[0]} no aparece en cv.md`);
      }
    }
    // Nombres propios: se omiten la primera palabra de cada frase (el verbo) y
    // los términos vacíos; el resto debe existir literalmente en cv.md.
    for (const sentence of String(bullet).split(/(?<=[.:;])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      words.forEach((word, index) => {
        const clean = word.replace(/^[("'«¡¿]+|[)"'».,;:!?]+$/g, '');
        if (!/^[A-ZÁÉÍÓÚÑ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ+#.-]*$/.test(clean)) return;
        const folded = fold(clean);
        if (index === 0 || folded.length < 3 || STOPWORDS.has(folded) || MONTHS.has(folded)) return;
        if (/^\d/.test(folded)) return;
        if (!mentions(cvFold, folded)) {
          report('nombres', `${where}: «${clean}» no aparece en cv.md`);
        }
      });
    }
  }

  // ── 6. el resumen no introduce tecnología propia ──────────────────────────
  const summary = str(pick(payload, 'summary', 'resumen', 'perfil'));
  if (summary) {
    for (const sentence of summary.split(/(?<=[.:;])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      words.forEach((word, index) => {
        const clean = word.replace(/^[("'«¡¿]+|[)"'».,;:!?]+$/g, '');
        if (!/^[A-ZÁÉÍÓÚÑ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ+#.-]*$/.test(clean)) return;
        const folded = fold(clean);
        // La primera palabra de la frase es el verbo conjugado ("Desarrollo…",
        // "Mantengo…"): va en mayúscula por ortografía, no por ser un nombre.
        if (index === 0 || folded.length < 3 || STOPWORDS.has(folded) || MONTHS.has(folded)) return;
        if (!mentions(cvFold, folded)) report('summary', `«${clean}» no aparece en cv.md`);
      });
    }
  }

  // ── 7 y 8. relevancia (solo con oferta) ───────────────────────────────────
  const jdTerms = jdText ? termSet(jdText) : null;
  if (jdTerms && jdTerms.size > 0) {
    for (const [label, items] of [['projects', projects], ['experience', experience]]) {
      if (items.length < 2) continue;
      const scores = items.map((item) => relevanceScore(itemText(item), jdTerms));
      const best = Math.max(...scores);
      if (best > 0 && scores[0] < best) {
        fail('orden', `en ${label} el ítem más relevante no está primero (puntajes ${scores.join(', ')}; `
          + `el primero debería ser el de ${best})`);
      }
    }

    const cvCerts = cvSectionsBy(cv, 'certifications').flatMap((s) => s.items).map((i) => certName(i.title));
    // Una certificación es relevante si comparte al menos dos términos con la
    // oferta o la mitad de los suyos ("Linux Essentials" con una oferta que pide
    // Linux). Con una sola coincidencia suelta no se exige nada.
    const isRelevantCert = (cert) => {
      const terms = termSet(cert);
      if (terms.size === 0) return false;
      let hits = 0;
      for (const term of terms) if (jdTerms.has(term)) hits += 1;
      return hits >= 2 || hits / terms.size >= 0.5;
    };
    const includedCerts = list(payload.certifications).map((cert) => certName(
      typeof cert === 'string' ? cert : str(pick(cert, 'title', 'name', 'nombre')),
    )).filter(Boolean);
    const maxCerts = Number(pick(profile.cv, 'max_certifications') ?? 3) || 3;
    // Si el CV ya lleva el máximo de certificaciones, no se le piden más: el
    // recorte es una decisión legítima, no un olvido.
    if (includedCerts.length < maxCerts) {
      const relevantCerts = cvCerts.filter(isRelevantCert);
      const missing = relevantCerts.filter((cert) => (
        !includedCerts.some((included) => overlap(cert, included) >= 0.5)
      ));
      for (const cert of missing.slice(0, maxCerts - includedCerts.length)) {
        fail('certificaciones', `certificación relevante de cv.md fuera del CV: ${str(cert).slice(0, 80)}`);
      }
    }
  }

  return { problems, mode, counts: {
    experience: experience.length,
    projects: projects.length,
    competencies: competencies.length,
    certifications: list(payload.certifications).length,
  } };
}

// ── entrada ─────────────────────────────────────────────────────────────────

function readYamlFile(path) {
  if (!existsSync(path)) return null;
  try {
    return loadYaml(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`YAML inválido en ${path}: ${error.message}`);
  }
}

const HELP = `Uso:
  node validate-extra.mjs <payload.yml> [<oferta.md>]

Opciones:
  --json              salida legible por máquina
  --root <dir>        raíz del proyecto (por defecto, la del repo)
  --profile <ruta>    profile.yml alternativo
  --cv <ruta>         cv.md alternativo
  --help

Comprueba sin LLM: links del perfil y campos de contacto, modo del CV
(entry/experienced/mixed), proyectos sin cargo/empresa/ubicación, competencias
respaldadas, cifras y nombres propios que existan en cv.md, y —si se pasa la
oferta— orden por relevancia y certificaciones relevantes incluidas.
Exit 1 si algo falla: corrige el YAML, nunca el HTML.`;

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    process.exit(argv.length ? 0 : 1);
  }

  const opts = { json: argv.includes('--json') };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i];
    else if (arg.startsWith('--root=')) opts.root = arg.slice(7);
    else if (arg === '--profile') opts.profile = argv[++i];
    else if (arg.startsWith('--profile=')) opts.profile = arg.slice(10);
    else if (arg === '--cv') opts.cv = argv[++i];
    else if (arg.startsWith('--cv=')) opts.cv = arg.slice(5);
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  const payloadPath = positional[0];
  const jdPath = positional[1];
  if (!payloadPath) {
    console.error('validate-extra: falta el payload YAML. Ver --help.');
    process.exit(1);
  }
  if (!existsSync(payloadPath)) {
    console.error(`validate-extra: no existe ${payloadPath}`);
    process.exit(1);
  }

  const root = resolve(opts.root || getCareerOpsRoot());
  const profilePath = opts.profile ? resolve(opts.profile) : getProfilePath(root);
  const cvPath = opts.cv ? resolve(opts.cv) : join(root, 'cv.md');

  if (!existsSync(cvPath)) {
    console.error(`validate-extra: no existe ${cvPath} — sin cv.md no hay contra qué validar.`);
    process.exit(1);
  }
  if (!existsSync(profilePath)) {
    console.error(`validate-extra: no existe ${profilePath} — el onboarding debe crearlo antes.`);
    process.exit(1);
  }

  let payload;
  let profile;
  try {
    payload = readYamlFile(payloadPath);
    profile = parseProfile(readYamlFile(profilePath) ?? {});
  } catch (error) {
    console.error(`validate-extra: ${error.message}`);
    process.exit(1);
  }
  if (!payload || typeof payload !== 'object') {
    console.error(`validate-extra: ${basename(payloadPath)} está vacío o no es un objeto YAML.`);
    process.exit(1);
  }

  if (jdPath && !existsSync(jdPath)) {
    console.error(`validate-extra: no existe la oferta ${jdPath}`);
    process.exit(1);
  }
  const jdText = jdPath ? readFileSync(jdPath, 'utf8') : '';

  const { problems, mode, counts } = validate(payload, profile, readFileSync(cvPath, 'utf8'), jdText);
  const bytes = statSync(payloadPath).size;
  const tokens = Math.round(bytes / 3.9);

  if (opts.json) {
    console.log(JSON.stringify({
      ok: problems.length === 0,
      mode,
      counts,
      tokens,
      jd: Boolean(jdText),
      problems,
    }, null, 2));
    process.exit(problems.length ? 1 : 0);
  }

  if (problems.length === 0) {
    console.log(`✅ validate-extra — modo ${mode}, ${counts.experience} rol(es), `
      + `${counts.projects} proyecto(s), ${counts.competencies} competencia(s), `
      + `${counts.certifications} certificación(es) · payload ≈ ${tokens} tokens`);
    if (!jdText) console.log('   (sin oferta: no se comprobó orden por relevancia ni certificaciones)');
    return;
  }

  console.error(`❌ validate-extra — ${problems.length} problema(s) en ${basename(payloadPath)}`);
  const shown = problems.slice(0, 12);
  shown.forEach((problem, index) => console.error(`  ${index + 1}. [${problem.check}] ${problem.detail}`));
  if (problems.length > shown.length) console.error(`  … ${problems.length - shown.length} más`);
  console.error('Corrige el YAML y vuelve a ejecutar. No edites el HTML.');
  process.exit(1);
}

main();
