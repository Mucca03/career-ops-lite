#!/usr/bin/env node
/**
 * extract-jd.mjs — extrae una oferta de empleo y la deja lista para evaluar.
 *
 * Uso:
 *   node extract-jd.mjs <url> [<url> ...]
 *   node extract-jd.mjs --file urls.txt        # una URL por línea
 *   node extract-jd.mjs --text                 # pega el texto y pulsa Ctrl-D
 *   node extract-jd.mjs <url> --no-save --max-chars 6000
 *   node extract-jd.mjs --help
 *
 * Salida: una línea JSON por oferta (NDJSON) con título, empresa, ubicación,
 * salario si aparece, y la descripción limpia recortada a `--max-chars`.
 * La oferta también se guarda en `jds/{fecha}_{empresa}_{puesto}.md`.
 *
 * Diseño:
 *   - Un solo camino de código: un navegador real (Playwright). Sin APIs por
 *     ATS, sin capas intermedias. Lo que un humano ve, lo ve el script.
 *   - Headless por defecto. Para portales que exigen sesión, define
 *     CAREER_OPS_BROWSER_PROFILE con el directorio de un perfil persistente:
 *     el inicio de sesión que hagas una vez queda guardado para las siguientes
 *     ejecuciones.
 *   - robots.txt se consulta antes de navegar y falla cerrado.
 *   - Si un portal bloquea (login, captcha, muro de autenticación), devuelve
 *     {"ok":false,"error":"blocked"} en vez de inventar contenido: el flujo pide
 *     que el usuario pegue el texto.
 *
 * Variables de entorno (ver .env.example):
 *   CAREER_OPS_BROWSER=chromium|firefox
 *   CAREER_OPS_BROWSER_PROFILE=<directorio del perfil>
 *   CAREER_OPS_HEADLESS=1|0
 *   CAREER_OPS_MAX_CHARS=8000
 *   CAREER_OPS_RESPECT_ROBOTS=1|0
 *   CAREER_OPS_USER_AGENT=<ua>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { browserLaunchOptions } from './lib/browser-launch.mjs';
import { localToday } from './lib/local-today.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = getCareerOpsRoot();
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* .env es opcional */ }

const CFG = {
  browser: (process.env.CAREER_OPS_BROWSER || 'chromium').toLowerCase(),
  profile: process.env.CAREER_OPS_BROWSER_PROFILE || '',
  headless: process.env.CAREER_OPS_HEADLESS !== '0',
  maxChars: Number(process.env.CAREER_OPS_MAX_CHARS) || 8000,
  jdDir: process.env.CAREER_OPS_JD_DIR || 'jds',
  respectRobots: process.env.CAREER_OPS_RESPECT_ROBOTS !== '0',
  userAgent: process.env.CAREER_OPS_USER_AGENT
    || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
};

const TIMEOUT_MS = 30_000;

// ── Pistas por portal ───────────────────────────────────────────────────────
// Selectores probados en orden; el primero con texto gana. `body` se resuelve
// además con una heurística genérica (el contenedor con más texto), así que un
// portal desconocido también funciona sin añadir código.
const SITE_HINTS = [
  {
    id: 'computrabajo',
    match: /(^|\.)computrabajo\./i,
    title: ['h1.fs24', 'div.box_offer h1', 'h1.title', 'h1'],
    company: ['a[offer-grid-article-company-url]', 'div.mbB a', 'p.mbB a', 'h2 a'],
    body: ['div[class*="boxDetail"]', 'div[class*="box_detail"]', 'div[class*="offerDetail"]', 'main'],
  },
  {
    id: 'magneto365',
    match: /magneto365\.com/i,
    title: ['h1'],
    company: ['[class*="company"]', 'h2', 'h3'],
    body: ['[class*="description"]', '[class*="detalle"]', '[class*="detail"]', 'main'],
  },
  {
    id: 'getonbrd',
    match: /getonbrd\.com/i,
    title: ['h1'],
    company: ['a[href*="/companies/"]', 'h2', '[class*="company"]'],
    body: ['[class*="job-details"]', '[class*="content"]', 'section', 'main'],
  },
  {
    id: 'torre',
    match: /torre\.(ai|co)/i,
    title: ['h1'],
    company: ['[class*="company"]', 'h2'],
    body: ['[class*="description"]', '[class*="opportunity"]', 'main'],
  },
  {
    id: 'elempleo',
    match: /elempleo\.com/i,
    title: ['h1'],
    company: ['[class*="company"]', '[class*="empresa"]', 'h2'],
    body: ['[class*="description"]', '[class*="detalle"]', 'main'],
  },
  {
    id: 'linkedin',
    match: /linkedin\.com/i,
    title: ['h1', '.top-card-layout__title', '.topcard__title'],
    company: ['a.topcard__org-name-link', '.topcard__org-name-link', '[class*="org-name"]'],
    body: ['.show-more-less-html__markup', '.description__text', '[class*="description__text"]'],
  },
  {
    id: 'indeed',
    match: /indeed\./i,
    title: ['h1', 'h2.jobsearch-JobInfoHeader-title'],
    company: ['[data-company-name]', '.jobsearch-InlineCompanyRating div', '[class*="companyName"]'],
    body: ['#jobDescriptionText', '.jobsearch-JobComponent-description'],
  },
  {
    id: 'glassdoor',
    match: /glassdoor\./i,
    title: ['h1'],
    company: ['[class*="employer"]', 'h4'],
    body: ['[class*="jobDescription"]', '#JobDescriptionContainer'],
  },
];

