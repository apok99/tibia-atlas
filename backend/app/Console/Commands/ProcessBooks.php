<?php

namespace App\Console\Commands;

use App\Models\Book;
use App\Services\Import\BookLoreAnalyzer;
use App\Services\Import\BookTranslator;
use Illuminate\Console\Command;

/**
 * Main books processing pipeline: translates books to Spanish in batches of 15
 * (to be polite with the free Google Translate endpoint) and marks each book
 * as lore-important when its content is relevant to Tibia's canonical lore.
 *
 *   php artisan tibia:process-books               (all untranslated, batches of 15)
 *   php artisan tibia:process-books --batch=30    (larger batches)
 *   php artisan tibia:process-books --sleep=200   (ms between each book)
 *   php artisan tibia:process-books --analyze-all (re-score ALL books without re-translating)
 */
class ProcessBooks extends Command
{
    protected $signature = 'tibia:process-books
        {--batch=15 : Books per batch}
        {--sleep=150 : Delay between books in milliseconds}
        {--analyze-all : Re-analyze lore importance for ALL books (no re-translation)}';

    protected $description = 'Translate books to Spanish in batches and mark lore-important ones';

    public function handle(BookTranslator $translator, BookLoreAnalyzer $analyzer): int
    {
        $batchSize = max(1, (int) $this->option('batch'));
        $sleepMs = (int) $this->option('sleep');
        $analyzeOnly = (bool) $this->option('analyze-all');

        if ($analyzeOnly) {
            return $this->runAnalyzeAll($analyzer);
        }

        return $this->runTranslateAndAnalyze($translator, $analyzer, $batchSize, $sleepMs);
    }

    private function runTranslateAndAnalyze(
        BookTranslator $translator,
        BookLoreAnalyzer $analyzer,
        int $batchSize,
        int $sleepMs,
    ): int {
        $total = Book::whereDoesntHave(
            'translations', fn ($t) => $t->where('locale', 'es')
        )->count();

        if ($total === 0) {
            $this->info('No hay libros pendientes de traducción.');
            $this->markUnscoredBooks($analyzer);

            return self::SUCCESS;
        }

        $batches = (int) ceil($total / $batchSize);
        $this->info(sprintf(
            '%d libros sin traducir → %d lotes de %d.',
            $total, $batches, $batchSize,
        ));
        $this->newLine();

        $done = 0;
        $loreCount = 0;

        for ($batch = 1; $batch <= $batches; $batch++) {
            $books = Book::with('translations')
                ->whereDoesntHave('translations', fn ($t) => $t->where('locale', 'es'))
                ->limit($batchSize)
                ->get();

            if ($books->isEmpty()) {
                break;
            }

            $this->line(sprintf(
                '<fg=yellow>Lote %d/%d</> — %d libros',
                $batch, $batches, $books->count(),
            ));

            $batchLore = 0;

            foreach ($books as $book) {
                $en = $book->translation('en');

                if (! $en || ! $en->text) {
                    $done++;
                    $this->line("  <fg=gray>omitido (sin texto EN): {$book->slug}</>");

                    continue;
                }

                // Lore analysis always uses the English original.
                $important = $analyzer->isLoreImportant(
                    $en->text, (string) $en->title, (string) $book->booktype,
                );
                $book->is_lore_important = $important;

                try {
                    $title = $en->title ? $translator->translate($en->title) : $en->title;
                    $text = $translator->translate($en->text);
                    $blurb = $en->blurb ? $translator->translate($en->blurb) : null;

                    $book->translations()->updateOrCreate(
                        ['locale' => 'es'],
                        ['title' => $title, 'text' => $text, 'blurb' => $blurb],
                    );
                } catch (\Throwable $e) {
                    $this->line("  <fg=red>error traduciendo {$book->slug}: {$e->getMessage()}</>");
                    // Still save the lore flag even if translation fails.
                }

                $book->save();

                $done++;

                if ($important) {
                    $batchLore++;
                    $loreCount++;
                    $this->line("  <fg=green>✓</> {$book->slug} <fg=yellow>★ lore importante</>");
                }

                if ($sleepMs > 0) {
                    usleep($sleepMs * 1000);
                }
            }

            $this->line(sprintf(
                '  → %d/%d (%d marcados lore)',
                $done, $total, $batchLore,
            ));
            $this->newLine();
        }

        $this->info(sprintf(
            'Completado. %d traducidos, %d marcados como lore importante.',
            $done, $loreCount,
        ));

        return self::SUCCESS;
    }

    /** Re-score ALL books for lore importance without re-translating. */
    private function runAnalyzeAll(BookLoreAnalyzer $analyzer): int
    {
        $books = Book::with('translations')->get();
        $this->info(sprintf('Analizando %d libros…', $books->count()));

        $loreCount = 0;

        foreach ($books as $book) {
            $en = $book->translation('en');
            if (! $en) {
                continue;
            }

            $important = $analyzer->isLoreImportant(
                (string) $en->text, (string) $en->title, (string) $book->booktype,
            );

            if ($important !== $book->is_lore_important) {
                $book->is_lore_important = $important;
                $book->save();
            }

            if ($important) {
                $loreCount++;
            }
        }

        $this->info(sprintf('%d libros marcados como lore importante.', $loreCount));

        return self::SUCCESS;
    }

    /** Mark lore importance for books that were translated before this feature. */
    private function markUnscoredBooks(BookLoreAnalyzer $analyzer): void
    {
        $unscored = Book::with('translations')->where('is_lore_important', false)->get();

        if ($unscored->isEmpty()) {
            return;
        }

        $this->line(sprintf('Puntuando %d libros ya traducidos…', $unscored->count()));
        $marked = 0;

        foreach ($unscored as $book) {
            $en = $book->translation('en');
            if (! $en) {
                continue;
            }
            $important = $analyzer->isLoreImportant(
                (string) $en->text, (string) $en->title, (string) $book->booktype,
            );
            if ($important) {
                $book->is_lore_important = true;
                $book->save();
                $marked++;
            }
        }

        if ($marked > 0) {
            $this->line(sprintf('  %d marcados como lore importante.', $marked));
        }
    }
}
