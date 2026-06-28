<?php

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entries', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->enum('type', EntryType::values())->index();
            $table->enum('status', EntryStatus::values())->default(EntryStatus::Draft->value)->index();
            $table->boolean('featured')->default(false)->index();
            $table->string('primary_image')->nullable();
            // Flexible, type-specific attributes (e.g. creature hitpoints, city region).
            $table->jsonb('meta')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('published_at')->nullable()->index();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('entries');
    }
};
