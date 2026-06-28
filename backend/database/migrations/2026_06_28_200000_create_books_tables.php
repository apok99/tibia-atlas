<?php

use App\Enums\Locale;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The in-game Tibia library: the readable books found throughout the world,
 * transcribed from TibiaWiki (Category:Book Texts). One `books` row per book,
 * with `book_translations` holding the localized title + text (EN original and
 * an optional ES translation), mirroring the entries/entry_translations shape.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('books', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            // In-game appearance (e.g. "Book (Brown)") and authorship/where it is.
            $table->string('booktype')->nullable();
            $table->string('author')->nullable();
            $table->string('location')->nullable();
            // Reading-shelf grouping (the wiki "returnpage", e.g. "Thais Libraries").
            $table->string('location_group')->nullable()->index();
            $table->string('source_url')->nullable();
            // Length of the EN text — lets the UI surface substantial books and
            // sort, without loading the full text.
            $table->unsignedInteger('char_len')->default(0);
            $table->timestamps();
        });

        Schema::create('book_translations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('book_id')->constrained('books')->cascadeOnDelete();
            $table->enum('locale', Locale::values());
            $table->string('title')->nullable();
            $table->text('text')->nullable();
            $table->string('blurb')->nullable();
            $table->timestamps();

            $table->unique(['book_id', 'locale']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('book_translations');
        Schema::dropIfExists('books');
    }
};
