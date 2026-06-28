<?php

namespace App\Enums;

/**
 * Supported content locales. The whole project is bilingual ES/EN.
 */
enum Locale: string
{
    case Spanish = 'es';
    case English = 'en';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $l) => $l->value, self::cases());
    }
}
