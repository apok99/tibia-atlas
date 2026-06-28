<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entry_relations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('entry_id')->constrained('entries')->cascadeOnDelete();
            $table->foreignId('related_entry_id')->constrained('entries')->cascadeOnDelete();
            // Optional nature of the link, e.g. "located_in", "ally_of", "appears_in".
            $table->string('relation_type')->nullable();
            $table->timestamps();

            $table->unique(['entry_id', 'related_entry_id', 'relation_type'], 'entry_relation_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('entry_relations');
    }
};
