<?php

use App\Enums\Locale;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entry_translations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('entry_id')->constrained('entries')->cascadeOnDelete();
            $table->enum('locale', Locale::values());
            $table->string('name');

            // The seven editorial sections of every Tibia Atlas article.
            $table->text('overview')->nullable();
            $table->text('canon')->nullable();
            $table->text('interpretations')->nullable();
            $table->text('theories')->nullable();
            $table->text('research_gaps')->nullable();

            $table->timestamps();

            $table->unique(['entry_id', 'locale']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('entry_translations');
    }
};
