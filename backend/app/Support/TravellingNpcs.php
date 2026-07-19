<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * The two merchants that never stand still. Neither appears in the OT world
 * spawn XML (scripts teleport them around), so their positions live here:
 *
 * - Rashid follows a fixed weekly circuit (coordinates lifted from the OT
 *   globalevent `scripts/globalevents/spawn/rashid.lua`, which mirrors the
 *   real game). He moves at the 10:00 CET server save, so "today" is the CET
 *   date shifted back 10 hours.
 * - Yasir docks at one of three ports at random — unpredictable, so the API
 *   ships all three candidate spots instead of a fake certainty.
 */
final class TravellingNpcs
{
    /** Rashid's stop per weekday, keyed by Carbon dayOfWeek (0 = Sunday). */
    private const RASHID = [
        0 => ['city' => 'Carlin', 'coords' => [32328, 31782, 6]],
        1 => ['city' => 'Svargrond', 'coords' => [32207, 31155, 7]],
        2 => ['city' => 'Liberty Bay', 'coords' => [32300, 32837, 7]],
        3 => ['city' => 'Port Hope', 'coords' => [32577, 32753, 7]],
        4 => ['city' => 'Ankrahmun', 'coords' => [33066, 32879, 6]],
        5 => ['city' => 'Darashia', 'coords' => [33235, 32483, 7]],
        6 => ['city' => 'Edron', 'coords' => [33166, 31810, 6]],
    ];

    /** Yasir's three possible docks (from the OT oriental_trader world change). */
    private const YASIR = [
        ['city' => 'Ankrahmun', 'coords' => [33102, 32884, 6]],
        ['city' => 'Carlin', 'coords' => [32400, 31815, 6]],
        ['city' => 'Liberty Bay', 'coords' => [32314, 32895, 6]],
    ];

    /**
     * Travel decoration for a merchant, or null for the sedentary majority.
     * Shape: kind=weekly ships today's stop + the full schedule; kind=roaming
     * ships the candidate spots.
     *
     * @return array{kind: string, today?: array{city: string, coords: array{int,int,int}}, schedule?: list<array{day: int, city: string}>, spots?: list<array{city: string, coords: array{int,int,int}}>}|null
     */
    public static function decorate(string $npcName): ?array
    {
        return match (mb_strtolower($npcName)) {
            'rashid' => [
                'kind' => 'weekly',
                'today' => self::RASHID[self::rashidDay()],
                'schedule' => array_map(
                    fn (int $day) => ['day' => $day, 'city' => self::RASHID[$day]['city']],
                    array_keys(self::RASHID),
                ),
            ],
            'yasir' => ['kind' => 'roaming', 'spots' => self::YASIR],
            default => null,
        };
    }

    /** Weekday of Rashid's current stop: CET, day flips at the 10:00 server save. */
    private static function rashidDay(): int
    {
        return CarbonImmutable::now('Europe/Berlin')->subHours(10)->dayOfWeek;
    }
}
