# career-ops-lite

Asistente de empleo para **Colombia y LATAM remoto**. Flujo lineal:
**extraer → evaluar → (CV de 1 página | ofrecer | descartar)**.

No inventes nada. Todo dato del candidato sale de `cv.md` y `config/profile.yml`.
Lo que la oferta pida y esos ficheros no prueben es una **brecha**, nunca un hueco
que rellenar. `AGENTS.md` no conoce a ningún candidato: sirve para todos.

---

## Paso 0 — Arranque

Lee `config/profile.yml` y comprueba si existe `cv.md`. Si existen los dos → Paso 1.

Si falta alguno → onboarding, en **un solo mensaje** pide:

1. CV (texto pegado o ruta del fichero).
2. Links que tenga: GitHub, portafolio, LinkedIn.
3. Etapa: estudiante | junior | con experiencia.
4. Si estudia: fecha esperada de graduación.
5. Ciudad y modalidad (remoto/híbrido/presencial).
6. Expectativa salarial + moneda.
7. Idioma de salida (`es`/`en`/`pt`).

```bash
cp cv.example.md cv.md                              # solo si falta cv.md
cp config/profile.example.yml config/profile.yml    # solo si falta profile.yml
cp portals.example.yml portals.yml                  # opcional (escáner)
cp templates/applications.example.md data/applications.md   # solo si falta
```

- `cv.md`: el CV **tal cual lo dio** — mismas empresas, fechas, títulos y logros.
  Respeta las cabeceras (`## Experience`, `### Empresa — Ciudad`, `**Título**`,
  línea de fechas).
- `profile.yml`: rellena `candidate` (incluidos `github`, `portfolio`, `links[]`,
  `stage`, `graduation`), `job_search`, `language`, `cv.mode: auto`.
- **Umbral:** si `stage` es *con experiencia* deja `scoring.apply_threshold: 4.0`;
  si es *estudiante* o *junior*, pon `3.5`. Explícalo en una línea: se calibra
  mirando el tracker (lo que llegó a entrevista vs. lo aplicado). Es configurable.
- En `scoring` deja también `below_threshold: ask` (bajo el umbral se ofrece el
  CV; `force` lo genera siempre y `discard` lo descarta) y `min_score: 0` (si lo
  subes, un score por debajo pide confirmación una vez).

Confirma en 3 líneas y sigue.

---

## Paso 1 — Obtener la oferta

```bash
node extract-jd.mjs <url> [<url> ...]
node extract-jd.mjs --file urls.txt
node extract-jd.mjs --text          # el usuario pega la oferta y pulsa Ctrl-D
```

Devuelve una línea JSON por oferta: `title`, `company`, `salary`, `text`, `saved`.

- `{"ok":false,"error":"blocked"}` → pide que pegue el texto y usa `--text`.
  **No reintentes por otra vía.**
- Si `jds/` ya la tiene, reutilízala.
- Varias ofertas → una evaluación cada una.

Puntúa contra `job_search.target_roles`, `modality`, `city` y `salary_target`.

---

## Paso 2 — Evaluar

Responde **solo** este bloque, máximo 150 palabras.

```
## {Empresa} · {Puesto}
Score: X.X/5 — APLICA | DESCARTAR
Ubicación: {ciudad} | Modalidad: {remoto/híbrido/presencial} | Salario: {rango o "no publicado"}
Ajustes: 1) … 2) … 3) …
Brechas: 1) … 2) … 3) …
Veredicto: una línea.
```

| Score | Criterio |
|---|---|
| 5.0 | ≥90% de requisitos centrales; salario, ubicación y modalidad ideales |
| 4.0–4.9 | Requisitos centrales cubiertos; brechas menores y subsanables |
| 3.0–3.9 | Brecha importante: seniority, stack, idioma o modalidad incompatible |
| < 3.0 | No es el perfil |

**Ajustes** = lo que `cv.md` demuestra y la oferta pide. **Brechas** = lo que la
oferta pide y `cv.md` no prueba; no las maquilles.

**Corte:** score >= `scoring.apply_threshold` → 3A. Si no, manda
`scoring.below_threshold`: `ask` → 3B (ofrece el CV en una línea), `force` → 3A
con aviso, `discard` → 3B (descarte). Con `scoring.min_score > 0` y un score por
debajo, pregunta una vez antes de generar. `node threshold.mjs --score X.X`
aplica estas reglas sin interpretación.

---

## Paso 3A — Score ≥ umbral → CV de una página

### 3A.0 Modo del CV

Decídelo leyendo `cv.md`, nunca por el nombre del candidato:

| Modo | Cuándo |
|---|---|
| `experienced` | hay al menos un rol con **empresa y fechas** |
| `entry` | ninguno; solo proyectos, open source o trabajo académico |
| `mixed` | hay roles reales **y** además proyectos |

