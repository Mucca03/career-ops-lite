# career-ops-lite

Búsqueda de empleo asistida por IA, mínima y local, para **Colombia y LATAM
remoto**. Funciona en cualquier CLI de agente (OpenCode, Claude Code, Codex,
Gemini, Kimi) y con modelos locales pequeños (7B–9B en Ollama).

Un flujo, lineal. Sin modos, sin plugins, sin servicios externos:

```
oferta (URL o texto)  →  score 0–5  →  ≥4.0: CV de 1 página en PDF
                                    →  <4.0: descarte en 2 líneas
```

## Por qué

Un agente que carga 80.000 tokens de instrucciones antes de mirar una oferta
gasta contexto en el manual, no en el puesto. Aquí las instrucciones son
**~6,7 KB** (≈1.800 tokens) y el único trabajo del modelo es leer el CV, leer la
oferta y decidir.

## Instalación

```bash
npm install
cp .env.example .env                  # opcional
```

Requiere Node ≥ 22.13 y Chromium para el PDF:

```bash
npx playwright install chromium
```

## Primer uso (onboarding)

Abre tu CLI de agente en esta carpeta y escribe `/career-ops`.

Si no existen `cv.md` ni `config/profile.yml`, el agente te pedirá tu CV y cuatro
datos (roles objetivo, ciudad y modalidad, salario esperado, idioma) y creará:

| Fichero | Contenido |
|---|---|
| `cv.md` | Tu CV canónico — la fuente de verdad de todo |
| `config/profile.yml` | Roles, ubicación, salario, idioma, límites del CV |
| `portals.yml` | Portales del escáner (opcional) |

Manual, si prefieres hacerlo tú:

```bash
cp cv.example.md cv.md
cp config/profile.example.yml config/profile.yml
cp portals.example.yml portals.yml
```

## Uso diario

```bash
# 1. Extraer la oferta (una o varias URLs, o texto pegado)
node extract-jd.mjs https://co.computrabajo.com/oferta-de-trabajo/analista-datos-123
node extract-jd.mjs --file urls.txt
node extract-jd.mjs --text            # pega y pulsa Ctrl-D

# 2. Evaluar (lo hace el agente según AGENTS.md; score 0–5)

# 3. Si el score llega al umbral, CV de una página
node build-cv.mjs data/cv-empresa.yml output/cv-empresa.html   # emite también .payload.json
node verify-cv-structure.mjs output/cv-empresa.payload.json
node generate-pdf.mjs output/cv-empresa.html output/cv-empresa.pdf \
  --format=letter --max-pages=1 --strict-pages --skip-fact-check
```

`--skip-fact-check` evita el aviso del verificador de redacción, que solo tiene
listas de palabras en inglés y chino simplificado: en un CV en español no
comprueba nada y lo dice en cada render. La regla "no inventar" de `AGENTS.md`
y `verify-cv-structure.mjs` cubren ese hueco.

## Comandos

| Comando | Qué hace |
|---|---|
| `extract-jd.mjs` | Extrae título, empresa y descripción limpia de una oferta |
| `build-cv.mjs` | Rellena la plantilla HTML desde un payload YAML (y emite el `.payload.json`) |
| `generate-pdf.mjs` | HTML → PDF, con control de páginas y verificación de hechos |
| `verify-cv-structure.mjs` | Comprueba que el CV adaptado no pierde secciones (lee el `.payload.json`) |
| `scan.mjs` | Barre portales de `portals.yml` (opcional, sin coste de tokens) |

## Estructura

```
AGENTS.md                 instrucciones del agente (~6,7 KB)
cv.md                     tu CV (privado, gitignored)
config/profile.yml        tus criterios (privado, gitignored)
portals.yml               portales del escáner (privado, gitignored)
extract-jd.mjs            extractor de ofertas
build-cv.mjs              payload YAML → HTML
generate-pdf.mjs          HTML → PDF
verify-cv-structure.mjs   validación de estructura del CV
templates/cv-template.html  plantilla del CV
lib/                      dependencias de los scripts
jds/                      ofertas extraídas
output/                   CVs generados
data/applications.md      tracker (append-only)
```

## Portales

`extract-jd.mjs` funciona con cualquier portal: usa un navegador real, así que
no depende de APIs. Los selectores afinados son para Computrabajo, Magneto365,
GetOnBoard, Torre, elempleo, LinkedIn, Indeed y Glassdoor; en cualquier otro se
aplica una heurística genérica.

Si un portal exige sesión (LinkedIn, Indeed), configura
`CAREER_OPS_BROWSER_PROFILE` en `.env` para reutilizar un perfil de navegador.

## Modelos locales

Pensado para sesiones con Ollama de 7B–9B: el flujo tiene cinco comandos, una
plantilla de salida fija y una única regla de corte. Si el modelo se desvía,
`build-cv.mjs` y `generate-pdf.mjs` fallan con un mensaje concreto en vez de
producir un PDF roto.

## Privacidad

`cv.md`, `config/profile.yml`, `portals.yml`, `data/`, `jds/`, `reports/`,
`output/` y `.env` están en `.gitignore`. Nada sale de tu máquina: los scripts
hablan solo con los portales que tú les das.

## Licencia

MIT — ver `LICENSE`.
