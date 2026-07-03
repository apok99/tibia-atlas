<?php

namespace App\Enums;

/**
 * The kind of lore subject an Entry documents.
 */
enum EntryType: string
{
    case Creature = 'creature';
    case Npc = 'npc';
    case Character = 'character';
    case City = 'city';
    case Location = 'location';
    case Organization = 'organization';
    case Quest = 'quest';
    case Event = 'event';
    case Item = 'item';
    case Concept = 'concept';

    /**
     * Human-readable labels per locale, used for filters and navigation.
     *
     * @return array{es: string, en: string}
     */
    public function labels(): array
    {
        return match ($this) {
            self::Creature => ['es' => 'Criatura', 'en' => 'Creature'],
            self::Npc => ['es' => 'NPC', 'en' => 'NPC'],
            self::Character => ['es' => 'Personaje', 'en' => 'Character'],
            self::City => ['es' => 'Ciudad', 'en' => 'City'],
            self::Location => ['es' => 'Lugar', 'en' => 'Location'],
            self::Organization => ['es' => 'Organización', 'en' => 'Organization'],
            self::Quest => ['es' => 'Misión', 'en' => 'Quest'],
            self::Event => ['es' => 'Evento histórico', 'en' => 'Historical event'],
            self::Item => ['es' => 'Objeto', 'en' => 'Item'],
            self::Concept => ['es' => 'Concepto', 'en' => 'Concept'],
        };
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $t) => $t->value, self::cases());
    }
}
