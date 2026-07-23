<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Auction price history for houses. `house_status` is snapshot-only (upserted
 * each run), so the bid a house carried yesterday is lost the moment someone
 * outbids it — these two tables keep it.
 *
 *  house_bids   every CHANGE to a live auction bid. Append-only, and cheap: of
 *               ~36k auctioned houses across all worlds, only ~270 carry a bid at
 *               any moment, and most of those sit still for hours.
 *  house_sales  a completed auction — the last bid a house carried before it
 *               flipped to `rented`, i.e. what it actually sold for. Town, size
 *               and rent are copied onto the row so the price index can be
 *               grouped without joining the static houses.json.
 *
 * Neither can be back-filled: history starts the first time the ETL runs with
 * this migration applied.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('house_bids', function (Blueprint $table) {
            $table->id();
            $table->string('world', 40);
            $table->unsignedInteger('house_id');
            $table->unsignedBigInteger('bid');
            // TibiaData's own countdown ("1 day", "5 hours"), kept verbatim for
            // display — it is a coarse string, not a timestamp.
            $table->string('time_left', 24)->nullable();
            $table->timestamp('observed_at');

            $table->index(['world', 'house_id', 'observed_at'], 'house_bids_house_time_idx');
            $table->index('observed_at');
        });

        Schema::create('house_sales', function (Blueprint $table) {
            $table->id();
            $table->string('world', 40);
            $table->unsignedInteger('house_id');
            $table->string('town', 40);
            $table->unsignedInteger('size')->default(0);       // square metres
            $table->unsignedBigInteger('rent')->default(0);    // monthly rent in gp
            $table->unsignedBigInteger('price');               // winning bid in gp
            $table->timestamp('sold_at');

            $table->index(['world', 'sold_at']);
            $table->index(['town', 'sold_at']);
            // One sale per house per auction close; guards against a re-run of the
            // same hour recording the transition twice.
            $table->unique(['world', 'house_id', 'sold_at'], 'house_sales_unique_close');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('house_sales');
        Schema::dropIfExists('house_bids');
    }
};
