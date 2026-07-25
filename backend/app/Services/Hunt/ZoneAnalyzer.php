<?php

namespace App\Services\Hunt;

use App\Models\Entry;
use App\Support\HuntZones;
use App\Support\SetStats;

/**
 * The map's "Analizar zona" panel: given a rectangle the user drew on a floor,
 * summarise what lives inside it — which creatures and how many spawn points
 * each, what elements their damage arrives as, which elements they are weak or
 * resistant to, and how many species can hit from range.
 *
 * Player-agnostic on purpose: unlike the Hunt Finder this doesn't score the
 * zone for a level/vocation, it just describes the zone honestly from the OT
 * server data (meta.ot, meta.damage_mods, meta.spawns). The map is the input
 * device — the bbox comes from a drag-selection, the floor from the map's
 * floor control.
 */
class ZoneAnalyzer
{
    /** Longest bbox side accepted — beyond this a selection is a region, not a zone. */
    private const MAX_SIDE = 800;

    /** Species returned in the breakdown (the aggregate still counts all of them). */
    private const MAX_SPECIES = 24;

    /** Same distribution-not-a-place filter the Hunt Finder applies to bestiary Locations. */
    private const VAGUE_PLACE = '/\b(almost )?every(where|thing)|many (dungeons|parts)|various locations|all (over|around|grass)|most grass|several spawns|throughout the|it raids\b/i';

    public function analyze(int $x1, int $y1, int $x2, int $y2, int $z, string $locale): array
    {
        [$minX, $maxX] = [min($x1, $x2), max($x1, $x2)];
        [$minY, $maxY] = [min($y1, $y2), max($y1, $y2)];
        $maxX = min($maxX, $minX + self::MAX_SIDE);
        $maxY = min($maxY, $minY + self::MAX_SIDE);

        $rows = Entry::query()
            ->where('type', 'creature')
            ->whereNotNull('meta->spawn_count')
            ->with(['translations' => fn ($t) => $t->whereIn('locale', ['en', $locale])])
            ->get(['id', 'slug', 'meta', 'primary_image']);

        $creatures = [];
        $totalPoints = 0;
        $placeWeight = [];
        foreach ($rows as $c) {
            $meta = $c->meta ?? [];
            $count = 0;
            foreach ((array) ($meta['spawns'] ?? []) as $sp) {
                if (! is_array($sp) || count($sp) < 3) {
                    continue;
                }
                if ((int) $sp[2] === $z
                    && (int) $sp[0] >= $minX && (int) $sp[0] <= $maxX
                    && (int) $sp[1] >= $minY && (int) $sp[1] <= $maxY) {
                    $count++;
                }
            }
            if ($count === 0) {
                continue;
            }

            $ot = (array) ($meta['ot'] ?? []);
            $mods = (array) ($meta['damage_mods'] ?? []);
            $place = (string) ($ot['place'] ?? '');
            if ($place !== '' && ! preg_match(self::VAGUE_PLACE, $place)) {
                $placeWeight[$place] = ($placeWeight[$place] ?? 0) + $count;
            }

            $totalPoints += $count;
            $creatures[] = [
                'slug' => $c->slug,
                'name' => $c->translation('en')?->name ?? $c->translation($locale)?->name ?? $c->slug,
                'image' => $c->primary_image,
                'boss' => ($meta['rank'] ?? null) === 'Boss',
                'count' => $count,
                'hp' => (int) ($meta['hitpoints'] ?? 0),
                'experience' => (int) ($meta['experience'] ?? 0),
                'burst' => (int) ($ot['burst'] ?? 0),
                'dps' => (float) ($ot['dps'] ?? 0),
                'stars' => $ot['stars'] ?? null,
                'ranged' => (bool) ($ot['ranged'] ?? false),
                // HP at which it turns and flees (0 = fights to the death) — the
                // "chases wounded runners" nuisance factor of a spot.
                'run_health' => (int) ($ot['run_health'] ?? 0),
                'damage_elements' => $this->topDamageElements((array) ($ot['burst_by_element'] ?? [])),
                'weak_to' => $this->modHints($mods, weak: true),
                'resists' => $this->modHints($mods, weak: false),
            ];
        }

        // Deadliest first — burst is the honest per-turn threat measure.
        usort($creatures, fn ($a, $b) => $b['burst'] <=> $a['burst']);

        return [
            'name' => $this->zoneName($placeWeight, $totalPoints, intdiv($minX + $maxX, 2), intdiv($minY + $maxY, 2)),
            'x1' => $minX, 'y1' => $minY, 'x2' => $maxX, 'y2' => $maxY, 'z' => $z,
            'species' => count($creatures),
            'spawn_points' => $totalPoints,
            'ranged_species' => count(array_filter($creatures, fn ($c) => $c['ranged'])),
            'fleeing_species' => count(array_filter($creatures, fn ($c) => $c['run_health'] > 0)),
            'incoming' => $this->incomingShare($creatures),
            'attack_with' => $this->attackWith($creatures),
            'avoid' => $this->avoidElements($creatures),
            'creatures' => array_slice($creatures, 0, self::MAX_SPECIES),
        ];
    }

