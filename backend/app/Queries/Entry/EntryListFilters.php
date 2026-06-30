<?php

namespace App\Queries\Entry;

use Illuminate\Http\Request;

/**
 * Immutable bag of bestiary/listing filters parsed from the request, so the
 * listing query has a typed input instead of reaching into the HTTP layer.
 */
class EntryListFilters
{
    public function __construct(
        public readonly ?string $q = null,
        public readonly ?string $type = null,
        public readonly bool $featuredOnly = false,
        public readonly ?string $classification = null,
        public readonly ?bool $boss = null,
    ) {}

    public static function fromRequest(Request $request): self
    {
        return new self(
            q: $request->filled('q') ? (string) $request->string('q') : null,
            type: $request->filled('type') ? (string) $request->string('type') : null,
            featuredOnly: $request->boolean('featured'),
            classification: $request->filled('classification') ? (string) $request->string('classification') : null,
            boss: $request->filled('boss') ? $request->boolean('boss') : null,
        );
    }
}
