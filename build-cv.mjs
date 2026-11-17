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
    summary: 'Professional Summary', competencies: 'Core Competencies',
    experience: 'Work Experience', projects: 'Projects', education: 'Education',
    certifications: 'Certifications', awards: 'Awards & Honors',
    interests: 'Interests', skills: 'Skills',
  },
  es: {
    summary: 'Perfil Profesional', competencies: 'Competencias Clave',
    experience: 'Experiencia Laboral', projects: 'Proyectos', education: 'Educación',
    certifications: 'Certificaciones', awards: 'Logros y Reconocimientos',
    interests: 'Intereses', skills: 'Habilidades',
  },
  pt: {
    summary: 'Resumo Profissional', competencies: 'Competências',
    experience: 'Experiência Profissional', projects: 'Projetos', education: 'Formação',
    certifications: 'Certificações', awards: 'Prêmios', interests: 'Interesses',
    skills: 'Habilidades',
  },
};

// Marcador del comentario HTML → placeholder que llena su sección. Si ese
// placeholder queda vacío, el bloque entero (comentario + <div class="section">)
// se elimina del documento.
const SECTION_CONTENT = {
  'PROFESSIONAL SUMMARY': 'SUMMARY_TEXT',
  'CORE COMPETENCIES': 'COMPETENCIES',
  'WORK EXPERIENCE': 'EXPERIENCE',
  PROJECTS: 'PROJECTS',
  EDUCATION: 'EDUCATION',
  CERTIFICATIONS: 'CERTIFICATIONS',
  AWARDS: 'AWARDS',
  INTERESTS: 'INTERESTS',
  SKILLS: 'SKILLS',
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
    const description = escapeHtml(
      pick(entry, 'description', 'descripcion')
      ?? list(pick(entry, 'bullets', 'logros') ?? []).join(' '),
    );
    const tech = escapeHtml(pick(entry, 'tech', 'tecnologias', 'stack') ?? '');
    const title = url
      ? `<a href="${escapeHtml(url)}">${name}</a>`
      : name;
    return `<div class="project">
    <div class="project-title">${title}</div>${description ? `\n    <div class="project-desc">${description}</div>` : ''}${tech ? `\n    <div class="project-tech">${tech}</div>` : ''}
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

function certificationsHtml(entries, orgClass, yearClass, itemClass, titleClass) {
  return list(entries).map((entry) => {
    const title = escapeHtml(pick(entry, 'title', 'name', 'nombre') ?? '');
    const org = escapeHtml(pick(entry, 'org', 'issuer', 'entidad') ?? '');
    const year = escapeHtml(pick(entry, 'year', 'date', 'fecha', 'anio', 'año') ?? '');
    return `<div class="${itemClass}">
      <span class="${titleClass}">${title}</span>
      <span class="${orgClass}">${org}</span>
      <span class="${yearClass}">${year}</span>
    </div>`;
  }).join('\n    ');
}

function skillsHtml(categories) {
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
  if (kept.length === 0) return '';
  const items = kept.map((c) => {
    const cat = c.category ? `<span class="skill-category">${escapeHtml(c.category)}:</span> ` : '';
    return `    <div class="skill-item">${cat}${escapeHtml(list(c.items).join(', '))}</div>`;
  }).join('\n');
  return `<div class="skills-grid">\n${items}\n  </div>`;
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
    portfolio: str(at('portfolio', 'website', 'web', 'github')),
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
    COMPETENCIES: cv.competencies.map((c) => `<span class="competency-tag">${escapeHtml(c)}</span>`).join('\n      '),
    EXPERIENCE: experienceHtml(cv.experience),
    PROJECTS: projectsHtml(cv.projects),
    EDUCATION: educationHtml(cv.education),
    CERTIFICATIONS: certificationsHtml(cv.certifications, 'cert-org', 'cert-year', 'cert-item', 'cert-title'),
    AWARDS: certificationsHtml(cv.awards, 'award-org', 'award-year', 'award-item', 'award-title'),
    INTERESTS: cv.interests.map((i, idx) => escapeHtml(idx === 0 ? i : i.charAt(0).toLowerCase() + i.slice(1))).join(', '),
    SKILLS: skillsHtml(cv.skills),
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
    LINKEDIN_URL: escapeHtml(cv.linkedin ? (/^https?:/.test(cv.linkedin) ? cv.linkedin : `https://${cv.linkedin}`) : ''),
    LINKEDIN_DISPLAY: escapeHtml(cv.linkedin.replace(/^https?:\/\//, '')),
    PORTFOLIO_URL: escapeHtml(cv.portfolio ? (/^https?:/.test(cv.portfolio) ? cv.portfolio : `https://${cv.portfolio}`) : ''),
    PORTFOLIO_DISPLAY: escapeHtml(cv.portfolio.replace(/^https?:\/\//, '')),
    SECTION_SUMMARY: escapeHtml(titles.summary),
    SECTION_COMPETENCIES: escapeHtml(titles.competencies),
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
  const parts = html.split(/(?=<!-- (?:PROFESSIONAL SUMMARY|CORE COMPETENCIES|WORK EXPERIENCE|PROJECTS|EDUCATION|CERTIFICATIONS|AWARDS|INTERESTS|SKILLS) -->)/);
  html = parts.filter((part) => {
    const marker = part.match(/<!-- ([A-Z][A-Z ]+) -->/);
    if (!marker) return true;
    const key = SECTION_CONTENT[marker[1]];
    return !key || String(content[key] ?? '').trim() !== '';
  }).join('');

  // Un placeholder que nadie rellena se deja tal cual para que la comprobación
  // final lo detecte; blanquearlo lo volvería invisible.
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in subs ? subs[key] : match));
  html = html.replace(/\n[ \t]*<div class="cv-consent">[ \t]*<\/div>/g, '');

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
  const summary = `${cv.experience.length} rol(es), ${bullets} bullet(s), ${cv.competencies.length} competencia(s)`;

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