const BLOCKED_RE = /(inicia sesi[oó]n para (continuar|ver)|sign in to (continue|view)|authwall|captcha|verify you are human|verifica que eres humano|unusual traffic|acceso denegado|access denied)/i;

// Líneas de navegación, cookies y llamadas a la acción: ruido que no describe
// el puesto y que consume tokens.
const NOISE_RE = new RegExp('^(' + [
  'inicio', 'home', 'men[uú]', 'menu', 'buscar', 'buscar empleos', 'login', 'iniciar sesi[oó]n',
  'crear cuenta', 'registrarse', 'reg[ií]strate', 'postularme', 'postular', 'aplicar', 'apply',
  'apply now', 'easily apply', 'guardar', 'guardar oferta', 'compartir', 'share', 'imprimir',
  'reportar', 'denunciar', 'volver', 'back', 'siguiente', 'anterior', 'cookie', 'cookies',
  'aceptar', 'accept', 'pol[ií]tica de privacidad', 't[eé]rminos y condiciones', 'aviso legal',
  's[aá]lvese quien pueda', 'empleos similares', 'ofertas similares', 'related jobs',
  'similar jobs', 'ver m[aá]s', 'show more', 'leer m[aá]s', 'read more', 'todos los derechos',
].join('|') + ')(\\b.*)?$', 'i');

// ── utilidades ──────────────────────────────────────────────────────────────

const robotsCache = new Map();

const log = (...args) => console.error(...args);

function siteFor(url) {
  try {
    const host = new URL(url).hostname;
    const full = new URL(url).href;
    return SITE_HINTS.find((s) => s.match.test(host) || s.match.test(full)) ?? null;
  } catch {
    return null;
  }
}

function slugify(text, max = 48) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'oferta';
}

function today() {
  return localToday();
}