`cv.mode` en `profile.yml` lo fuerza (`auto` = deducirlo).

- Un rol va en `experience` **solo** si `cv.md` lo lista como experiencia con
  empresa y fechas. Nunca conviertas proyecto, open source, curso o trabajo
  académico en rol; nunca inventes cargo ni ubicación.
- `entry`: `experience: []`. Secciones: `projects` (incluye open source),
  `education`, `certifications`.
- `experienced`: `experience` primero; `projects` después, opcional.
- `mixed`: `experience` primero, `projects` después.
- Los títulos de sección salen de `lang`: es "Proyectos", en "Projects",
  pt "Projetos". Nunca "Experiencia laboral" para proyectos.

**Orden (estructura ATS).** El CV va siempre en este orden vertical; cada
sección desaparece si no tiene datos:

1. Encabezado: nombre, titular y contacto inline.
2. Resumen / Perfil Profesional.
3. Experiencia y/o Proyectos: con experiencia, Experiencia primero y Proyectos
   debajo; sin experiencia formal (`entry`), Proyectos va justo después del
   resumen.
4. Educación: título e institución a la izquierda, fecha a la derecha.
5. Competencias / Habilidades: una sola sección, texto plano.
6. Certificaciones / Logros: una fila por ítem, año a la derecha.

**Estilo:** monocromático (texto `#111111`, reglas `#222`); la jerarquía sale
del peso, el tamaño, las mayúsculas y los bordes finos, nunca del color. Sin
badges, "pills" ni fondos tintados.

**Relevancia:** dentro de cada sección, primero el ítem que más coincida con los
requisitos centrales de la oferta (stack, dominio, herramientas); empate → el más
reciente.

**Trazabilidad (A1).** Una herramienta, método, práctica o certificación solo
puede aparecer en un ítem (`experience[]` o `projects[]`) si `cv.md` se la
atribuye a ESE ítem. Que exista en otro ítem o en la oferta no basta. Si la IA
la infiere, no la escribe: va como brecha o `[VERIFICAR]`.

**Redacción (A2).** Cuando un requisito de la oferta describe algo que `cv.md`
ya demuestra en ese ítem, puedes usar su redacción literal para el ATS. Si el
ítem no lo respalda, no la uses. Si `cv.md` usa la variante corta o larga de un
término que la oferta pide (siglas, nombre completo o sinónimo directo), puedes
usar la de la oferta. Escribe en `lang` con el término establecido, sin calcar
del inglés.

**Encabezado:** todos los links de `profile.yml` que existan (github, portfolio,
linkedin, links[]); omite los ausentes. `build-cv.mjs` no deja separadores vacíos.

**Competencias:** una sola sección en todo el CV. Con `skills[]` se pinta
`Categoría: ítem 1, ítem 2` (una línea por categoría, máximo 4, categorías
dinámicas según el perfil y la oferta); `competencies[]` plano va como lista
separada por comas y nunca como una segunda sección. Solo tecnologías que
aparezcan en un bullet o en el stack de un ítem **incluido** en este CV. Lo que
la oferta pida y no esté respaldado es brecha.

**Certificaciones:** hasta 3 relevantes, si están en `cv.md`. No las recortes
antes que proyectos poco relevantes.

### 3A.1 Payload YAML

Copia la forma del modo que toque. Campos exactos que acepta `build-cv.mjs`:
`name`, `title`, `email`, `phone`, `location`, `linkedin`, `github`, `portfolio`,
`links[]`, `summary`, `competencies[]`, `experience[]`, `projects[]`,
`education[]`, `certifications[]`, `skills[]`.

```yaml
lang: es
name: Nombre Apellido
title: Puesto Objetivo
email: tu@email.com
github: github.com/tu-usuario
linkedin: linkedin.com/in/tu-usuario
location: Ciudad, País
summary: >
  Dos líneas: años de experiencia, dominio y el logro que la oferta pide.
competencies: [Herramienta A, Método B, Certificación C]
skills:
  - category: Categoría 1      # nombre en `lang`; sale de cv.md o del área
    items: [Herramienta A, Herramienta B]
  - category: Categoría 2
    items: [Método C]
experience:
  - company: Empresa Ejemplo
    role: Puesto Ejemplo
    dates: 2022 — Presente
    bullets:            # cada bullet sale de cv.md, con su cifra real si la hay
      - "Logro concreto: qué hice, con qué y qué cambió (cifra real)."
  - company: Empresa Anterior
    role: Puesto Anterior
    dates: 2020 — 2022
    bullets:
      - "Otro logro, con su cifra y alcance reales."
education:
  - title: Título del estudio
    org: Institución
    year: "2020"
```

