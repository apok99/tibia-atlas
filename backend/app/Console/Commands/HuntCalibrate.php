<?php

namespace App\Console\Commands;

use App\Services\Hunt\HuntFinder;
use Illuminate\Console\Command;

/**
 * Mide el Hunt Finder contra la guía de caza de la comunidad
 * (`database/data/hunt-guide/`), que es el único ground truth que tenemos: los
 * pesos de HuntFinder se afinaron a ojo hasta ahora.
 *
 *   php artisan tibia:hunt-calibrate [--vocation=knight] [--misses] [--exp]
 *
 * Reporta tres cosas distintas, que NO hay que mezclar:
 *  - cobertura: cuántas zonas de la guía sabemos siquiera nombrar.
 *  - recall: de las que sabemos nombrar, cuántas recomendamos al nivel que la
 *    guía dice. Un fallo acá es del scoring.
 *  - elemento: si coincidimos en con qué pegarle. Un fallo acá es de offense().
 *
 * Es una herramienta de tuning, no un test: corre contra la DB real (el suite
 * usa sqlite en memoria y no tiene criaturas ni spawns).
 */
class HuntCalibrate extends Command
{
    protected $signature = 'tibia:hunt-calibrate
        {--vocation= : Solo esta vocación (knight|paladin|monk|sorcerer|druid)}
        {--misses : Listar las zonas que la guía recomienda y nosotros no}
        {--exp : Comparar exp/h contra los números reales de la guía}';

    protected $description = 'Mide el Hunt Finder contra la guía de caza de la comunidad';

    /** Elementos que sabemos comparar; el resto de la recomendación (munición, playstyle) se ignora. */
    private const ELEMENTS = ['physical', 'fire', 'ice', 'earth', 'energy', 'death', 'holy'];

    /** Sin tope: queremos el ranking entero, no lo que entra en pantalla. */
    private const ALL_ZONES = 100_000;

    /** Cuántas zonas ve el usuario. Salir acá adentro = la recomendamos de verdad. */
    private const SHOWN = 24;

    private string $dir;

    /** @var array<string, string|null> */
    private array $aliasMap = [];

    /** Cache de corridas del finder, por "vocacion:nivel" — cada una puntúa 775 criaturas. */
    private array $runs = [];

    public function handle(HuntFinder $finder): int
    {
        $this->dir = database_path('data/hunt-guide');
        $this->aliasMap = require $this->dir.'/aliases.php';

        $vocations = $this->option('vocation')
            ? [(string) $this->option('vocation')]
            : ['knight', 'paladin', 'monk', 'sorcerer', 'druid'];

        $totals = ['rows' => 0, 'unmappable' => 0, 'unresolved' => 0, 'hit' => 0, 'miss' => 0, 'elOk' => 0, 'elCmp' => 0];
        $expErrors = [];

        foreach ($vocations as $vocation) {
            $rows = $this->load($vocation);
            if ($rows === []) {
                $this->warn("Sin datos para {$vocation}.");

                continue;
            }

            $stat = ['rows' => 0, 'unmappable' => 0, 'unresolved' => 0, 'hit' => 0, 'miss' => 0, 'elOk' => 0, 'elCmp' => 0];
            $misses = [];

            foreach ($rows as $row) {
                $stat['rows']++;
                $key = mb_strtolower($row['zone']);

                // Alias a null = sabemos que no tiene equivalente (contenido que
                // canary no trae). No es lo mismo que "no lo encontramos".
                if (array_key_exists($key, $this->aliasMap) && $this->aliasMap[$key] === null) {
                    $stat['unmappable']++;

                    continue;
                }

                $zones = $this->zonesFor($finder, $vocation, $row['level']);
                $zone = $this->match($row['zone'], $zones);

                if ($zone === null) {
                    // No sale ni en el ranking completo a este nivel. Si tampoco
                    // sale a ningún otro, no sabemos nombrarla y es un agujero
                    // de data; si sale a otro nivel, el fallo es del scoring.
                    if ($this->knownAtAnyLevel($finder, $vocation, $row['zone'])) {
                        $stat['miss']++;
                        $misses[] = sprintf('%4d+ %-38s (fuera del ranking)', $row['level'], $row['zone']);
                    } else {
                        $stat['unresolved']++;
                    }

                    continue;
                }

                // La conocemos, pero ¿la recomendaríamos? El usuario solo ve las
                // primeras SHOWN — salir 80º es tan inútil como no salir.
                if ($zone['id'] >= self::SHOWN) {
                    $stat['miss']++;
                    $misses[] = sprintf('%4d+ %-38s (puesto %d)', $row['level'], $row['zone'], $zone['id'] + 1);

                    continue;
                }

                $stat['hit']++;

                $guideEls = $this->elementsOf($row['advice']);
                if ($guideEls !== []) {
                    $stat['elCmp']++;
                    if (array_intersect($guideEls, $this->ourElements($zone)) !== []) {
                        $stat['elOk']++;
                    }
                }

                if ($this->option('exp') && $row['exp_h'] !== null && $zone['exp_h'] > 0) {
                    $expErrors[] = [
                        'voc' => $vocation, 'lvl' => $row['level'], 'zone' => $row['zone'],
                        'real' => $row['exp_h'], 'ours' => $zone['exp_h'],
                        'err' => ($zone['exp_h'] - $row['exp_h']) / $row['exp_h'],
                    ];
                }
            }

            $this->report($vocation, $stat);
            if ($this->option('misses') && $misses !== []) {
                $this->line('   no recomendadas al nivel de la guía:');
                foreach (array_slice($misses, 0, 15) as $m) {
                    $this->line('     '.$m);
                }
                if (count($misses) > 15) {
                    $this->line(sprintf('     … y %d más', count($misses) - 15));
                }
            }

            foreach ($stat as $k => $v) {
                $totals[$k] += $v;
            }
        }

        $this->newLine();
        $this->report('TOTAL', $totals);

        if ($expErrors !== []) {
            $this->expReport($expErrors);
        }

        return self::SUCCESS;
    }

