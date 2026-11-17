---
name: career-ops
description: career-ops-lite — evalúa una oferta (URL o texto) y genera un CV de 1 página si el match alcanza el umbral
---

# career-ops

$ARGUMENTS

Sigue `AGENTS.md` al pie de la letra. Es el flujo completo:

0. Si falta `cv.md` o `config/profile.yml`, haz el onboarding del Paso 0
   (CV, links, etapa, graduación, ciudad y modalidad, salario, idioma).
1. Extrae la oferta con `node extract-jd.mjs` (o `--text` si la pegas).
2. Puntúa de 0 a 5 con el bloque de salida fijo del Paso 2.
3. Score ≥ `scoring.apply_threshold` → `build-cv.mjs` → `validate-extra.mjs`
   → `verify-cv-structure.mjs` (solo si hay experiencia)
   → `generate-pdf.mjs --max-pages=1 --strict-pages`.
   Score menor → descarte en dos líneas, sin PDF.
4. Añade una línea al final de `data/applications.md`.
