<?php

namespace Tests\Unit;

use App\Support\SetStats;
use PHPUnit\Framework\TestCase;

/**
 * The set readout is a number players check against their own client, so the
 * stacking rule has to be Tibia's: protections compound, they never add (a
 * summed set read 40% physical where the game gives 34.09%), and armor is a
 * flat subtraction per hit, not a percentage.
 */
class SetStatsTest extends TestCase
{
    public function test_it_compounds_protections_instead_of_summing_them(): void
    {
        $set = [
            ['equip_slot' => 'helmet', 'armor' => 9, 'resists' => ['physical' => 5]],
            ['equip_slot' => 'amulet', 'armor' => 3, 'resists' => ['physical' => 3, 'ice' => 7]],
            ['equip_slot' => 'armor', 'armor' => 18, 'resists' => ['physical' => 12]],
            ['equip_slot' => 'legs', 'armor' => 10, 'resists' => ['physical' => 7, 'ice' => 7]],
            ['equip_slot' => 'ring', 'armor' => 2, 'resists' => ['physical' => 8, 'ice' => 4]],
            ['equip_slot' => 'boots', 'armor' => 3, 'resists' => ['physical' => 5]],
        ];

        $agg = SetStats::aggregate($set, 'knight');

        // 1 − 0.95·0.97·0.88·0.93·0.92·0.95 = 34.09%, NOT the 40 the pieces add up to.
        $this->assertSame(34.1, $agg['resists']['physical']);
        $this->assertSame(17.0, $agg['resists']['ice']);
        $this->assertSame(45, $agg['armor']);
    }

    public function test_it_reads_a_protection_malus_as_a_vulnerability(): void
    {
        $agg = SetStats::aggregate([
            ['equip_slot' => 'armor', 'resists' => ['fire' => -10]],
            ['equip_slot' => 'legs', 'resists' => ['fire' => 20]],
        ], 'knight');

        // 1 − 1.10·0.80 = 12%: the malus amplifies what gets through, it doesn't
        // subtract 10 points from the other piece (that would read 10%).
        $this->assertSame(12.0, $agg['resists']['fire']);
    }

    public function test_armor_absorbs_flat_damage_per_physical_hit(): void
    {
        $this->assertSame(33.75, SetStats::armorAbsorb(45));
        $this->assertSame(0.0, SetStats::armorAbsorb(0));
    }
}