    /**
     * @return list<array{level:int, zone:string, exp_h:?int, profit_h:?int, advice:string}>
     */
    private function load(string $vocation): array
    {
        $path = $this->dir."/{$vocation}.txt";
        if (! is_file($path)) {
            return [];
        }

        $rows = [];
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $parts = explode('|', $line);
            if (count($parts) < 5) {
                continue;
            }
            $rows[] = [
                'level' => (int) $parts[0],
                'zone' => trim($parts[1]),
                'exp_h' => $this->amount($parts[2]),
                'profit_h' => $this->amount($parts[3]),
                'advice' => trim($parts[4]),
            ];
        }

        return $rows;
    }

    /** "3.5kk" → 3500000, "550k" → 550000, "-200k" → -200000, "-" → null. */
    private function amount(string $raw): ?int
    {
        $v = mb_strtolower(trim($raw));
        if ($v === '' || $v === '-' || $v === 'n/a') {
            return null;
        }
        if (! preg_match('/^(-?[\d.]+)\s*(kk|k)?$/', $v, $m)) {
            return null;
        }
        $mult = match ($m[2] ?? '') {
            'kk' => 1_000_000,
            'k' => 1_000,
            default => 1,
        };

        return (int) round(((float) $m[1]) * $mult);
    }

    /**
     * Corre el finder una vez por vocación+nivel — cada corrida puntúa toda la
     * bestiary. Pide la lista COMPLETA de zonas, no el top-24 de la UI: acá hay
     * que distinguir "esta zona no existe en nuestra data" de "existe pero sale
     * 40ª", y con la lista cortada las dos se ven igual.
     */
    private function zonesFor(HuntFinder $finder, string $vocation, int $level): array
    {
        $key = "{$vocation}:{$level}";

        return $this->runs[$key] ??= $finder->find($level, $vocation, 'solo', 'es', [], self::ALL_ZONES)['zones'];
    }

    /**
     * ¿Sabemos nombrar esta zona, aunque sea mal rankeada o a otro nivel? Si
     * nunca aparece es un agujero de data; si aparece pero no la recomendamos
     * al nivel de la guía, es el scoring. Son dos fallos distintos.
     */
    private function knownAtAnyLevel(HuntFinder $finder, string $vocation, string $guideName): bool
    {
        foreach ([1000, 600, 300, 100, 8] as $level) {
            if ($this->match($guideName, $this->zonesFor($finder, $vocation, $level)) !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * Resuelve un nombre de la guía a una zona nuestra: alias curado, o nombre
     * idéntico (normalizado). NADA de "uno contiene al otro" — ese fallback
     * casaba "Edron Forgotten Tomb" con el landmark "Edron" y colapsaba tres
     * filas distintas de Yalahar sobre una sola zona, inflando la cobertura con
     * matches gruesos. Si no hay alias ni nombre igual, es que NO sabemos
     * nombrar esa zona (o la guía es más fina que nuestro clustering, p.ej.
     * "Ingol -3" vs nuestra "Ingol"), y eso debe contar como no-resuelto, no
     * como acierto. Los casos legítimos se resuelven agregándolos a aliases.php.
     */
    private function match(string $guideName, array $zones): ?array
    {
        $key = mb_strtolower($guideName);
        $target = $this->aliasMap[$key] ?? null;

        foreach ($zones as $zone) {
            if ($target !== null) {
                if ($zone['name'] !== null && $zone['name'] === $target) {
                    return $zone;
                }

                continue;
            }
            if ($zone['name'] !== null && $this->loose($zone['name']) === $this->loose($guideName)) {
                return $zone;
            }
        }

        return null;
    }

    /**
     * Normaliza para comparar: sin artículo, sin puntuación, sin dobles
     * espacios. Acepta null porque, fuera del top-24, hay clusters que se
     * quedan sin nombre — `HuntZones::nearest` devuelve null incluso con radio
     * 2000 si no hay nada cerca.
     */
    private function loose(?string $s): string
    {
        $s = mb_strtolower(trim((string) $s));
        $s = (string) preg_replace('/^the\s+/', '', $s);
        $s = (string) preg_replace('/[^a-z0-9 ]/', ' ', $s);

        return trim((string) preg_replace('/\s+/', ' ', $s));
    }

    /**
     * Los elementos que menciona la recomendación. La guía mezcla elemento con
     * munición e hechizos ("Diamond Arrows, Divine", "Forked Thorns + Forked
     * Glacier"), y solo el elemento es comparable — el resto se ignora.
     *
     * @return list<string>
     */
    private function elementsOf(string $advice): array
    {
        $a = mb_strtolower($advice);
        $out = [];
        foreach (self::ELEMENTS as $el) {
            if (str_contains($a, $el)) {
                $out[] = $el;
            }
        }

        return $out;
    }

    /**
     * Con qué elementos decimos nosotros que hay que pegarle acá: los de los
     * residentes más comunes (los 3 mejores por score).
     *
     * @return list<string>
     */
    private function ourElements(array $zone): array
    {
        $out = [];
        foreach (array_slice($zone['creatures'], 0, 3) as $c) {
            foreach ($c['hit_with'] ?? [] as $el) {
                $out[] = $el;
            }
        }

        return array_values(array_unique($out));
    }

    private function report(string $label, array $s): void
    {
        $mappable = $s['rows'] - $s['unmappable'];
        $named = $s['hit'] + $s['miss'];
        $pct = fn (int $n, int $d) => $d > 0 ? sprintf('%5.1f%%', 100 * $n / $d) : '    - ';

        $this->line(sprintf(
            '%-9s %3d filas | sin data en canary %2d | no sabemos nombrar %3d | cobertura %s | recall %s (%d/%d) | elemento %s (%d/%d)',
            $label, $s['rows'], $s['unmappable'], $s['unresolved'],
            $pct($named, $mappable),
            $pct($s['hit'], $named), $s['hit'], $named,
            $pct($s['elOk'], $s['elCmp']), $s['elOk'], $s['elCmp'],
        ));
    }

    private function expReport(array $errors): void
    {
        usort($errors, fn ($a, $b) => abs($a['err']) <=> abs($b['err']));
        $abs = array_map(fn ($e) => abs($e['err']), $errors);
        $median = $abs[intdiv(count($abs), 2)];
        $within30 = count(array_filter($abs, fn ($e) => $e <= 0.30));

        $this->newLine();
        $this->info(sprintf(
            'exp/h contra %d números reales: error mediano %.0f%%, dentro de ±30%% %d (%.0f%%)',
            count($errors), 100 * $median, $within30, 100 * $within30 / count($errors)
        ));
        $this->line(sprintf('%-9s %-34s %10s %10s %8s', 'voc', 'zona', 'real', 'nuestro', 'error'));
        foreach ($errors as $e) {
            $this->line(sprintf(
                '%-9s %-34s %10s %10s %+7.0f%%',
                $e['voc'], mb_substr($e['zone'], 0, 34),
                number_format($e['real']), number_format($e['ours']), 100 * $e['err']
            ));
        }
    }
}
