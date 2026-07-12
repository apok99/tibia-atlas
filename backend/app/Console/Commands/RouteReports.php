<?php

namespace App\Console\Commands;

use App\Models\RouteReport;
use Illuminate\Console\Command;

/**
 * Read back the route-bug reports submitted from the map's "Reportar" button so
 * routing bugs can be triaged and fixed. Prints each report with its endpoints,
 * the user's note, the computed itinerary summary and the map URL hash (paste it
 * after /map#... to reproduce the exact route).
 *
 *   php artisan tibia:route-reports                 # open reports, newest first
 *   php artisan tibia:route-reports --all           # include resolved/wontfix
 *   php artisan tibia:route-reports --resolve=12,15 # mark reports resolved
 *   php artisan tibia:route-reports --limit=50
 */
class RouteReports extends Command
{
    protected $signature = 'tibia:route-reports
        {--all : Include already-resolved / wontfix reports}
        {--limit=30 : How many reports to show}
        {--resolve= : Comma-separated report ids to mark as resolved}';

    protected $description = 'List map route-bug reports (from the "Reportar" button) so routing can be fixed';

    public function handle(): int
    {
        // --resolve short-circuits: flip the given ids and report how many changed.
        if ($ids = array_filter(array_map('trim', explode(',', (string) $this->option('resolve'))))) {
            $n = RouteReport::whereIn('id', $ids)->update(['status' => 'resolved']);
            $this->info("Marked {$n} report(s) resolved.");

            return self::SUCCESS;
        }

        $q = RouteReport::query()->latest();
        if (! $this->option('all')) {
            $q->where('status', 'open');
        }
        $reports = $q->limit((int) $this->option('limit'))->get();

        if ($reports->isEmpty()) {
            $this->info($this->option('all') ? 'No route reports.' : 'No open route reports. 🎉');

            return self::SUCCESS;
        }

        $this->line("<fg=cyan>{$reports->count()} route report(s):</>");
        $this->newLine();

        foreach ($reports as $r) {
            $from = $this->endpoint($r->from_x, $r->from_y, $r->from_floor, $r->from_label);
            $to = $this->endpoint($r->to_x, $r->to_y, $r->to_floor, $r->to_label);
            $flag = $r->partial ? ' <fg=yellow>[partial]</>' : '';
            $dist = $r->total_tiles !== null ? " · {$r->total_tiles} tiles" : '';
            $when = $r->created_at?->diffForHumans();

            $this->line("<fg=green>#{$r->id}</> <fg=white>{$from}</> → <fg=white>{$to}</>{$flag}{$dist}");
            $this->line("     <fg=gray>{$when} · status={$r->status} · lang={$r->lang} · ip={$r->ip}</>");

            if ($r->note) {
                $this->line("     <fg=yellow>“{$r->note}”</>");
            }

            // Itinerary summary: one line per non-trivial leg.
            foreach ($this->itinerary($r->plan) as $line) {
                $this->line("     <fg=gray>·</> {$line}");
            }

            if ($r->hash) {
                $this->line("     <fg=blue>/map#{$r->hash}</>");
            }
            $this->newLine();
        }

        $this->line('<fg=gray>Resolve with: php artisan tibia:route-reports --resolve=ID,ID</>');

        return self::SUCCESS;
    }

    private function endpoint(int $x, int $y, int $floor, ?string $label): string
    {
        $coords = "{$x},{$y},z{$floor}";

        return $label ? "{$label} ({$coords})" : $coords;
    }

    /** Human-readable leg lines from the stored plan summary. */
    private function itinerary(?array $plan): array
    {
        $legs = $plan['legs'] ?? null;
        if (! is_array($legs)) {
            return [];
        }

        $out = [];
        foreach ($legs as $leg) {
            $kind = $leg['kind'] ?? '?';
            if ($kind === 'walk') {
                $tiles = $leg['tiles'] ?? 0;
                if ($tiles <= 2) {
                    continue; // skip trivial connector walks
                }
                $out[] = "walk {$tiles} tiles on z" . ($leg['floor'] ?? '?');
            } elseif ($kind === 'boat') {
                $line = $leg['lineName'] ?? 'boat';
                $to = $leg['toName'] ?? '?';
                $out[] = "boat: {$line} → {$to} (z" . ($leg['fromFloor'] ?? '?') . '→z' . ($leg['toFloor'] ?? '?') . ')';
            } elseif ($kind === 'stairs') {
                $tool = $leg['tool'] ?? null;
                $dir = $leg['dir'] ?? '?';
                $verb = $tool ? "{$tool}" : $dir;
                $from = $leg['from'] ?? null;
                $at = is_array($from) ? " at {$from['x']},{$from['y']}" : '';
                $out[] = "{$verb}: z" . ($leg['floor'] ?? '?') . '→z' . ($leg['toFloor'] ?? '?') . $at;
            }
        }

        return $out;
    }
}
