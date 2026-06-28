<?php

namespace App\Enums;

/**
 * Provenance of a cited source. Mirrors the Tibia Atlas editorial canon hierarchy:
 * official CipSoft material outranks the community wiki, which outranks open internet.
 */
enum SourceType: string
{
    case OfficialArticle = 'official_article';
    case CipsoftPublication = 'cipsoft_publication';
    case TibiaWiki = 'tibia_wiki';
    case Internet = 'internet';
    case Other = 'other';

    /**
     * Lower number = stronger canonical authority. Used to sort/flag sources.
     */
    public function authority(): int
    {
        return match ($this) {
            self::OfficialArticle => 1,
            self::CipsoftPublication => 1,
            self::TibiaWiki => 2,
            self::Internet => 3,
            self::Other => 4,
        };
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $t) => $t->value, self::cases());
    }
}