```yaml
lang: es
name: Nombre Apellido
title: Puesto Objetivo Junior
email: tu@email.com
github: github.com/tu-usuario
location: Ciudad, País
summary: >
  Dos líneas: formación, dominio y el logro que la oferta pide.
competencies: [Herramienta A, Método B]
skills:
  - category: Categoría 1
    items: [Herramienta A, Herramienta B]
experience: []
projects:
  - name: Proyecto Uno
    url: github.com/tu-usuario/uno
    dates: 2025 – Presente
    description: Qué hace y qué problema resuelve (una frase).
    bullets:            # opcional: varios logros con sus cifras
      - "Logro del proyecto, con su cifra real."
    tech: Herramienta A, Herramienta B
education:
  - title: Título del estudio (semestre o año)
    org: Institución
    year: "2026"
certifications:
  - title: Certificación Ejemplo
    org: Entidad
    year: "2025"
```

- Máximo `cv.max_experiences` roles y `cv.max_projects` proyectos, con
  `cv.bullets_per_role` bullets cada uno. Perfil junior: usa lo que haya, sin
  rellenar con ítems irrelevantes.
- Cada bullet sigue el patrón "logro + acción" de `cv.md` y conserva sus cifras,
  volúmenes, alcance y detalles concretos (A3). No reduzcas un ítem fuerte a una
  línea genérica; en el más relevante, pon primero sus 2–3 logros más
  verificables.
- En `projects[]` usa `bullets: []` para varios logros y `description` para una
  sola frase. `tech` va en su línea y no se repite dentro de los bullets; los
  payloads antiguos con solo `description` siguen valiendo (A4).
- `skills[]` agrupa por categorías que salgan de `cv.md` o que deduzcas del área
  y de la oferta: no hay categorías predefinidas. Máximo 4 líneas, categoría en
  `lang`, y solo competencias respaldadas por un ítem incluido (A5).
  `competencies[]` es la alternativa plana para perfiles que no agrupan: se
  pinta como una lista separada por comas dentro de la misma sección, no como
  etiquetas ni como otra sección.
- Contribuciones externas (open source, voluntariado, publicaciones, ponencias,
  trabajo pro bono) van en su sección natural con `url` y su estado real
  ("mergeado", "publicado"). Describe su tamaño real: una contribución es una
  contribución, no "contribuciones" (A6).
- Cada ítem lleva `url` si `cv.md` la tiene. Lo que sigue en curso lleva
  "Presente" (o su equivalente en `lang`), no solo el año de inicio, con el
  mismo formato de fechas en todo el CV (A7).
- Si dudas de que un dato esté respaldado, no lo pongas en el YAML: repórtalo en
  el chat como `[VERIFICAR] …` con el ítem afectado. `[VERIFICAR]` nunca aparece
  en el CV, HTML ni PDF (A8).
- Cada bullet sale de `cv.md`. Reformula para el puesto; nunca inventes métricas,
  herramientas ni empresas. Cita los valores con `"…"` si llevan `#` o `:`.
- Omite `awards` e `interests` salvo que la oferta los pida.
- Sin tabulaciones, dos espacios por nivel.

Guarda en `data/cv-{empresa-slug}.yml`.

### 3A.2 Genera, valida y renderiza

```bash
node build-cv.mjs data/cv-{empresa-slug}.yml output/cv-{empresa-slug}.html
node validate-extra.mjs data/cv-{empresa-slug}.yml "jds/{oferta}.md"
node verify-cv-structure.mjs output/cv-{empresa-slug}.payload.json   # solo si experience != []
node generate-pdf.mjs output/cv-{empresa-slug}.html output/cv-{empresa-slug}.pdf \
  --format=letter --max-pages=1 --strict-pages --skip-fact-check
```

- `build-cv.mjs` escribe el HTML **y** el `.payload.json`. Falla por YAML inválido
  o campo obligatorio ausente: corrige el YAML, nunca el HTML.
- `validate-extra.mjs` comprueba sin LLM: links de `profile.yml` presentes,
  `entry` con `experience` vacío, proyectos sin cargo/empresa/ubicación,
  competencias y `skills[]` respaldadas, trazabilidad por ítem (`tech`,
  competencias y nombres propios en el MISMO ítem de `cv.md`), cifras en ese
  ítem, ausencia de `[VERIFICAR]`, "Presente" en lo que sigue en curso, orden
  por relevancia y certificaciones relevantes incluidas. Si falla, corrige el
  YAML y repite (máx. 2). Nunca edites el HTML.
- `--skip-fact-check` solo si `language.output` != `en`: el gate de redacción
  cubre solo inglés y avisa de que no comprobó nada. Con `en`, quítalo.
