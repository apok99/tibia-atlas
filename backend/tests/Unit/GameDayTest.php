<?php

namespace Tests\Unit;

use App\Models\GameScore;
use App\Support\GameDay;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\TestCase;

/**
 * The daily-game clock and the board's ordering rule. Both are pure logic, and
 * both are load-bearing: if the day boundary drifts, a player's run lands on the
 * wrong board; if the comparison is wrong, a worse run overwrites a better one.
 */
class GameDayTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function at(string $madridTime): void
    {
        Carbon::setTestNow(Carbon::parse($madridTime, GameDay::TZ));
    }

    public function test_the_day_flips_at_server_save_not_at_midnight(): void
    {
        // Just before 10:00 we are still on the previous day's puzzle.
        $this->at('2026-07-27 09:59:59');
        $this->assertSame('2026-07-26', GameDay::date());

        // 10:00 sharp opens the new day.
        $this->at('2026-07-27 10:00:00');
        $this->assertSame('2026-07-27', GameDay::date());

        // Past midnight but before the save: still the 27th's puzzle.
        $this->at('2026-07-28 03:00:00');
        $this->assertSame('2026-07-27', GameDay::date());
    }

    public function test_next_save_is_todays_ten_before_it_and_tomorrows_after(): void
    {
        $this->at('2026-07-27 09:00:00');
        $this->assertSame('2026-07-27 10:00:00', GameDay::nextSave()->format('Y-m-d H:i:s'));

        // At the save itself the countdown must already point at the next one,
        // never at zero-forever.
        $this->at('2026-07-27 10:00:00');
        $this->assertSame('2026-07-28 10:00:00', GameDay::nextSave()->format('Y-m-d H:i:s'));

        $this->at('2026-07-27 23:30:00');
        $this->assertSame('2026-07-28 10:00:00', GameDay::nextSave()->format('Y-m-d H:i:s'));
    }

    public function test_char_key_folds_case_so_one_character_holds_one_slot(): void
    {
        $this->assertSame('bubble', GameScore::keyFor('Bubble'));
        $this->assertSame('bubble', GameScore::keyFor('  bubble '));
        $this->assertSame('eternal oblivion', GameScore::keyFor('Eternal Oblivion'));
    }

    public function test_fewer_attempts_wins_and_time_only_breaks_ties(): void
    {
        $stored = new GameScore(['attempts' => 3, 'time_ms' => 30_000]);

        // Fewer tries wins even if it took far longer.
        $this->assertTrue($stored->isBeatenBy(2, 300_000));
        // More tries never wins, however fast.
        $this->assertFalse($stored->isBeatenBy(4, 1_000));
        // Same tries: faster wins, slower doesn't, and an exact tie is not an
        // improvement (the earlier run keeps the slot).
        $this->assertTrue($stored->isBeatenBy(3, 29_999));
        $this->assertFalse($stored->isBeatenBy(3, 30_001));
        $this->assertFalse($stored->isBeatenBy(3, 30_000));
    }
}