    /**
     * What the zone's combined damage arrives as: each creature's real per-turn
     * damage table (burst_by_element) weighted by how many of it spawn here,
     * expressed as a percentage share. This is the "protect yourself against"
     * headline.
     *
     * @return list<array{element: string, pct: int}>
     */
    private function incomingShare(array $creatures): array
    {
        $byEl = [];
        foreach ($creatures as $c) {
            foreach ($c['damage_elements'] as $d) {
                $byEl[$d['element']] = ($byEl[$d['element']] ?? 0) + $d['burst'] * $c['count'];
            }
        }
        $total = array_sum($byEl);
        if ($total <= 0) {
            return [];
        }
        arsort($byEl);
        $out = [];
        foreach ($byEl as $el => $sum) {
            $pct = (int) round(100 * $sum / $total);
            if ($pct >= 3) {
                $out[] = ['element' => $el, 'pct' => $pct];
            }
        }

        return $out;
    }

    /**
     * The elements that work best against this crowd: count-weighted average of
     * each element's damage_mods across the residents (creatures without mods
     * count as neutral 100). Always the top three — when the zone resists
     * everything, the least-resisted elements are still the honest advice (the
     * chip carries the negative % so it doesn't oversell them).
     *
     * @return list<array{element: string, avg_pct: int}>
     */
    private function attackWith(array $creatures): array
    {
        $avg = $this->weightedMods($creatures);
        arsort($avg);
        $out = [];
        foreach ($avg as $el => $pct) {
            if (count($out) >= 3) {
                break;
            }
            $out[] = ['element' => $el, 'avg_pct' => (int) round($pct)];
        }

        return $out;
    }

    /**
     * Elements the zone as a whole shrugs off (count-weighted average below
     * ~90%), with how many species are outright immune — the "don't bother
     * with fire here" warning.
     *
     * @return list<array{element: string, avg_pct: int, immune_species: int}>
     */
    private function avoidElements(array $creatures): array
    {
        $avg = $this->weightedMods($creatures);
        asort($avg);
        $out = [];
        foreach ($avg as $el => $pct) {
            if ($pct >= 90 || count($out) >= 3) {
                break;
            }
            $immune = 0;
            foreach ($creatures as $c) {
                foreach ($c['resists'] as $r) {
                    if ($r['element'] === $el && $r['pct'] === 0) {
                        $immune++;
                    }
                }
            }
            $out[] = ['element' => $el, 'avg_pct' => (int) round($pct), 'immune_species' => $immune];
        }

        return $out;
    }

    /** @return array<string, float> element => count-weighted average damage_mod */
    private function weightedMods(array $creatures): array
    {
        $sum = [];
        $weight = 0;
        foreach ($creatures as $c) {
            $mods = [];
            foreach ($c['weak_to'] as $m) {
                $mods[$m['element']] = $m['pct'];
            }
            foreach ($c['resists'] as $m) {
                $mods[$m['element']] = $m['pct'];
            }
            foreach (SetStats::ELEMENTS as $el) {
                $sum[$el] = ($sum[$el] ?? 0) + ($mods[$el] ?? 100) * $c['count'];
            }
            $weight += $c['count'];
        }

        return $weight > 0 ? array_map(fn ($s) => $s / $weight, $sum) : [];
    }

    /**
     * A creature's damage table as a display list, largest element first.
     *
     * @param  array<string, int>  $burstByEl
     * @return list<array{element: string, burst: int}>
     */
    private function topDamageElements(array $burstByEl): array
    {
        arsort($burstByEl);
        $out = [];
        foreach ($burstByEl as $el => $burst) {
            $out[] = ['element' => (string) $el, 'burst' => (int) $burst];
        }

        return array_slice($out, 0, 4);
    }

    /**
     * Elemental modifiers as display hints: weak = takes MORE than normal
     * (attack it with this), resist = takes less (0 = immune).
     *
     * @return list<array{element: string, pct: int}>
     */
    private function modHints(array $mods, bool $weak): array
    {
        $out = [];
        foreach ($mods as $el => $pct) {
            if (! in_array($el, SetStats::ELEMENTS, true)) {
                continue;
            }
            $pct = (int) $pct;
            if ($weak ? $pct > 100 : $pct < 100) {
                $out[] = ['element' => (string) $el, 'pct' => $pct];
            }
        }
        usort($out, fn ($a, $b) => $weak ? $b['pct'] <=> $a['pct'] : $a['pct'] <=> $b['pct']);

        return $out;
    }

    /**
     * Name the selection. Unlike the Hunt Finder's clusters, the user CHOSE this
     * spot, so the nearest landmark to it is the truthful name — the residents'
     * bestiary place is only a fallback (a Demon spawn on Goroma still says
     * "Hero Cave" in its bestiary entry), for selections far from any landmark
     * (deep dungeons whose creatures do share a home place).
     */
    private function zoneName(array $placeWeight, int $totalPoints, int $cx, int $cy): ?string
    {
        $near = HuntZones::nearest($cx, $cy);
        if ($near !== null) {
            return $near;
        }
        arsort($placeWeight);
        $top = array_key_first($placeWeight);
        if ($top !== null && $totalPoints > 0 && $placeWeight[$top] >= 0.5 * $totalPoints) {
            return (string) $top;
        }

        return HuntZones::nearest($cx, $cy, 2000);
    }
}
