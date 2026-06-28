<?php

namespace App\Http\Resources;

use App\Models\Source;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Source
 */
class SourceResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type->value,
            'authority' => $this->type->authority(),
            'title' => $this->title,
            'url' => $this->url,
            'note' => $this->note,
        ];
    }
}
