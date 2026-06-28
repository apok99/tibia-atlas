<?php

namespace App\Console\Commands;

use App\Enums\EntryType;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;

class ImportFromTibiaWiki extends Command
{
    protected $signature = 'tibia:import {title : The TibiaWiki page title} {--type=creature : Entry type}';

    protected $description = 'Import a TibiaWiki page as a draft entry for editorial review';

    public function handle(TibiaWikiImporter $importer): int
    {
        $type = EntryType::tryFrom($this->option('type')) ?? EntryType::Creature;

        $this->info("Importing '{$this->argument('title')}' as {$type->value} draft…");

        $run = $importer->import($this->argument('title'), $type);

        if ($run->status === 'success') {
            $this->info($run->message);

            return self::SUCCESS;
        }

        $this->error($run->message ?? 'Import failed.');

        return self::FAILURE;
    }
}
