<?php

use App\Enums\EntryType;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `$table->enum('type', …)` bakes the allowed values into a CHECK constraint,
 * so adding the `npc` case to EntryType is not enough — the existing constraint
 * still rejects it. Rebuild the constraint from the current enum values.
 */
return new class extends Migration
{
    public function up(): void
    {
        $values = collect(EntryType::values())
            ->map(fn (string $v) => "'".$v."'")
            ->implode(', ');

        DB::statement('ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_type_check');
        DB::statement("ALTER TABLE entries ADD CONSTRAINT entries_type_check CHECK (type::text = ANY (ARRAY[{$values}]::text[]))");
    }

    public function down(): void
    {
        $values = collect(EntryType::values())
            ->reject(fn (string $v) => $v === 'npc')
            ->map(fn (string $v) => "'".$v."'")
            ->implode(', ');

        DB::statement('ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_type_check');
        DB::statement("ALTER TABLE entries ADD CONSTRAINT entries_type_check CHECK (type::text = ANY (ARRAY[{$values}]::text[]))");
    }
};
