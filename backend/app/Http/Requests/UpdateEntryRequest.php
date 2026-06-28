<?php

namespace App\Http\Requests;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateEntryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $entryId = $this->route('entry')?->id;

        return [
            'slug' => ['sometimes', 'string', 'max:255', Rule::unique('entries', 'slug')->ignore($entryId)],
            'type' => ['sometimes', Rule::in(EntryType::values())],
            'status' => ['sometimes', Rule::in(EntryStatus::values())],
            'featured' => ['sometimes', 'boolean'],
            'primary_image' => ['nullable', 'string', 'max:2048'],
            'meta' => ['nullable', 'array'],

            'translations' => ['sometimes', 'array', 'min:1'],
            'translations.*.locale' => ['required', Rule::in(Locale::values())],
            'translations.*.name' => ['required', 'string', 'max:255'],
            'translations.*.overview' => ['nullable', 'string'],
            'translations.*.canon' => ['nullable', 'string'],
            'translations.*.interpretations' => ['nullable', 'string'],
            'translations.*.theories' => ['nullable', 'string'],
            'translations.*.research_gaps' => ['nullable', 'string'],

            'sources' => ['sometimes', 'array'],
            'sources.*.type' => ['required', Rule::in(SourceType::values())],
            'sources.*.title' => ['required', 'string', 'max:255'],
            'sources.*.url' => ['nullable', 'url', 'max:2048'],
            'sources.*.note' => ['nullable', 'string'],

            'related_entry_ids' => ['sometimes', 'array'],
            'related_entry_ids.*' => ['integer', 'exists:entries,id'],
        ];
    }
}
