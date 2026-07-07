<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Indexes for the item-album filters and name-based lookups.
 *
 *  - The album filters ~9.8k item entries by `meta->>'item_category'` and
 *    `meta->>'equip_slot'` on every request; expression btrees turn those
 *    seq scans into index scans (same trick as the classification/rank pair).
 *  - (locale, name) on entry_translations serves the exact-name lookups: the
 *    item detail's dropped_by → creature resolution and race↔entry linking
 *    both match on the EN name.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        DB::statement("CREATE INDEX IF NOT EXISTS entries_meta_item_category_idx ON entries ((meta->>'item_category'))");
        DB::statement("CREATE INDEX IF NOT EXISTS entries_meta_equip_slot_idx ON entries ((meta->>'equip_slot'))");
        DB::statement('CREATE INDEX IF NOT EXISTS entry_translations_locale_name_idx ON entry_translations (locale, name)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS entries_meta_item_category_idx');
        DB::statement('DROP INDEX IF EXISTS entries_meta_equip_slot_idx');
        DB::statement('DROP INDEX IF EXISTS entry_translations_locale_name_idx');
    }
};
