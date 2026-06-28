<?php

namespace App\Services\Import;

/**
 * Classifies Tibia books as lore-important using a keyword scoring system.
 * Uses the ENGLISH text (always available as the original) for analysis.
 *
 * "Lore-important" = the book meaningfully contributes to our understanding
 * of Tibia's world, history, gods, races, or major events — not just a note
 * found on a shelf or a trade ledger.
 */
class BookLoreAnalyzer
{
    /**
     * Tibia god/deity names — each match scores 2 points.
     * A single god name mention is enough to classify a book as lore-relevant.
     */
    private const DEITIES = [
        'zathroth', 'uman', 'fardos', 'brog', 'crunor', 'nornur',
        'suon', 'toth', 'urgith', 'kirok', 'valhallen',
        // Major characters / figures
        'banor', 'arcanor', 'ferumbras', 'goshnar', 'orshabaal',
    ];

    /**
     * Strong lore concepts — each match scores 2 points.
     * Phrases specific enough that they almost always indicate canonical content.
     */
    private const STRONG_CONCEPTS = [
        'the void', 'void walker', 'sorcerer king', 'necromancer king',
        'demon overlord', 'chaos lord', 'chaos god', 'god of chaos',
        'creation of the world', 'end of the world', 'first creation',
        'age of creation', 'age of the gods', 'war of the gods',
        'the seven', 'seven pillars', 'seven gods',
        'the oracle', 'the knower', 'knower of secrets',
        'dark cathedral', 'apocalypse', 'armageddon', 'annihilator',
        'the order', 'demon oak', 'the demon',
    ];

    /**
     * General lore keywords — each match scores 1 point.
     * These need to combine with others to reach the threshold.
     */
    private const GENERAL_KEYWORDS = [
        'prophecy', 'prophecies', 'foretold', 'foretelling',
        'legend', 'legendary', 'sacred', 'divine', 'divinity',
        'forbidden', 'immortal', 'immortality', 'eternal', 'eternity',
        'primordial', 'ancient ones', 'ancient magic', 'ancient tome',
        'dark arts', 'forbidden magic', 'forbidden knowledge',
        'demonlord', 'demon lord', 'greater demon', 'lesser demon',
        'archangel', 'chosen one', 'the creator', 'the gods',
        'age of', 'first born', 'were created', 'creation myth',
        'history of tibia', 'history of the', 'chronicles of',
        'the race of', 'origin of', 'birth of',
        'dragon lord', 'dragon lair',
        'necromancy', 'unholy', 'cursed', 'seal of',
        'blood brothers', 'lich king', 'skeleton army',
        'djinn war', 'efreet', 'marid',
        'elven', 'elvenhiem', 'Ab\'Dendriel',
        'dwarven', 'kazordoon', 'dwarf king',
        'orc king', 'orc emperor',
    ];

    /**
     * booktype values that indicate a scholarly/historical document (+1 pt).
     */
    private const LORE_BOOKTYPES = [
        'scroll', 'tome', 'chronicle', 'ancient tome', 'parchment',
        'compendium', 'atlas',
    ];

    /**
     * Returns true when the book's content is lore-significant for Tibia.
     * Pass the ENGLISH title and text for best results.
     */
    public function isLoreImportant(string $text, string $title = '', string $booktype = ''): bool
    {
        return $this->score($text, $title, $booktype) >= 2;
    }

    private function score(string $text, string $title, string $booktype): int
    {
        $haystack = mb_strtolower($title.' '.$text);
        $score = 0;

        foreach (self::DEITIES as $name) {
            if (str_contains($haystack, $name)) {
                $score += 2;
            }
        }

        foreach (self::STRONG_CONCEPTS as $phrase) {
            if (str_contains($haystack, $phrase)) {
                $score += 2;
            }
        }

        foreach (self::GENERAL_KEYWORDS as $kw) {
            if (str_contains($haystack, $kw)) {
                $score += 1;
            }
        }

        $bt = mb_strtolower(trim($booktype));
        if (in_array($bt, self::LORE_BOOKTYPES, true)) {
            $score += 1;
        }

        return $score;
    }
}
