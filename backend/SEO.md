# SEO & AI discoverability

How Tibia Atlas gets found by search engines **and** by AI answer engines
(ChatGPT, Claude, Perplexity, Gemini). The site is a client-rendered React SPA,
so the strategy is **dynamic rendering**: humans get the JS bundle; crawlers —
most of which don't run JavaScript — get a server-rendered HTML mirror built
from the same database. No cloaking risk (identical data), no headless browser
on the VPS.

## What's in the codebase

### Frontend (`frontend/`)
- **`src/lib/seo.tsx`** — the `<Seo>` component (React 19 native document
  metadata). Per route it sets `<title>`, `<meta name=description>`,
  `<link rel=canonical>`, Open Graph, Twitter Card, `hreflang` (es/en/x-default)
  and JSON-LD. Helpers: `websiteJsonLd` (+ sitelinks `SearchAction`),
  `organizationJsonLd`, `breadcrumbJsonLd`, `articleJsonLd`, `collectionJsonLd`.
- Wired into every page (`HomePage`, `BrowsePage`, `EntryPage`, `ItemsPage`,
  `MapPage`, `TimelinePage`, `HistoryPage`, `QuestsPage`, `KillStatsPage`,
  `SoundtrackPage`, `WordlePage`). `EntryPage` emits `Article` + `BreadcrumbList`.
- **`index.html`** — static SEO tags removed so they don't duplicate React's.
- **`public/robots.txt`** — allows Google + GPTBot/OAI-SearchBot/ClaudeBot/
  PerplexityBot/Google-Extended/CCBot etc.; links the sitemap. (Served statically.)
- **`public/llms.txt`** — curated Markdown overview for LLMs. (Served statically.)

### Backend (`backend/`)
- **`PrerenderController`** (`routes/web.php` catch-all) — server-rendered HTML
  mirror of any SPA route (home, `/browse/{type}`, `/entry/{slug}`, feature
  pages) with full lore text, meta and JSON-LD. Honours `?lang=`; defaults to
  Spanish. View: `resources/views/crawler.blade.php`.
- **`SitemapController`** — `/sitemap.xml` (index) → `/sitemap-pages.xml` +
  `/sitemap-lore.xml`, generated from the DB with `hreflang` + `lastmod`, cached.
- **`LlmsController`** — `/llms-full.txt`, a Markdown index of every published
  article grouped by type, cached.

These three need PHP, so Nginx must route their paths (and bot user-agents) to
Laravel — see below. `robots.txt`/`llms.txt` are static files in the SPA bundle.

## Nginx changes (apply once on the VPS)

Live config: `/etc/nginx/sites-available/tibia`, FPM socket
`/run/php/php8.5-fpm.sock`, SPA root `/var/www/tibia/frontend/dist`, Laravel
front controller `/var/www/tibia/backend/public/index.php`.

**1. Bot map** — add at `http{}` level, e.g. `/etc/nginx/conf.d/tibia-bots.conf`:

```nginx
map $http_user_agent $tibia_is_bot {
    default 0;
    "~*(googlebot|bingbot|duckduckbot|yandex|baiduspider|applebot|slurp|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity-user|google-extended|applebot-extended|ccbot|facebookexternalhit|twitterbot|slackbot|discordbot|linkedinbot|telegrambot|whatsapp|bytespider|amazonbot)" 1;
}
```

**2. Inside the HTTPS `server{}` block** — a named location that hands a request
to Laravel (mirrors the working `^~ /api/` block), the dynamic SEO paths, and a
bot branch on the SPA fallback. Adjust `fastcgi_param` lines to match the
existing `/api` block if it differs.

```nginx
    # Laravel front controller, preserving the original REQUEST_URI.
    location @laravel {
        include snippets/fastcgi-php.conf;          # or fastcgi_params
        fastcgi_pass unix:/run/php/php8.5-fpm.sock;
        fastcgi_param SCRIPT_FILENAME /var/www/tibia/backend/public/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
    }

    # Dynamic XML sitemaps + the LLM full index → Laravel.
    location = /sitemap.xml                  { try_files /nonexistent @laravel; }
    location ~ ^/sitemap-(pages|lore)\.xml$  { try_files /nonexistent @laravel; }
    location = /llms-full.txt                { try_files /nonexistent @laravel; }

    # SPA fallback: humans get the bundle; crawlers get the rendered mirror.
    location / {
        if ($tibia_is_bot) { rewrite ^ /__prerender$uri last; }
        try_files $uri /index.html;
    }

    # Internal: crawler render. Strips the /__prerender prefix so Laravel's
    # catch-all sees the real path (/entry/foo, /browse/creature, …).
    location ~ ^/__prerender(/.*)?$ {
        internal;
        include snippets/fastcgi-php.conf;          # or fastcgi_params
        fastcgi_pass unix:/run/php/php8.5-fpm.sock;
        fastcgi_param SCRIPT_FILENAME /var/www/tibia/backend/public/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_param REQUEST_URI $1$is_args$args;  # original path, sans prefix
    }
```

**3. Apply safely**

```bash
sudo cp /etc/nginx/sites-available/tibia /etc/nginx/sites-available/tibia.bak
# edit the file per the above
sudo nginx -t && sudo systemctl reload nginx        # reload, never restart
```

**4. Verify**

```bash
# Bot sees server-rendered HTML with real content + JSON-LD:
curl -sA 'Googlebot' https://tibiaatlas.com/entry/ferumbras | grep -E '<title>|ld\+json' | head
curl -sA 'ClaudeBot' https://tibiaatlas.com/ | grep -c 'href="https://tibiaatlas.com'
# Human sees the SPA shell:
curl -s https://tibiaatlas.com/entry/ferumbras | grep -c 'id="root"'
# SEO endpoints:
curl -sI https://tibiaatlas.com/sitemap.xml | grep -i content-type   # application/xml
curl -s  https://tibiaatlas.com/robots.txt | head -1
curl -s  https://tibiaatlas.com/llms.txt   | head -1
```

## Deploy order
1. `git push origin main` → CI builds `npx vite build` (robots/llms/index.html
   ship in `dist`) and rsyncs backend (new controllers/routes/view) + runs
   `route:cache`. Frontend SEO and the Laravel SEO routes go live immediately.
2. Apply the Nginx changes above (one-time) so `/sitemap.xml`, `/llms-full.txt`
   and bot dynamic-rendering are reachable.
3. Submit `https://tibiaatlas.com/sitemap.xml` in Google Search Console and
   Bing Webmaster Tools.

## Notes / future
- Items and library books render inside `/items` and `/history` (no per-item
  URL), so they're intentionally **not** in the sitemap. Giving items their own
  `/items/{slug}` route would add ~9k indexable pages — a future enhancement.
- After publishing more drafts, the lore sitemap and `/llms-full.txt` pick them
  up automatically (caches expire in 30 min).
