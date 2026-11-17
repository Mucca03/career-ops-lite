#!/usr/bin/env node
/**
 * build-cv.mjs — rellena templates/cv-template.html desde un payload YAML.
 *
 * La plantilla queda intacta: este script solo sustituye sus {{PLACEHOLDERS}}.
 * Existe porque un agente (sobre todo un modelo local de 7B-9B) que escribe
 * 22 KB de HTML a mano deja placeholders crudos, duplica secciones o rompe el
 * marcado. Aquí el agente escribe ~1 KB de YAML y el HTML sale determinista.
 *
 * Uso:
 *   node build-cv.mjs <payload.yml> <salida.html> [--check]
 *   node build-cv.mjs --help
 *
 * --check valida el payload y no escribe nada (exit 1 si es inválido).
 *
 * Contrato de salida:
 *   - Todo el texto del payload se escapa (incluidas { y }), así que ni un
 *     nombre con "<" ni un bullet que cite {{algo}} puede inyectar marcado.
 *   - Una sección sin datos se elimina COMPLETA, con su título.
 *   - Si al final queda algún {{PLACEHOLDER}}, falla: nunca se escribe un HTML
 *     con sintaxis cruda.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml } from './lib/yaml-document.mjs';
import { PAGE_WIDTHS, resolvePageFormat } from './lib/page-format.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(HERE, 'templates/cv-template.html');

const TITLES = {
  en: {
    summary: 'Professional Summary',
    experience: 'Work Experience', projects: 'Projects', education: 'Education',
    certifications: 'Certifications', awards: 'Awards & Honors',
    interests: 'Interests', skills: 'Skills',
  },
  es: {
    summary: 'Perfil Profesional',
    experience: 'Experiencia Laboral', projects: 'Proyectos', education: 'Educación',
    certifications: 'Certificaciones', awards: 'Logros y Reconocimientos',
    interests: 'Intereses', skills: 'Competencias',
  },
  pt: {
    summary: 'Resumo Profissional',
    experience: 'Experiência Profissional', projects: 'Projetos', education: 'Formação',
    certifications: 'Certificações', awards: 'Prêmios', interests: 'Interesses',
    skills: 'Competências',
  },
};

// Marcador del comentario HTML → placeholder que llena su sección. Si ese
// placeholder queda vacío, el bloque entero (comentario + <div class="section">)
// se elimina del documento.
const SECTION_CONTENT = {
  'PROFESSIONAL SUMMARY': 'SUMMARY_TEXT',
  'WORK EXPERIENCE': 'EXPERIENCE',
  PROJECTS: 'PROJECTS',
  EDUCATION: 'EDUCATION',
  'COMPETENCIES / SKILLS': 'SKILLS',
  CERTIFICATIONS: 'CERTIFICATIONS',
  AWARDS: 'AWARDS',
  INTERESTS: 'INTERESTS',
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/\{/g, '&#123;')
  .replace(/\}/g, '&#125;');

const str = (value) => (value == null ? '' : String(value).trim());
const pick = (obj, ...keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
};
const list = (value) => (Array.isArray(value) ? value.filter((v) => v != null && v !== '') : []);

// ── enlaces ────────────────────────────────────────────────────────────────
// Un CV de cualquier candidato tiene un juego distinto de enlaces: uno trae
// GitHub y portafolio, otro solo LinkedIn, otro ninguno. El encabezado se
// construye con los que existan, en orden, sin huecos: un <a> sin texto
// dejaría su separador "|" colgando del ítem anterior.

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

/** Solo se emiten hrefs con esquema conocido; nada de javascript: ni data:. */
function safeHref(href) {
  const value = str(href);
  return SAFE_SCHEME.test(value) ? value : '';
}

function absoluteUrl(value) {
  const raw = str(value);
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
}