- `verify-cv-structure.mjs`: `✅` esperado; `UNVERIFIED` = las empresas del
  payload no casan con `cv.md`, revísalo a mano y sigue.
- **Recorte si desborda** (máx. 2 reintentos): (1) ítems menos relevantes —
  nunca los 2 más relevantes; (2) competencias a 6; (3) 1 bullet en el ítem más
  débil. Nunca quitar: links del encabezado, educación, certificaciones relevantes.
- Nada de `--allow-reorder` ni `--allow-nonchronological`.

Cierra en 3 líneas: PDF, score y brechas para la entrevista. En las brechas van
TODOS los requisitos de la oferta que `cv.md` no prueba, cada uno marcado como
requisito o valorado y separados por `;` en una sola línea (A9). Si generaste con
el score bajo el umbral a petición del usuario, esa línea empieza con
`⚠ Score X.X/5, por debajo del umbral Y. Generado a petición tuya. Brechas para
la entrevista: …` (solo en el chat; nunca en el CV, HTML, YAML ni PDF).

---

## Paso 3B — Score < umbral

Por defecto (`below_threshold: ask`), si el usuario no lo ha pedido: nada de PDF
ni HTML. Una línea en `language.output`:

```
Score X.X/5, bajo el umbral Y. Di 'genera igual' si quieres el CV.
```

- Si pide el CV ("genera igual", "fuerza", `--force` o su equivalente) o el
  perfil trae `below_threshold: force` → 3A completo, sin discutir la regla, con
  el aviso de cierre de B2.
- `below_threshold: discard` → dos líneas, sin ofrecer:

```
Descartada — {Empresa} · {Puesto}: score X.X/5. Brecha principal: {una}.
```

- `min_score > 0` y score menor: pregunta UNA vez
  `Score X.X/5 está por debajo de tu mínimo (Z). ¿Confirmas?`. Sin confirmación
  no generes; con ella, 3A y estado `Forced`.
- Una petición explícita del usuario prevalece sobre `discard`.

---

## Paso 4 — Tracker

Añade **una línea al final** de `data/applications.md`; nunca reordenes ni
reescribas las existentes.

```
| 2026-11-16 | Empresa Ejemplo | Puesto Ejemplo | 4.3 | Evaluated | output/cv-empresa-ejemplo.pdf |
| 2026-11-16 | Empresa Ejemplo | Puesto Ejemplo | 3.2 | Forced | output/cv-empresa-ejemplo.pdf |
```

Columnas: `fecha | empresa | puesto | score o — | estado | pdf o —`.
Estados: `Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`, `Discarded`,
`Forced`.
Tú solo escribes `Evaluated` al evaluar, `Forced` al generar bajo el umbral
(con el score REAL, sin ocultarlo ni redondearlo) y `Discarded` al descartar.

---

## Reglas duras

1. **Nunca envíes, publiques ni rellenes un formulario.** Preparas; el usuario envía.
2. **Score < `scoring.apply_threshold` sin petición del usuario → nunca generes
   PDF.** Ofrécelo en una línea (Paso 3B). `force`, una petición explícita o
   `scoring.below_threshold: force` sí lo generan, con el aviso de B2 y estado
   `Forced`; `min_score` puede pedir una confirmación.
3. **Un CV = una página.** Sin excepciones.
4. **Nunca escribas HTML a mano.** Siempre `build-cv.mjs`.
5. **Nunca inventes** métrica, empresa, fecha, título ni tecnología. Una
   herramienta o práctica solo se atribuye al ítem de `cv.md` que la respalda; si
   dudas, `[VERIFICAR]` en el chat, nunca en el CV.
6. Una oferta, una evaluación. No agrupes.
7. Responde en `language.output` (por defecto `es`).
8. Lee `cv.md` **una vez** por evaluación y no lo reabras: ya está en contexto.
9. No leas `lib/`, `providers/` ni `templates/` salvo para copiar un error exacto.
   Los scripts imprimen un resumen de una línea: úsalo tal cual, no vuelques su salida.

## Comandos

| Necesitas | Comando |
|---|---|
| Extraer oferta | `node extract-jd.mjs <url>` |
| Decidir el corte | `node threshold.mjs --score X.X [--requested]` |
| Generar HTML | `node build-cv.mjs data/x.yml output/x.html` |
| Validar payload | `node validate-extra.mjs data/x.yml jds/y.md` |
| Validar estructura | `node verify-cv-structure.mjs output/x.payload.json` |
| Renderizar PDF | `node generate-pdf.mjs output/x.html output/x.pdf --max-pages=1 --strict-pages --skip-fact-check` |
| Buscar ofertas | `node scan.mjs` (config: `portals.yml`) |
