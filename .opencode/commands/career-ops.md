---
name: career-ops
description: career-ops-lite — evalúa una oferta (URL o texto) y genera un CV de 1 página si el match es ≥ 4.0/5
---

# career-ops

$ARGUMENTS

Sigue `AGENTS.md` al pie de la letra. Es el flujo completo:

0. Si falta `cv.md` o `config/profile.yml`, haz el onboarding corto (Paso 0).
1. Extrae la oferta con `node extract-jd.mjs` (o `--text` si la pegas).
2. Puntúa de 0 a 5 con el bloque de salida fijo del Paso 2.
3. Score ≥ `scoring.apply_threshold` → `build-cv.mjs` → `verify-cv-structure.mjs`
   → `generate-pdf.mjs --max-pages=1 --strict-pages`.
   Score menor → descarte en dos líneas, sin PDF.
4. Añade una línea al final de `data/applications.md`.
