<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every entry_id FK lookup was a sequential scan — sources alone racked up
 * 12k+ full-table scans (50M tuples) serving entry pages. Also indexes the
 * FK columns Postgres checks on entry/user deletes, and removes a duplicate
 * trigram index (entry_translations_name_trgm ≡ entry_translations_name_trgm_idx).
 *
 * Idempotent (IF NOT EXISTS): already applied directly on prod 2026-07-18.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    private const INDEXES = [
        'sources_entry_id_index' => 'sources (entry_id)',
        'entry_relations_related_entry_id_index' => 'entry_relations (related_entry_id)',
        'tibia_races_entry_id_index' => 'tibia_races (entry_id)',
        'trade_npcs_entry_id_index' => 'trade_npcs (entry_id)',
        'wordle_puzzles_entry_id_index' => 'wordle_puzzles (entry_id)',
        'altar_puzzles_entry_id_index' => 'altar_puzzles (entry_id)',
        'import_runs_entry_id_index' => 'import_runs (entry_id)',
        'import_runs_triggered_by_index' => 'import_runs (triggered_by)',
        'entries_created_by_index' => 'entries (created_by)',
    ];

    public function up(): void
    {
        foreach (self::INDEXES as $name => $target) {
            DB::statement("CREATE INDEX IF NOT EXISTS {$name} ON {$target}");
        }
        DB::statement('DROP INDEX IF EXISTS entry_translations_name_trgm');
    }

    public function down(): void
    {
        foreach (array_keys(self::INDEXES) as $name) {
            DB::statement("DROP INDEX IF EXISTS {$name}");
        }
    }
};
