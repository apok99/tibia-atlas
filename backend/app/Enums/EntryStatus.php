<?php

namespace App\Enums;

/**
 * Editorial workflow state of an Entry.
 */
enum EntryStatus: string
{
    case Draft = 'draft';
    case InReview = 'in_review';
    case Published = 'published';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $s) => $s->value, self::cases());
    }
}
