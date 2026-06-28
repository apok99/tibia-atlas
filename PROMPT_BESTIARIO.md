# Prompt de continuación — Revisión del bestiario Tibia Atlas

## Contexto del proyecto

Trabajo en **Tibia Atlas**, un bestiario/wiki del lore de Tibia, **BILINGÜE (español e inglés)**.
Carpeta: `C:\Users\David\Documents\web tibia` (Windows, shell PowerShell). Monorepo:
- `backend/`  → Laravel 13 + PostgreSQL
- `frontend/` → React + Vite + TS + Tailwind

**La base de datos ya tiene ~748 criaturas importadas de TibiaWiki** (sprite, stats y lore en inglés).
NO hay que importar ni scrapear nada nuevo: todo está en la BD. El trabajo es de **edición/traducción directa en la base de datos**.

## Entorno (para que psql funcione)

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"; $env:PGPASSWORD="tibia_atlas_dev"
# Conexión:
psql -U tibia_atlas -h localhost -d tibia_atlas
```

Tablas clave:
- `entries` (id, slug, type, status, meta jsonb, reviewed bool, reviewed_at)
- `entry_translations` (entry_id, locale 'es'/'en', name, overview, canon, interpretations, theories)
  con índice único `(entry_id, locale)`.

## Progreso actual

**210 / 748 criaturas revisadas** (~28%) — última sesión: 2026-06-28.

## Lo que hay que hacer — revisar y traducir DE 30 EN 30

Cada vez que se diga **"continua"**, coger las próximas 30 criaturas SIN revisar (orden alfabético):

```sql
SELECT e.id, et.name, coalesce(et.overview,''), coalesce(et.canon,'')
FROM entries e
JOIN entry_translations et ON et.entry_id=e.id AND et.locale='en'
WHERE e.type='creature' AND e.reviewed=false
ORDER BY et.name LIMIT 30;
```

*(Guardar a UTF-8 con `[System.IO.File]::WriteAllText(ruta, $result, [System.Text.Encoding]::UTF8)` para evitar el problema de codificación UTF-16 de PowerShell.)*

## Para cada criatura

### 1) Reparar el inglés si viene roto
Muchas se importaron con basura:
- **Volcados completos** de la página (Combat Properties, Health, tablas, loot…) → reescribir con el lore real; para bosses usar el texto de la sección "Notes".
- **Captions de imagen**: `"Xxx Artwork.jpg|Official Creature Artwork"` → borrar.
- **Restos del parser**: `"| runsat = 0"`, `"| speed = 55"`, `"| behaviour ="`, `"{{Mapper Coords|...}}"`, `"}}"`, URLs de coords mapper → borrar.
- **Notas de ubicación** (`"Found in: ..."`) → borrar del campo canon.
- **Notas de gameplay** (tips de nivel, tasks, achievements, fecha de update) → borrar.

Si el EN está limpio, dejarlo igual.

### 2) Traducir al español
Añadir/actualizar la fila `locale='es'` con name, overview y canon.

**REGLA CLAVE**: el **NOMBRE** de la criatura se mantiene **EN INGLÉS** ("Demon", "Amazon", "Dragon Lord"…) tanto en el campo `name` como dentro del texto, porque así lo usa la comunidad y así funciona el auto-enlazado del frontend. Traducir solo la prosa del lore, fiel al original.

### 3) Marcar como revisada
`reviewed=true`, `reviewed_at=now()`, `status='published'`.

## Cómo aplicarlo

Generar un archivo `.sql` y correrlo con `psql -f`, usando:
- **Dollar-quoting** `$$...$$` para el texto largo (evita problemas con comillas/acentos).
- Para el español: `INSERT INTO entry_translations (...) VALUES (...,'es',...) ON CONFLICT (entry_id, locale) DO UPDATE SET name=EXCLUDED.name, overview=EXCLUDED.overview, canon=EXCLUDED.canon, updated_at=now();`
- Para reparar el inglés: `UPDATE entry_translations SET ... WHERE entry_id=X AND locale='en';`
- Al final: `UPDATE entries SET reviewed=true, reviewed_at=now(), status='published', published_at=coalesce(published_at, now()) WHERE id IN (...);`
- Todo envuelto en `BEGIN; ... COMMIT;`

## Verificación tras aplicar

```sql
SELECT
  (SELECT count(*) FROM entries WHERE type='creature' AND reviewed=true) AS revisadas,
  (SELECT count(*) FROM entries WHERE type='creature') AS total;
```

## Convenciones editoriales establecidas

- Canon **limpio** si solo contenía ubicaciones, imágenes o notas de gameplay → `NULL`.
- Canon con **dato taxonómico o lore real** → conservar ese fragmento limpio (ej: "Es un pariente del Diabolic Imp.", "Pueden ser desollados con un Obsidian Knife.").
- Bosses con **volcado completo**: reconstruir overview desde la sección "Notes" + frases del wiki; descripción factual, sin inventar lore.
- Bosses de **arenas/raids** con lore mínimo: descripción breve y factual de su rol.
- El campo **interpretations** y **theories** se deja NULL salvo que haya contenido real para ello.
- Archivos SQL temporales van a `C:\Users\David\AppData\Local\Temp\claude\...\scratchpad\`.
- Para evitar UTF-16 en PowerShell: usar `[System.IO.File]::WriteAllText(ruta, $result, [System.Text.Encoding]::UTF8)`.
