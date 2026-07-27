<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One solved run of a daily puzzle game, by one linked Tibia character, on one
 * Tibia day. Ranked by attempts first, elapsed time as the tiebreak.
 */
class GameScore extends Model
{
    protected $table = 'game_scores';

    protected $fillable = [
        'game', 'date', 'char_name', 'char_key',
        'world', 'level', 'vocation', 'attempts', 'time_ms',
    ];

    protected $casts = [
        'date' => 'date',
        'level' => 'integer',
        'attempts' => 'integer',
        'time_ms' => 'integer',
    ];

    /** The identity a board slot is keyed on: the name, case-folded. */
    public static function keyFor(string $name): string
    {
        return mb_strtolower(trim($name));
    }

    /** Is (attempts, time) a better run than this row? Attempts win, time breaks ties. */
    public function isBeatenBy(int $attempts, int $timeMs): bool
    {
        return $attempts < $this->attempts
            || ($attempts === $this->attempts && $timeMs < $this->time_ms);
    }
}
