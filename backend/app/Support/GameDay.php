<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * The daily-game clock. Every daily puzzle (Bestiordle, the Bestiary Altar, the
 * Cartographer) and the score boards behind them roll over at Tibia's server
 * save, not at midnight: 10:00 Spanish time (CET/CEST, same offsets as the game's
 * own Europe/Berlin).
 *
 * Keeping the boundary in one place means the puzzle a player is solving and the
 * board their run lands on can never disagree about which day it is.
 */
class GameDay
{
    public const SAVE_HOUR = 10;

    public const TZ = 'Europe/Madrid';

    /** The current Tibia day (Y-m-d), with the boundary at server save. */
    public static function date(): string
    {
        return Carbon::now(self::TZ)->subHours(self::SAVE_HOUR)->toDateString();
    }

    /** The next server-save instant — what the clients count down to. */
    public static function nextSave(): Carbon
    {
        $now = Carbon::now(self::TZ);
        $save = $now->copy()->setTime(self::SAVE_HOUR, 0);
        if ($now->greaterThanOrEqualTo($save)) {
            $save->addDay();
        }

        return $save;
    }
}