/** Limpia el texto extraído: sin líneas de ruido, sin duplicados, sin huecos. */
function cleanText(raw, { title = '', company = '' } = {}) {
  const seen = new Set();
  const drop = new Set([title.toLowerCase(), company.toLowerCase()].filter(Boolean));
  const lines = [];
  for (let line of String(raw ?? '').split('\n')) {
    line = line.replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
    if (!line) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    if (line.length < 2) continue;
    if (NOISE_RE.test(line)) continue;
    if (drop.has(line.toLowerCase())) continue;
    // Un menú lateral repite la misma línea decenas de veces; se conserva la
    // primera aparición y se descartan las siguientes.
    const key = line.toLowerCase();
    if (key.length > 3 && seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function findSalary(text) {
  const match = String(text).match(/(?:salario|sueldo|remuneraci[oó]n|salary|compensaci[oó]n)[^\n]{0,120}/i)
    || String(text).match(/(?:COP|USD|MXN|ARS|CLP|PEN)\s?\$?[\d.,]{4,}[^\n]{0,60}/i)
    || String(text).match(/\$\s?[\d.]{5,}[^\n]{0,60}/);
  return match ? match[0].trim().slice(0, 140) : null;
}

// ── robots.txt ──────────────────────────────────────────────────────────────

/**
 * true si robots.txt permite la ruta para el agente `career-ops`.
 * RFC 9309: grupo específico si existe, si no `*`; gana la coincidencia más
 * larga y, en empate, Allow. Falla cerrado ante un error de red.
 *
 * Se lee a través del contexto del navegador, no con fetch(): varios portales
 * (Computrabajo entre ellos) responden 403 a una petición suelta y 200 al mismo
 * fichero desde un navegador real, así que un fetch directo bloquearía sitios
 * que sí permiten el acceso.
 */
async function robotsAllows(context, url) {
  if (!CFG.respectRobots) return { allowed: true };
  let target;
  try { target = new URL(url); } catch { return { allowed: false, reason: 'URL inválida' }; }

  if (!robotsCache.has(target.origin)) {
    robotsCache.set(target.origin, (async () => {
      try {
        const res = await context.request.get(`${target.origin}/robots.txt`, {
          timeout: 10_000,
          headers: { 'user-agent': CFG.userAgent },
        });
        if (res.status() === 404) return '*';
        if (!res.ok()) return null;
        return await res.text();
      } catch {
        return null;
      }
    })());
  }
  const rules = await robotsCache.get(target.origin);
  if (rules == null) return { allowed: false, reason: 'robots.txt inaccesible' };
  if (rules === '*') return { allowed: true };

  const groups = [];
  let current = null;
  for (const rawLine of rules.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.closed) { current = { agents: [], rules: [], closed: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) continue;
      current.closed = true;
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }

  const group = groups.find((g) => g.agents.includes('career-ops'))
    ?? groups.find((g) => g.agents.includes('*'));
  if (!group || group.rules.length === 0) return { allowed: true };

  const path = target.pathname + (target.search || '');
  let best = null;
  for (const rule of group.rules) {
    const pattern = rule.path.replace(/\*/g, '.*').replace(/\$$/, '$');
    let hit = false;
    try { hit = new RegExp(`^${pattern}`).test(path); } catch { hit = path.startsWith(rule.path); }
    if (!hit) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best && !best.allow
    ? { allowed: false, reason: `robots.txt prohíbe ${path}` }
    : { allowed: true };
}

// ── extracción en la página ─────────────────────────────────────────────────

async function extractInPage(page, hints) {
  return page.evaluate((siteHints) => {
    const text = (el) => (el?.innerText || '').trim();
    const first = (selectors) => {
      for (const sel of selectors || []) {
        for (const el of document.querySelectorAll(sel)) {
          const value = text(el);
          if (value.length > 1) return value;
        }
      }
      return '';
    };

    // 1. schema.org JobPosting: la fuente más fiable cuando existe.
    let ld = null;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent);
        const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
        for (const node of nodes) {
          const type = node && node['@type'];
          const isPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
          if (isPosting) { ld = node; break; }
        }
      } catch { /* JSON-LD roto: se ignora */ }
      if (ld) break;
    }

    const ldTitle = ld?.title || ld?.name || '';
    const ldCompany = ld?.hiringOrganization?.name || '';
    const ldLocation = ld?.jobLocation?.address?.addressLocality
      || ld?.jobLocation?.address?.addressRegion
      || (typeof ld?.jobLocation === 'string' ? ld.jobLocation : '');
    const ldSalaryRaw = ld?.baseSalary;
    const salaryValue = ldSalaryRaw?.value;
    let ldSalary = '';
    if (salaryValue && typeof salaryValue === 'object') {
      const currency = ldSalaryRaw?.currency || salaryValue.currency || '';
      const amounts = [salaryValue.minValue ?? salaryValue.value, salaryValue.maxValue]
        .filter((v) => v != null && v !== '').join(' - ');
      ldSalary = `${amounts}${currency ? ` ${currency}` : ''}`.trim();
    } else if (salaryValue != null) {
      ldSalary = `${salaryValue}${ldSalaryRaw?.currency ? ` ${ldSalaryRaw.currency}` : ''}`.trim();
    }
    const ldText = ld?.description ? String(ld.description).replace(/<[^>]+>/g, '\n') : '';

    // 2. Contenedor del cuerpo: la pista del portal manda; si no, el elemento
    // con más texto que se comporte como un bloque de descripción.
    let body = '';
    for (const sel of siteHints?.body || []) {
      for (const el of document.querySelectorAll(sel)) {
        const value = text(el);
        if (value.length > body.length) body = value;
      }
      if (body.length > 600) break;
    }
    if (body.length < 600) {
      let best = '';
      const candidates = document.querySelectorAll('article, main, section, [class*="job"], [class*="desc"], [class*="detail"], [class*="content"]');
      for (const el of candidates) {
        if (el.querySelector('nav, header, footer, script')) continue;
        const value = text(el);
        // Un contenedor gana si aporta texto sustancial y no es un menú.
        if (value.length > best.length && value.split('\n').length >= 3) best = value;
      }
      if (best.length > body.length) body = best;
    }

    const title = ldTitle || first(siteHints?.title) || document.title || '';
    const company = ldCompany || first(siteHints?.company) || '';
    const location = ldLocation
      || text(document.querySelector('[class*="location"], [class*="ubicacion"], [class*="city"]'));

    return {
      title: String(title).trim(),
      company: String(company).trim(),
      location: String(location || '').trim().slice(0, 120),
      salary: String(ldSalary || '').trim(),
      ldText,
      body,
      pageTitle: document.title || '',
      hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
    };
  }, hints ? { body: hints.body, title: hints.title, company: hints.company } : null);
}

/** Un título que el portal publicó en minúsculas se presenta con mayúscula inicial. */
function prettyTitle(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  return /[A-ZÁÉÍÓÚÑ]/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function titleFromPageTitle(pageTitle) {
  return String(pageTitle || '')
    .replace(/\s*[|·]\s*(Computrabajo|Magneto365|LinkedIn|Indeed|Glassdoor|elempleo|GetOnBoard|Torre).*$/i, '')
    .replace(/^(Empleo de|Oferta de empleo de|Vacante|Job:)\s*/i, '')
    .replace(/\s*[-–]\s*[^-–]{2,60}$/u, '')
    .trim();
}

function companyFromPageTitle(pageTitle) {
  const parts = String(pageTitle || '').split(/\s+[|–-]\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : '';
}

// ── navegador ───────────────────────────────────────────────────────────────

async function openBrowser() {
  const { chromium, firefox } = await import('playwright');
  const engine = CFG.browser === 'firefox' ? firefox : chromium;
  const options = {
    headless: CFG.headless,
    userAgent: CFG.userAgent,
    viewport: { width: 1366, height: 900 },
    locale: 'es-CO',
    ...browserLaunchOptions({}),
  };

  if (CFG.profile) {
    // Perfil persistente: conserva cookies y sesión entre ejecuciones. Es la
    // vía para un portal que exige estar identificado.
    mkdirSync(CFG.profile, { recursive: true });
    const context = await engine.launchPersistentContext(CFG.profile, options);
    return { browser: context, context, close: () => context.close() };
  }
  const browser = await engine.launch(options);
  const context = await browser.newContext({ userAgent: CFG.userAgent, locale: 'es-CO' });
  return { browser, context, close: () => browser.close() };
}

async function extractUrl(context, url) {
  const hints = siteFor(url);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { /* nunca llega a idle */ }
    // Cuerpos con carga diferida: un scroll y una pausa corta suelen bastar.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(700);

    const raw = await extractInPage(page, hints);
    const body = cleanText(raw.ldText || raw.body, {
      title: raw.title, company: raw.company,
    });

    if (raw.hasPasswordField && body.length < 800) {
      return { ok: false, url, source: hints?.id ?? 'generic', error: 'blocked', detail: 'pide iniciar sesión' };
    }
    if (body.length < 300 || BLOCKED_RE.test(body.slice(0, 2000))) {
      return {
        ok: false, url, source: hints?.id ?? 'generic', error: 'blocked',
        detail: body.length < 300 ? 'sin contenido útil (portal dinámico o muro)' : 'pantalla de acceso/captcha',
      };
    }

    let title = prettyTitle(raw.title || titleFromPageTitle(raw.pageTitle));
    // "Puesto - Empresa | Portal" es el patrón más común de <title>.
    let company = raw.company || companyFromPageTitle(raw.pageTitle);
    if (title.includes(' - ') && !company) {
      const [first, ...rest] = title.split(/\s+[-–]\s+/);
      title = first.trim();
      company = rest.join(' - ').trim();
    }

    return {
      ok: true,
      url,
      source: hints?.id ?? 'generic',
      title: title.slice(0, 200),
      company: company.slice(0, 120) || new URL(url).hostname,
      location: raw.location,
      salary: findSalary(body) || raw.salary || null,
      chars: body.length,
      text: body.length > CFG.maxChars ? body.slice(0, CFG.maxChars) + '\n[…recortado]' : body,
    };
  } catch (error) {
    return { ok: false, url, source: hints?.id ?? 'generic', error: 'fetch-failed', detail: String(error?.message || error).slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
  }
}

// ── persistencia ────────────────────────────────────────────────────────────

function saveOffer(offer) {
  if (!offer.ok) return null;
  const dir = resolve(ROOT, CFG.jdDir);
  mkdirSync(dir, { recursive: true });
  const base = `${today()}_${slugify(offer.company, 24)}_${slugify(offer.title, 40)}`;
  let file = join(dir, `${base}.md`);
  let n = 2;
  while (existsSync(file)) file = join(dir, `${base}-${n++}.md`);

  const front = [
    '---',
    `title: ${JSON.stringify(offer.title)}`,
    `company: ${JSON.stringify(offer.company)}`,
    `location: ${JSON.stringify(offer.location || '')}`,
    `salary: ${JSON.stringify(offer.salary || '')}`,
    `url: ${offer.url}`,
    `source: ${offer.source}`,
    `fetched_at: ${today()}`,
    '---',
    '',
    `# ${offer.title} — ${offer.company}`,
    '',
  ].join('\n');

  writeFileSync(file, front + offer.text + '\n', 'utf8');
  return file;
}

// ── entrada ─────────────────────────────────────────────────────────────────

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function parseArgs(argv) {
  const opts = { urls: [], file: null, text: null, save: true, maxChars: CFG.maxChars, title: '', company: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--no-save') opts.save = false;
    else if (arg === '--text') opts.text = true;
    else if (arg === '--file') opts.file = argv[++i];
    else if (arg.startsWith('--file=')) opts.file = arg.slice(7);
    else if (arg === '--max-chars') opts.maxChars = Number(argv[++i]) || CFG.maxChars;
    else if (arg.startsWith('--max-chars=')) opts.maxChars = Number(arg.slice(12)) || CFG.maxChars;
    else if (arg === '--title') opts.title = argv[++i] || '';
    else if (arg === '--company') opts.company = argv[++i] || '';
    else if (arg === '--browser') CFG.browser = (argv[++i] || 'chromium').toLowerCase();
    else if (!arg.startsWith('--')) opts.urls.push(arg);
  }
  return opts;
}

const HELP = `Uso:
  node extract-jd.mjs <url> [<url> ...]
  node extract-jd.mjs --file urls.txt
  node extract-jd.mjs --text [--title "Puesto"] [--company "Empresa"]
  node extract-jd.mjs --help

Opciones:
  --file <ruta>       lee URLs de un fichero, una por línea
  --text              lee la oferta pegada por stdin
  --max-chars <n>     recorta la descripción (por defecto 8000)
  --no-save           no escribe en jds/
  --browser <nombre>  chromium (por defecto) o firefox
  --title/--company   solo con --text: datos del encabezado

Salida: una línea JSON por oferta. Guarda también jds/{fecha}_{empresa}_{puesto}.md`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  CFG.maxChars = opts.maxChars;

  const output = (record) => process.stdout.write(JSON.stringify(record) + '\n');

  // Modo texto pegado: sin red, sin navegador.
  if (opts.text) {
    const text = cleanText(await readStdin(), {});
    if (text.length < 200) {
      output({ ok: false, error: 'text-too-short', detail: 'pega al menos unas líneas de la oferta' });
      process.exitCode = 1;
      return;
    }
    const title = opts.title || text.split('\n')[0].slice(0, 120);
    const record = {
      ok: true, url: '', source: 'pasted', title, company: opts.company || '',
      location: '', salary: findSalary(text),
      chars: text.length,
      text: text.length > CFG.maxChars ? text.slice(0, CFG.maxChars) + '\n[…recortado]' : text,
    };
    if (opts.save) record.saved = saveOffer(record);
    output(record);
    return;
  }

  let urls = [...opts.urls];
  if (opts.file) {
    if (!existsSync(opts.file)) {
      output({ ok: false, error: 'file-not-found', detail: opts.file });
      process.exitCode = 1;
      return;
    }
    urls.push(...readFileSync(opts.file, 'utf8')
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  }
  if (urls.length === 0) {
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  let handle;
  try {
    handle = await openBrowser();
  } catch (error) {
    output({ ok: false, error: 'browser-launch-failed', detail: String(error?.message || error).slice(0, 300) });
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  try {
    // robots.txt se lee desde el propio navegador, antes de cada URL.
    const targets = [];
    for (const url of urls) {
      const verdict = await robotsAllows(handle.context, url);
      if (verdict.allowed) targets.push(url);
      else { failures += 1; output({ ok: false, url, error: 'robots-disallowed', detail: verdict.reason }); }
    }

    for (const url of targets) {
      log(`→ ${url}`);
      const offer = await extractUrl(handle.context, url);
      if (offer.ok && opts.save) offer.saved = saveOffer(offer);
      if (!offer.ok) failures += 1;
      output(offer);
    }
  } finally {
    await handle.close().catch(() => {});
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`extract-jd: ${error?.message || error}`);
  process.exitCode = 1;
});
