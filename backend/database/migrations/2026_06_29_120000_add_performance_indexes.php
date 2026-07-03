<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Performance indexes for the hottest read paths.
 *
 *  - Expression indexes on the jsonb `meta` keys we filter by (classification,
 *    rank) — the single-arrow `meta->key` filters compile to `meta->>'key' = ?`,
 *    which a plain GIN on `meta` can't serve but a btree on the expression can.
 *  - A composite (status, published_at) so the ubiquitous
 *    "published, newest first" listing is a single index range scan.
 *  - Trigram GIN indexes on the searchable translation columns so the
 *    `ILIKE '%term%'` site search stops sequentially scanning every row.
 *    Guarded: if the DB role can't create the pg_trgm extension the search
 *    still works (just unindexed), so the migration never hard-fails.
 */
return new class extends Migration
{
    /**
     * Run each statement auto-committed. A failed (guarded) CREATE EXTENSION
     * would otherwise poison a wrapping transaction and abort the whole
     * migration even though we catch the error.
     */
    public $withinTransaction = false;

    public function up(): void
    {
        // Bestiary facet filters (classification / boss rank).
        DB::statement("CREATE INDEX IF NOT EXISTS entries_meta_classification_idx ON entries ((meta->>'classification'))");
        DB::statement("CREATE INDEX IF NOT EXISTS entries_meta_rank_idx ON entries ((meta->>'rank'))");

        // "Published, newest first" — the default listing order.
        DB::statement('CREATE INDEX IF NOT EXISTS entries_status_published_at_idx ON entries (status, published_at DESC)');

        // Trigram-accelerated ILIKE search over the translated name + overview.
        try {
            DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
            DB::statement('CREATE INDEX IF NOT EXISTS entry_translations_name_trgm_idx ON entry_translations USING gin (name gin_trgm_ops)');
            DB::statement('CREATE INDEX IF NOT EXISTS entry_translations_overview_trgm_idx ON entry_translations USING gin (overview gin_trgm_ops)');
        } catch (Throwable $e) {
            // Most likely: the app DB role lacks privilege to CREATE EXTENSION.
            // Search degrades to a sequential scan — correct, just slower.
            Log::warning('pg_trgm search indexes skipped: '.$e->getMessage());
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS entries_meta_classification_idx');
        DB::statement('DROP INDEX IF EXISTS entries_meta_rank_idx');
        DB::statement('DROP INDEX IF EXISTS entries_status_published_at_idx');
        DB::statement('DROP INDEX IF EXISTS entry_translations_name_trgm_idx');
        DB::statement('DROP INDEX IF EXISTS entry_translations_overview_trgm_idx');
    }
};
