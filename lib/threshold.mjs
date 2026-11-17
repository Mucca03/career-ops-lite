// Decisión determinista del umbral: ¿se genera el CV o no?
//
// El score lo pone el agente; esta función solo aplica `scoring` de
// config/profile.yml para que la respuesta no dependa de cómo interprete el
// modelo las reglas. No escribe ficheros, no llama a la red y no envía nada:
// devuelve qué hacer y el texto que el agente debe mostrar.
//
// Modos (`scoring.below_threshold`):
//   ask     — por defecto: bajo el umbral se ofrece el CV en una línea.
//   force   — se genera siempre, con aviso y estado `Forced`.
//   discard — se descarta (línea "Descartada — …"), salvo petición explícita.
//
// `scoring.min_score` (> 0) es un suelo duro: por debajo se pide confirmación
// UNA vez, incluso con `force` o petición explícita.

export const SCORING_DEFAULTS = Object.freeze({
  apply_threshold: 4.0,
  below_threshold: 'ask',
  min_score: 0,
});

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const oneDecimal = (value) => (Math.round(value * 10) / 10).toFixed(1);

export function normalizeScoring(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const threshold = num(source.apply_threshold ?? source.applyThreshold, SCORING_DEFAULTS.apply_threshold);
  const minScore = num(source.min_score ?? source.minScore, SCORING_DEFAULTS.min_score);
  const rawMode = String(source.below_threshold ?? source.belowThreshold ?? SCORING_DEFAULTS.below_threshold)
    .trim().toLowerCase();
  const mode = ['ask', 'force', 'discard'].includes(rawMode) ? rawMode : SCORING_DEFAULTS.below_threshold;
  return {
    apply_threshold: threshold,
    below_threshold: mode,
    // Un mínimo negativo no tiene sentido: se trata como "sin mínimo".
    min_score: minScore > 0 ? minScore : 0,
  };
}

const MESSAGES = {
  es: {
    offer: (x, y) => `Score ${x}/5, bajo el umbral ${y}. Di 'genera igual' si quieres el CV.`,
    discard: (x, company, position, gap) => `Descartada — ${company} · ${position}: score ${x}/5. Brecha principal: ${gap}.`,
    confirm: (x, z) => `Score ${x}/5 está por debajo de tu mínimo (${z}). ¿Confirmas?`,
    warning: (x, y, gaps) => `⚠ Score ${x}/5, por debajo del umbral ${y}. Generado a petición tuya. Brechas para la entrevista: ${gaps}`,
  },
  en: {
    offer: (x, y) => `Score ${x}/5, below the ${y} threshold. Say 'generate anyway' if you want the CV.`,
    discard: (x, company, position, gap) => `Discarded — ${company} · ${position}: score ${x}/5. Main gap: ${gap}.`,
    confirm: (x, z) => `Score ${x}/5 is below your minimum (${z}). Confirm?`,
    warning: (x, y, gaps) => `⚠ Score ${x}/5, below the ${y} threshold. Generated at your request. Interview gaps: ${gaps}`,
  },
  pt: {
    offer: (x, y) => `Score ${x}/5, abaixo do limite ${y}. Diga 'gerar mesmo assim' se quiser o CV.`,
    discard: (x, company, position, gap) => `Descartado — ${company} · ${position}: score ${x}/5. Lacuna principal: ${gap}.`,
    confirm: (x, z) => `Score ${x}/5 está abaixo do seu mínimo (${z}). Confirma?`,
    warning: (x, y, gaps) => `⚠ Score ${x}/5, abaixo do limite ${y}. Gerado a seu pedido. Lacunas para a entrevista: ${gaps}`,
  },
};

const messagesFor = (lang) => MESSAGES[String(lang ?? 'es').slice(0, 2)] ?? MESSAGES.es;

/**
 * Apply the threshold.
 *
 * @param {object} input
 * @param {number} input.score             Score 0–5 decidido por el agente.
 * @param {object} [input.scoring]         Bloque `scoring` de profile.yml.
 * @param {boolean} [input.requested]      El usuario pidió el CV ("genera igual").
 * @param {boolean} [input.confirmed]      Confirmó tras la pregunta de min_score.
 * @param {string} [input.lang]            language.output: es | en | pt.
 * @param {string} [input.company]         Para la línea de descarte.
 * @param {string} [input.position]        Para la línea de descarte.
 * @param {string} [input.gap]             Brecha principal del descarte.
 * @param {string} [input.gaps]            Lista de brechas para el aviso de B2.
 * @returns {{action:string, generate:boolean, tracker_status:string|null,
 *            message:string, warning:string|null, scoring:object}}
 */
export function decideThreshold({
  score,
  scoring = {},
  requested = false,
  confirmed = false,
  lang = 'es',
  company = '',
  position = '',
  gap = '—',
  gaps = '',
} = {}) {
  const settings = normalizeScoring(scoring);
  const value = num(score, 0);
  const x = oneDecimal(value);
  const y = oneDecimal(settings.apply_threshold);
  const z = oneDecimal(settings.min_score);
  const text = messagesFor(lang);

  const result = (action, generate, trackerStatus, message, warning = null) => ({
    action,
    generate,
    tracker_status: trackerStatus,
    message,
    warning,
    scoring: settings,
  });

  // Por encima del umbral no hay debate: se genera.
  if (value >= settings.apply_threshold) {
    return result('apply', true, 'Evaluated', '');
  }

  // Suelo duro: ni `force` ni una petición salvan de la confirmación.
  if (settings.min_score > 0 && value < settings.min_score) {
    if (!confirmed) return result('confirm', false, null, text.confirm(x, z));
    return result(
      'force',
      true,
      'Forced',
      '',
      text.warning(x, y, gaps || '—'),
    );
  }

  if (requested || settings.below_threshold === 'force') {
    return result(
      'force',
      true,
      'Forced',
      '',
      text.warning(x, y, gaps || '—'),
    );
  }

  if (settings.below_threshold === 'discard') {
    return result('discard', false, 'Discarded', text.discard(x, company, position, gap));
  }

  return result('offer', false, null, text.offer(x, y));
}
