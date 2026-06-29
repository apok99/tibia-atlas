# Tibia Atlas

A bilingual (🇪🇸 / 🇬🇧) lore archive for **Tibia** — documenting creatures, characters,
cities, organizations, quests, and historical events. Built around an editorial
discipline that separates **fact from interpretation** and cites every source.

> Fan project. Not affiliated with CipSoft. Lore is documented, never invented.

---

## Architecture

Monorepo with two apps:

```
web tibia/
├── backend/    Laravel 13 REST API  (PHP 8.4, PostgreSQL 17)
└── frontend/   React + Vite + TypeScript + Tailwind v4
```

### Editorial model

Every article (`Entry`) is one lore subject and is rendered in seven sections:

| Section            | Meaning                                                        |
|--------------------|----------------------------------------------------------------|
| **Overview**       | Concise summary.                                               |
| **Canon**          | Only what official sources support. No speculation.           |
| **Interpretations**| Reasonable conclusions inferred from canon.                   |
| **Theories**       | Community theories, clearly labelled unconfirmed.             |
| **Related Entities**| Links to other entries (characters, cities, creatures…).     |
| **Sources**        | Every cited source, ranked by canonical authority.           |
| **Research Gaps**  | Open questions / missing information.                         |

### Data model (PostgreSQL)

- `entries` — base record: `type`, `slug`, `status` (draft/in_review/published),
  `featured`, `meta` (jsonb, type-specific attributes), author, `published_at`.
- `entry_translations` — **one row per locale (`es` / `en`)** holding the five
  textual editorial sections. This is how bilingual content is stored.
- `sources` — cited sources, typed (official / CipSoft / TibiaWiki / internet)
  with an authority ranking.
- `entry_relations` — typed many-to-many links between entries.
- `import_runs` — audit log of external imports.

### Backend layers

```
Enums            type-safe domain vocabulary (EntryType, EntryStatus, Locale, SourceType)
Models           Eloquent: Entry, EntryTranslation, Source, ImportRun
Http/Requests    validation (StoreEntryRequest, UpdateEntryRequest)
Http/Resources   API serialization, locale-aware (EntryResource, EntryListResource)
Http/Controllers thin controllers (public read + Admin CRUD + Admin import)
Services         business logic (EntryService, Import/TibiaWikiImporter)
Http/Middleware  SetLocale — resolves ?lang= / Accept-Language
```

---

## API

Locale is resolved per request from `?lang=es|en` (or the `Accept-Language` header).

**Public (read-only)**
```
GET  /api/entries?type=&q=&featured=&lang=     list published entries
GET  /api/entries/{slug}?lang=                 full article
```

---

## Local development (Windows)

Tooling installed via winget: **PHP 8.4**, **Composer 2**, **PostgreSQL 17**, **Node 24**.

### Database
Database `tibia_atlas`, role `tibia_atlas` / `tibia_atlas_dev` (dev only).
See `backend/.env`.

### Backend
```sh
cd backend
composer install            # first time
php artisan migrate:fresh --seed
php artisan serve            # http://127.0.0.1:8000
```

### Frontend
```sh
cd frontend
npm install                 # first time
npm run dev                 # http://localhost:5173  (proxies /api → :8000)
```

### Import lore from TibiaWiki (CLI)
```sh
php artisan tibia:import "Ferumbras" --type=character
```
Imports the page's intro as a **draft** (never auto-published): raw material for an
editor to verify, split into Canon vs Interpretations, and translate.

---

## Conventions

- Content is created/edited via the seeders or imported from the CLI, then
  reviewed before publishing.
- The frontend UI strings live in `frontend/src/i18n.ts`; article content comes
  bilingual from the API.
- Prefer accuracy over completeness — uncertain claims belong in Theories or
  Research Gaps, never in Canon.
