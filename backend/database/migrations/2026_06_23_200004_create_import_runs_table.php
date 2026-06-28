<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_runs', function (Blueprint $table) {
            $table->id();
            $table->string('source');              // e.g. "tibiawiki"
            $table->string('query');               // the page/title requested
            $table->string('status')->default('pending'); // pending|success|failed
            $table->foreignId('entry_id')->nullable()->constrained('entries')->nullOnDelete();
            $table->jsonb('payload')->nullable();  // raw fetched data, for auditing
            $table->text('message')->nullable();   // error or summary
            $table->foreignId('triggered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('import_runs');
    }
};