/** Texto visible de un enlace: sin esquema, sin www., sin barra final. */
function displayUrl(value) {
  return str(value)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

/** Acepta `links: [{label, url}]` y también `links: ["https://…"]`. */
function normalizeLinks(raw) {
  return list(raw).map((entry) => {
    if (typeof entry === 'string') return { label: '', url: entry };
    return {
      label: str(pick(entry, 'label', 'name', 'nombre', 'texto')),
      url: str(pick(entry, 'url', 'href', 'link')),
    };
  }).filter((link) => link.url);
}

function contactHtml(cv) {
  const items = [];
  const seen = new Set();
  const push = (key, html) => {
    const id = str(key).toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push(html);
  };
  const addLink = (value, label) => {
    const href = safeHref(absoluteUrl(value));
    if (!href) return;
    push(displayUrl(value), `<a href="${escapeHtml(href)}">${escapeHtml(label || displayUrl(value))}</a>`);
  };

  if (cv.phone) {
    const tel = safeHref(`tel:${str(cv.phone).replace(/[^\d+]/g, '')}`);
    push(tel || `phone:${cv.phone}`, tel
      ? `<a href="${escapeHtml(tel)}">${escapeHtml(cv.phone)}</a>`
      : `<span>${escapeHtml(cv.phone)}</span>`);
  }
  if (cv.email) {
    push(`mailto:${str(cv.email).toLowerCase()}`, `<a href="mailto:${escapeHtml(cv.email)}">${escapeHtml(cv.email)}</a>`);
  }
  if (cv.linkedin) addLink(cv.linkedin);
  if (cv.github) addLink(cv.github);
  if (cv.portfolio) addLink(cv.portfolio);
  // Dos campos con la misma URL (github y portfolio apuntando al mismo perfil)
  // se emiten una sola vez: `push` deduplica por URL normalizada.
  for (const link of cv.links) addLink(link.url, link.label);
  if (cv.location) push(`location:${cv.location}`, `<span>${escapeHtml(cv.location)}</span>`);

  return items.join('\n      ');
}

/** Acepta {role|title|puesto|cargo} y company|empresa|org: los modelos pequeños varían. */
function experienceHtml(entries) {
  return list(entries).map((entry) => {
    const company = escapeHtml(pick(entry, 'company', 'empresa', 'org') ?? '');
    const role = escapeHtml(pick(entry, 'role', 'title', 'puesto', 'cargo') ?? '');
    const period = escapeHtml(pick(entry, 'dates', 'period', 'fechas') ?? '');
    const location = pick(entry, 'location', 'ubicacion');
    const context = pick(entry, 'context', 'contexto');
    const bullets = list(pick(entry, 'bullets', 'logros', 'achievements') ?? [])
      .map((bullet) => `      <li>${escapeHtml(bullet)}</li>`).join('\n');
    const extra = [
      context ? `\n    <div class="job-context">${escapeHtml(context)}</div>` : '',
      location ? `\n    <div class="job-location">${escapeHtml(location)}</div>` : '',
    ].join('');
    return `<div class="job">
    <div class="job-header">
      <span class="job-company">${company}</span>
      <span class="job-period">${period}</span>
    </div>
    <div class="job-role">${role}</div>${extra}${bullets ? `\n    <ul>\n${bullets}\n    </ul>` : ''}
  </div>`;
  }).join('\n  ');
}

function projectsHtml(entries) {
  return list(entries).map((entry) => {
    const name = escapeHtml(pick(entry, 'name', 'nombre') ?? '');
    const url = str(pick(entry, 'url'));
    const dates = str(pick(entry, 'dates', 'period', 'fechas', 'year', 'anio', 'año'));
    // `description` es la alternativa de una frase; `bullets` conserva varios
    // logros con sus cifras. Si vienen los dos, la descripción es el contexto y
    // los bullets van debajo. Los payloads antiguos solo traen `description`.
    const description = escapeHtml(pick(entry, 'description', 'descripcion') ?? '');
    const bullets = list(pick(entry, 'bullets', 'logros', 'achievements') ?? []);
    const tech = escapeHtml(pick(entry, 'tech', 'tecnologias', 'stack') ?? '');
    // Un enlace sin esquema seguro no se emite como <a href="">.
    const href = safeHref(absoluteUrl(url));
    const title = href ? `<a href="${escapeHtml(href)}">${name}</a>` : name;
    const when = dates ? ` <span class="project-date">${escapeHtml(dates)}</span>` : '';
    const bulletsHtml = bullets.length
      ? `\n    <ul>\n${bullets.map((bullet) => `      <li>${escapeHtml(bullet)}</li>`).join('\n')}\n    </ul>`
      : '';
    return `<div class="project">
    <div class="project-title">${title}${when}</div>${description ? `\n    <div class="project-desc">${description}</div>` : ''}${bulletsHtml}${tech ? `\n    <div class="project-tech">${tech}</div>` : ''}
  </div>`;
  }).join('\n  ');
}

function educationHtml(entries) {
  return list(entries).map((entry) => {
    const title = escapeHtml(pick(entry, 'title', 'degree', 'titulo', 'carrera') ?? '');
    const org = pick(entry, 'org', 'institution', 'institucion', 'universidad');
    const year = escapeHtml(pick(entry, 'year', 'dates', 'anio', 'año') ?? '');
    const location = pick(entry, 'location', 'ubicacion');
    const description = pick(entry, 'description', 'descripcion');
    const orgHtml = org ? ` <span class="edu-org">${escapeHtml(org)}</span>` : '';
    return `<div class="edu-item">
    <div class="edu-header">
      <div class="edu-title">${title}${orgHtml}</div>
      <div class="edu-year">${year}</div>
    </div>${location ? `\n    <div class="edu-location">${escapeHtml(location)}</div>` : ''}${description ? `\n    <div class="edu-desc">${escapeHtml(description)}</div>` : ''}
  </div>`;
  }).join('\n  ');
}

function certificationsHtml(entries, classes) {
  return list(entries).map((entry) => {
    const title = escapeHtml(pick(entry, 'title', 'name', 'nombre') ?? '');
    const org = escapeHtml(pick(entry, 'org', 'issuer', 'entidad') ?? '');
    const year = escapeHtml(pick(entry, 'year', 'date', 'fecha', 'anio', 'año') ?? '');
    // Una fila por certificación: nombre + emisor a la izquierda, año a la
    // derecha. Si falta el emisor o el año no se emite su celda: nada de
    // separadores vacíos ni "|  |".
    const orgHtml = org ? `<span class="${classes.org}">${org}</span>` : '';
    const yearHtml = year ? `<span class="${classes.year}">${year}</span>` : '';
    return `<div class="${classes.item}">
      <span class="${classes.main}"><span class="${classes.title}">${title}</span>${orgHtml}</span>${yearHtml}
    </div>`;
  }).join('\n    ');
}

// Una sola sección de competencias: los grupos de `skills[]` van en una línea
// por categoría y lo que solo esté en `competencies[]` se añade como una línea
// plana separada por comas. Nada de etiquetas redondeadas ni categorías fijas.
function skillsHtml(categories, competencies = []) {
  const kept = list(categories).map((entry) => {
    // Un string suelto se trata como una categoría sin nombre.
    if (typeof entry === 'string') return { category: '', items: [entry] };
    return {
      category: str(pick(entry, 'category', 'categoria', 'name', 'nombre')),
      items: Array.isArray(pick(entry, 'items', 'skills', 'habilidades'))
        ? pick(entry, 'items', 'skills', 'habilidades')
        : [pick(entry, 'items', 'skills', 'habilidades')].filter(Boolean),
    };
  }).filter((c) => c.items.length > 0);

  const grouped = new Set(
    kept.flatMap((c) => list(c.items).map((item) => str(item).toLowerCase())),
  );
  const extra = list(competencies)
    .map((item) => str(item))
    .filter((item) => item && !grouped.has(item.toLowerCase()));

  const lines = kept.map((c) => {
    const cat = c.category ? `<strong class="skill-category">${escapeHtml(c.category)}:</strong> ` : '';
    return `    <div class="skill-item">${cat}${escapeHtml(list(c.items).join(', '))}</div>`;
  });
  if (extra.length) {
    lines.push(`    <div class="skill-item">${escapeHtml(extra.join(', '))}</div>`);
  }
  if (lines.length === 0) return '';
  return `<div class="skills-grid">\n${lines.join('\n')}\n  </div>`;
}

function normalize(payload) {
  const candidate = payload?.candidate ?? {};
  const at = (...keys) => pick(payload, ...keys) ?? pick(candidate, ...keys);
  const experience = list(at('experience', 'experiencia'));
  return {
    lang: str(at('lang', 'idioma') ?? 'es').slice(0, 5) || 'es',
    format: str(at('format', 'page_format', 'formato')),
    photo: str(at('photo', 'foto')),
    name: str(at('name', 'nombre')),
    title: str(at('title', 'headline', 'puesto_objetivo')),
    email: str(at('email', 'correo')),
    phone: str(at('phone', 'telefono', 'teléfono')),
    linkedin: str(at('linkedin')),
    github: str(at('github')),
    portfolio: str(at('portfolio', 'website', 'web')),
    links: normalizeLinks(at('links', 'enlaces')),
    location: str(at('location', 'ubicacion', 'ciudad')),
    summary: str(at('summary', 'resumen', 'perfil')),
    competencies: list(at('competencies', 'competencias')),
    experience,
    projects: list(at('projects', 'proyectos')),
    education: list(at('education', 'educacion', 'educación', 'formacion', 'formación')),
    certifications: list(at('certifications', 'certificaciones')),
    awards: list(at('awards', 'logros', 'premios')),
    skills: list(at('skills', 'habilidades')),
    interests: list(at('interests', 'intereses')),
  };
}

function validate(cv) {
  const problems = [];
  if (!cv.name) problems.push('falta `name` (nombre completo)');
  if (cv.experience.length === 0 && cv.education.length === 0) {
    problems.push('falta `experience` o `education`: un CV sin ninguna de las dos no es un CV');
  }
  cv.experience.forEach((entry, i) => {
    if (!pick(entry, 'company', 'empresa', 'org')) problems.push(`experience[${i}]: falta \`company\``);
    if (!pick(entry, 'role', 'title', 'puesto', 'cargo')) problems.push(`experience[${i}]: falta \`role\``);
  });
  return problems;
}

function render(cv) {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const titles = TITLES[cv.lang] ?? TITLES.es;

  const content = {
    SUMMARY_TEXT: escapeHtml(cv.summary),
    EXPERIENCE: experienceHtml(cv.experience),
    PROJECTS: projectsHtml(cv.projects),
    EDUCATION: educationHtml(cv.education),
    CERTIFICATIONS: certificationsHtml(cv.certifications, {
      item: 'cert-item', main: 'cert-main', title: 'cert-title', org: 'cert-org', year: 'cert-year',
    }),
    AWARDS: certificationsHtml(cv.awards, {
      item: 'award-item', main: 'award-main', title: 'award-title', org: 'award-org', year: 'award-year',
    }),
    INTERESTS: cv.interests.map((i, idx) => escapeHtml(idx === 0 ? i : i.charAt(0).toLowerCase() + i.slice(1))).join(', '),
    SKILLS: skillsHtml(cv.skills, cv.competencies),
  };

  const profileFormat = cv.format === 'a4' || cv.format === 'letter'
    ? cv.format
    : resolvePageFormat(undefined, { profilePath: getProfilePath(getCareerOpsRoot()) });

  const subs = {
    LANG: escapeHtml(cv.lang),
    PAGE_WIDTH: PAGE_WIDTHS[profileFormat],
    NAME: escapeHtml(cv.name),
    PHONE: escapeHtml(cv.phone),
    EMAIL: escapeHtml(cv.email),
    LOCATION: escapeHtml(cv.location),
    LINKEDIN_URL: escapeHtml(safeHref(absoluteUrl(cv.linkedin))),
    LINKEDIN_DISPLAY: escapeHtml(cv.linkedin ? displayUrl(cv.linkedin) : ''),
    GITHUB_URL: escapeHtml(safeHref(absoluteUrl(cv.github))),
    GITHUB_DISPLAY: escapeHtml(cv.github ? displayUrl(cv.github) : ''),
    PORTFOLIO_URL: escapeHtml(safeHref(absoluteUrl(cv.portfolio))),
    PORTFOLIO_DISPLAY: escapeHtml(cv.portfolio ? displayUrl(cv.portfolio) : ''),
    CONTACT_ROW: contactHtml(cv),
    SECTION_SUMMARY: escapeHtml(titles.summary),
    SECTION_EXPERIENCE: escapeHtml(titles.experience),
    SECTION_PROJECTS: escapeHtml(titles.projects),
    SECTION_EDUCATION: escapeHtml(titles.education),
    SECTION_CERTIFICATIONS: escapeHtml(titles.certifications),
    SECTION_AWARDS: escapeHtml(titles.awards),
    SECTION_INTERESTS: escapeHtml(titles.interests),
    SECTION_SKILLS: escapeHtml(titles.skills),
    PHOTO: '',
    CONSENT: '',
    ...content,
  };

  // TITLE_BLOCK vive en su propia línea: se reemplaza la línea entera para no
  // dejar una línea en blanco suelta cuando no hay titular.
  let html = template.split(/\r?\n/).map((line) => {
    if (line.includes('{{TITLE_BLOCK}}')) {
      const indent = line.match(/^\s*/)[0];
      return cv.title ? `${indent}<div class="header-title">${escapeHtml(cv.title)}</div>` : null;
    }
    return line;
  }).filter((line) => line !== null).join('\n');

  // Bloques de sección: se parten por su comentario marcador y se descarta el
  // bloque cuyo contenido quedó vacío.
  const parts = html.split(/(?=<!-- (?:PROFESSIONAL SUMMARY|WORK EXPERIENCE|PROJECTS|EDUCATION|COMPETENCIES \/ SKILLS|CERTIFICATIONS|AWARDS|INTERESTS) -->)/);
  html = parts.filter((part) => {
    const marker = part.match(/<!-- ([A-Z][A-Z /]+) -->/);
    if (!marker) return true;
    const key = SECTION_CONTENT[marker[1]];
    return !key || String(content[key] ?? '').trim() !== '';
  }).join('');

  // Un placeholder que nadie rellena se deja tal cual para que la comprobación
  // final lo detecte; blanquearlo lo volvería invisible.
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in subs ? subs[key] : match));
  html = html.replace(/\n[ \t]*<div class="cv-consent">[ \t]*<\/div>/g, '');
  // Un candidato sin teléfono, enlaces ni ciudad no tiene fila de contacto:
  // el contenedor vacío solo aportaría el hueco de su margen.
  html = html.replace(/\n[ \t]*<div class="contact-row">\s*<\/div>/g, '');

  const leftover = [...new Set(html.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
  if (leftover.length) {
    throw new Error(`placeholders sin resolver: ${leftover.join(', ')} — revisa templates/cv-template.html`);
  }
  return html;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`Uso:
  node build-cv.mjs <payload.yml> <salida.html>
  node build-cv.mjs <payload.yml> --check

Opciones:
  --check   valida el payload sin escribir HTML
  --help    muestra esta ayuda

Lee un payload YAML y rellena templates/cv-template.html.`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const check = args.includes('--check');
  const positional = args.filter((a) => !a.startsWith('--'));
  const payloadPath = positional[0];
  const outPath = positional[1];

  if (!payloadPath) {
    console.error('build-cv: falta el payload YAML. Ver `node build-cv.mjs --help`.');
    process.exit(1);
  }
  if (!existsSync(payloadPath)) {
    console.error(`build-cv: no existe ${payloadPath}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = loadYaml(readFileSync(payloadPath, 'utf8'));
  } catch (error) {
    console.error(`build-cv: YAML inválido en ${payloadPath}\n  ${error.message}`);
    console.error('  Revisa la indentación: cada bullet va con "- " en su propia línea.');
    process.exit(1);
  }
  if (!payload || typeof payload !== 'object') {
    console.error(`build-cv: ${payloadPath} está vacío o no es un objeto YAML.`);
    process.exit(1);
  }

  const cv = normalize(payload);
  const problems = validate(cv);
  if (problems.length) {
    console.error(`build-cv: payload incompleto en ${payloadPath}`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  let html;
  try {
    html = render(cv);
  } catch (error) {
    console.error(`build-cv: ${error.message}`);
    process.exit(1);
  }

  const bullets = cv.experience.reduce((sum, e) => sum + list(pick(e, 'bullets', 'logros') ?? []).length, 0);
  const skillLines = cv.skills.length + (cv.skills.length === 0 && cv.competencies.length ? 1 : 0);
  const summary = `${cv.experience.length} rol(es), ${bullets} bullet(s), ${skillLines} línea(s) de competencias`;

  if (check) {
    console.log(`✅ payload válido — ${summary}`);
    return;
  }
  if (!outPath) {
    console.error('build-cv: falta la ruta de salida HTML. Ver `node build-cv.mjs --help`.');
    process.exit(1);
  }

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, html, 'utf8');

  // verify-cv-structure.mjs compara el payload contra cv.md, no el HTML: se
  // emite al lado del HTML para que la validación sea un paso mecánico y no
  // dependa de que el agente reconstruya el JSON. Esquema:
  // { candidate, experience: [{company, role, dates, location, bullets}], ... }
  const structurePath = outPath.replace(/\.html?$/i, '') + '.payload.json';
  writeFileSync(structurePath, JSON.stringify({
    candidate: {
      name: cv.name, title: cv.title, email: cv.email, phone: cv.phone,
      linkedin: cv.linkedin, portfolio: cv.portfolio, location: cv.location,
    },
    lang: cv.lang,
    summary: cv.summary,
    competencies: cv.competencies,
    experience: cv.experience,
    projects: cv.projects,
    education: cv.education,
    certifications: cv.certifications,
    awards: cv.awards,
    skills: cv.skills,
    interests: cv.interests,
  }, null, 2), 'utf8');

  console.log(`✅ ${outPath} — ${summary}`);
  console.log(`   payload: ${structurePath}`);
}

main();
