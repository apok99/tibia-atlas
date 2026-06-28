<?php

namespace App\Http\Requests;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEntryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'slug' => ['nullable', 'string', 'max:255', Rule::unique('entries', 'slug')],
            'type' => ['required', Rule::in(EntryType::values())],
            'status' => ['nullable', Rule::in(EntryStatus::values())],
            'featured' => ['boolean'],
            'primary_image' => ['nullable', 'string', 'max:2048'],
            'meta' => ['nullable', 'array'],

            // At least one locale is required; each follows the editorial sections.
            'translations' => ['required', 'array', 'min:1'],
            'translations.*.locale' => ['required', Rule::in(Locale::values())],
            'translations.*.name' => ['required', 'string', 'max:255'],
            'translations.*.overview' => ['nullable', 'string'],
            'translations.*.canon' => ['nullable', 'string'],
            'translations.*.interpretations' => ['nullable', 'string'],
            'translations.*.theories' => ['nullable', 'string'],
            'translations.*.research_gaps' => ['nullable', 'string'],

            'sources' => ['nullable', 'array'],
            'sources.*.type' => ['required', Rule::in(SourceType::values())],
            'sources.*.title' => ['required', 'string', 'max:255'],
            'sources.*.url' => ['nullable', 'url', 'max:2048'],
            'sources.*.note' => ['nullable', 'string'],

            'related_entry_ids' => ['nullable', 'array'],
            'related_entry_ids.*' => ['integer', 'exists:entries,id'],
        ];
    }
}
