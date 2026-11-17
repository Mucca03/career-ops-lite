# career-ops-lite

Asistente de empleo para **Colombia y LATAM remoto**. Flujo lineal:
**extraer → evaluar → (CV de 1 página | descartar)**.

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

**Corte:** score >= `scoring.apply_threshold` → 3A; si no → 3B.

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

**Relevancia:** dentro de cada sección, primero el ítem que más coincida con los
requisitos centrales de la oferta (stack, dominio, herramientas); empate → el más
reciente.

**Encabezado:** todos los links de `profile.yml` que existan (github, portfolio,
linkedin, links[]); omite los ausentes. `build-cv.mjs` no deja separadores vacíos.

**Competencias:** solo tecnologías que aparezcan en un bullet o en el stack de un
ítem **incluido** en este CV. Lo que la oferta pida y no esté respaldado es brecha.

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
title: Analista de Datos
email: tu@email.com
github: github.com/tu-usuario
linkedin: linkedin.com/in/tu-usuario
location: Bogotá, Colombia
summary: >
  Dos líneas: años de experiencia, dominio y el logro que la oferta pide.
competencies: [SQL, Python, Power BI]
experience:
  - company: Empresa Ejemplo
    role: Analista de Datos
    dates: 2022 — Presente
    bullets:            # cada bullet sale de cv.md, con su cifra real si la hay
      - "Construí tableros de Power BI sobre SQL y Python para el área comercial."
  - company: Empresa Anterior
    role: Analista Jr.
    dates: 2020 — 2022
    bullets:
      - "Automaticé la extracción de datos con Python y SQL."
education:
  - title: Ingeniería de Sistemas
    org: Universidad Ejemplo
    year: "2020"
```

```yaml
lang: es
name: Nombre Apellido
title: Desarrollador Junior
email: tu@email.com
github: github.com/tu-usuario
location: Bogotá, Colombia
summary: >
  Dos proyectos propios y una contribución open source mergeada.
competencies: [Python, PostgreSQL, Docker]
experience: []
projects:
  - name: Proyecto Uno
    url: github.com/tu-usuario/uno
    dates: 2025 – Presente
    description: Qué hace y qué problema resuelve.
    tech: Python, PostgreSQL, Docker
education:
  - title: Ingeniería de Sistemas (8.º semestre)
    org: Universidad Ejemplo
    year: "2026"
certifications:
  - title: Nombre del certificado
    org: Entidad
    year: "2025"
```

- Máximo `cv.max_experiences` roles y `cv.max_projects` proyectos, con
  `cv.bullets_per_role` bullets cada uno. Perfil junior: usa lo que haya, sin
  rellenar con ítems irrelevantes.
- Cada bullet sale de `cv.md`. Reformula para el puesto; nunca inventes métricas,
  herramientas ni empresas.
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
  competencias respaldadas, cifras y nombres propios que existan en `cv.md`,
  orden por relevancia y certificaciones relevantes incluidas. Si falla,
  corrige el YAML y repite (máx. 2). Nunca edites el HTML.
- `--skip-fact-check` solo si `language.output` != `en`: el gate de redacción
  cubre solo inglés y avisa de que no comprobó nada. Con `en`, quítalo.
- `verify-cv-structure.mjs`: `✅` esperado; `UNVERIFIED` = las empresas del
  payload no casan con `cv.md`, revísalo a mano y sigue.
- **Recorte si desborda** (máx. 2 reintentos): (1) ítems menos relevantes —
  nunca los 2 más relevantes; (2) competencias a 6; (3) 1 bullet en el ítem más
  débil. Nunca quitar: links del encabezado, educación, certificaciones relevantes.
- Nada de `--allow-reorder` ni `--allow-nonchronological`.

Cierra en 3 líneas: PDF, score y brechas para la entrevista.

---

## Paso 3B — Score < umbral → descartar

Dos líneas, sin PDF ni HTML. Recomienda no aplicar.

```
Descartada — {Empresa} · {Puesto}: score X.X/5. Brecha principal: {una}.
```

---

## Paso 4 — Tracker

Añade **una línea al final** de `data/applications.md`; nunca reordenes ni
reescribas las existentes.

```
| 2026-11-16 | Empresa Ejemplo | Analista de Datos | 4.3 | Evaluated | output/cv-empresa-ejemplo.pdf |
```

Columnas: `fecha | empresa | puesto | score o — | estado | pdf o —`.
Estados: `Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`, `Discarded`.
Tú solo escribes `Evaluated` al evaluar y `Discarded` al descartar.

---

## Reglas duras

1. **Nunca envíes, publiques ni rellenes un formulario.** Preparas; el usuario envía.
2. **Score < umbral → nunca generes PDF.**
3. **Un CV = una página.** Sin excepciones.
4. **Nunca escribas HTML a mano.** Siempre `build-cv.mjs`.
5. **Nunca inventes** métrica, empresa, fecha, título ni tecnología.
6. Una oferta, una evaluación. No agrupes.
7. Responde en `language.output` (por defecto `es`).
8. Lee `cv.md` **una vez** por evaluación y no lo reabras: ya está en contexto.
9. No leas `lib/`, `providers/` ni `templates/` salvo para copiar un error exacto.
   Los scripts imprimen un resumen de una línea: úsalo tal cual, no vuelques su salida.

## Comandos

| Necesitas | Comando |
|---|---|
| Extraer oferta | `node extract-jd.mjs <url>` |
| Generar HTML | `node build-cv.mjs data/x.yml output/x.html` |
| Validar payload | `node validate-extra.mjs data/x.yml jds/y.md` |
| Validar estructura | `node verify-cv-structure.mjs output/x.payload.json` |
| Renderizar PDF | `node generate-pdf.mjs output/x.html output/x.pdf --max-pages=1 --strict-pages --skip-fact-check` |
| Buscar ofertas | `node scan.mjs` (config: `portals.yml`) |
