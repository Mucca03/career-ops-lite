#!/usr/bin/env node
/**
 * threshold.mjs — aplica `scoring` de config/profile.yml al score de una oferta.
 *
 * Uso:
 *   node threshold.mjs --score 3.2 [--requested] [--confirmed]
 *   node threshold.mjs --score 3.2 --json
 *   node threshold.mjs --score 3.2 --company "Empresa" --position "Puesto"
 *   node threshold.mjs --score 2.4 --gaps "requisito: X; valorado: Y"
 *
 * `--requested` = el usuario pidió el CV ("genera igual", "fuerza", --force).
 * `--confirmed` = ya respondió que sí a la pregunta de `min_score`.
 *
 * Salida legible por máquina con --json; si no, tres líneas fijas:
 *   decision=offer generate=false tracker=none
 *   <mensaje que el agente debe mostrar>
 *
 * No escribe ficheros, no envía nada y no genera PDF: solo decide.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { decideThreshold } from './lib/threshold.mjs';

const HELP = `Uso:
  node threshold.mjs --score X.X [opciones]

Opciones:
  --score <n>         score 0–5 (obligatorio)
  --requested         el usuario pidió el CV aunque no llegue al umbral
  --confirmed         confirmó la pregunta de min_score
  --lang <es|en|pt>   idioma del mensaje (por defecto, language.output)
  --company <texto>   para la línea de descarte
  --position <texto>  para la línea de descarte
  --gap <texto>       brecha principal del descarte
  --gaps <texto>      brechas para el aviso al generar bajo el umbral
  --root <dir>        raíz del proyecto
  --profile <ruta>    profile.yml alternativo
  --json              salida legible por máquina
  --help

Lee solo el bloque \`scoring\` de profile.yml.`;

function parseArgs(argv) {
  const opts = { requested: false, confirmed: false, json: false };
  const flags = new Set(['--requested', '--confirmed', '--json']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (flags.has(arg)) opts[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      opts[key] = inline !== undefined ? inline : argv[++i];
    }
  }
  return opts;
}

function readScoring(opts) {
  const root = resolve(opts.root || getCareerOpsRoot());
  const profilePath = opts.profile ? resolve(opts.profile) : getProfilePath(root);
  if (!existsSync(profilePath)) return { root, scoring: {}, lang: 'es' };
  const raw = loadYaml(readFileSync(profilePath, 'utf8')) ?? {};
  return {
    root,
    scoring: raw.scoring ?? {},
    lang: raw.language?.output,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.help || argv.length === 0) {
    console.log(HELP);
    process.exit(argv.length ? 0 : 1);
  }
  if (opts.score === undefined || Number.isNaN(Number(opts.score))) {
    console.error('threshold: falta --score o no es un número.');
    process.exit(1);
  }

  const { scoring, lang } = readScoring(opts);
  const decision = decideThreshold({
    score: Number(opts.score),
    scoring,
    requested: opts.requested,
    confirmed: opts.confirmed,
    lang: opts.lang || lang || 'es',
    company: opts.company || '',
    position: opts.position || '',
    gap: opts.gap || '—',
    gaps: opts.gaps || '',
  });

  if (opts.json) {
    console.log(JSON.stringify({
      score: Number(opts.score),
      ...decision,
    }, null, 2));
    return;
  }

  console.log(`decision=${decision.action} generate=${decision.generate} tracker=${decision.tracker_status ?? 'none'}`);
  if (decision.message) console.log(decision.message);
  if (decision.warning) console.log(decision.warning);
}

main();
