<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Typo-tolerant name search: the item picker matched names with a literal
 * ilike substring, so one missed letter ("soulshedder") turned a real weapon
 * (Soulshredder) into "no results". pg_trgm's % operator matches by trigram
 * similarity; the GIN index keeps it fast.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('create extension if not exists pg_trgm');
        DB::statement(
            'create index if not exists entry_translations_name_trgm'
            .' on entry_translations using gin (name gin_trgm_ops)'
        );
    }

    public function down(): void
    {
        DB::statement('drop index if exists entry_translations_name_trgm');
        // The extension stays: other installs may share it and dropping is
        // never required for a rollback of this feature.
    }
};
