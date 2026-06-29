<?php

namespace Database\Seeders;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Services\EntryService;
use Illuminate\Database\Seeder;

/**
 * Illustrative, publishable sample entries that demonstrate the full Tibia
 * Atlas editorial structure (Canon · Interpretations · Theories · Sources) in
 * both languages, plus related creatures / NPCs and creature sprites. Treat the
 * prose as DEMO content to be re-verified by editors — accuracy over completeness.
 */
class LoreSeeder extends Seeder
{
    /** TibiaWiki file proxy — redirects to the real image, works in <img src>. */
    private function img(string $file): string
    {
        return 'https://tibia.fandom.com/wiki/Special:FilePath/'.$file;
    }

    public function run(): void
    {
        $service = app(EntryService::class);
        $userId = null;

        $thais = $service->create([
            'slug' => 'thais',
            'type' => EntryType::City->value,
            'status' => EntryStatus::Published->value,
            'featured' => true,
            'meta' => ['region' => 'Central Tibia', 'continent' => 'Mainland'],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'Thais',
                    'overview' => 'Thais is one of the oldest and most important human cities of Tibia and the historical seat of the Tibian crown.',
                    'canon' => 'Thais is presented in official Tibia material as the capital city ruled by the royal line, with King Tibianus as its monarch. It is a starting region for new adventurers.',
                    'interpretations' => 'Given its royal seat and central location, Thais can reasonably be read as the political heart of human civilization on the mainland.',
                    'theories' => 'Some community discussions speculate about Thais\' founding predating other human settlements; this remains unconfirmed.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Thais',
                    'overview' => 'Thais es una de las ciudades humanas más antiguas e importantes de Tibia y la sede histórica de la corona tibiana.',
                    'canon' => 'El material oficial de Tibia presenta a Thais como la ciudad capital gobernada por la línea real, con el Rey Tibianus como monarca. Es una región inicial para nuevos aventureros.',
                    'interpretations' => 'Dada su sede real y ubicación central, Thais puede interpretarse razonablemente como el corazón político de la civilización humana en el continente.',
                    'theories' => 'Algunas discusiones de la comunidad especulan que la fundación de Thais precede a otros asentamientos humanos; esto no está confirmado.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia — Cities', 'url' => 'https://www.tibia.com'],
                ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Thais', 'url' => 'https://tibia.fandom.com/wiki/Thais'],
            ],
        ], $userId);

        $tibianus = $service->create([
            'slug' => 'king-tibianus',
            'type' => EntryType::Character->value,
            'status' => EntryStatus::Published->value,
            'primary_image' => $this->img('King_Tibianus.gif'),
            'meta' => ['affiliation' => 'Kingdom of Thais', 'title' => 'King'],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'King Tibianus',
                    'overview' => 'King Tibianus is the ruling monarch associated with the city of Thais.',
                    'canon' => 'Official material references King Tibianus as the king seated in Thais.',
                    'interpretations' => 'As the named monarch of the capital, he functions as the symbolic head of the human kingdom.',
                    'theories' => 'Numbering and lineage of successive kings named Tibianus is debated by the community.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Rey Tibianus',
                    'overview' => 'El Rey Tibianus es el monarca gobernante asociado a la ciudad de Thais.',
                    'canon' => 'El material oficial menciona al Rey Tibianus como el rey con sede en Thais.',
                    'interpretations' => 'Como el monarca nombrado de la capital, funciona como la cabeza simbólica del reino humano.',
                    'theories' => 'La numeración y el linaje de los sucesivos reyes llamados Tibianus es debatida por la comunidad.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: King Tibianus', 'url' => 'https://tibia.fandom.com/wiki/King_Tibianus'],
            ],
            'related_entry_ids' => [$thais->id],
        ], $userId);

        // --- Demon lords, used as "related creatures / NPCs" of the Demon entry ---

        $ferumbras = $service->create([
            'slug' => 'ferumbras',
            'type' => EntryType::Character->value,
            'status' => EntryStatus::Published->value,
            'primary_image' => $this->img('Ferumbras.gif'),
            'meta' => ['classification' => 'Archdemon', 'rank' => 'Boss', 'hitpoints' => 90000, 'experience' => 35000],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'Ferumbras',
                    'overview' => 'Ferumbras is one of the most infamous antagonists of Tibia, a powerful archdemon-sorcerer.',
                    'canon' => 'Ferumbras appears in official Tibia content as a recurring raid and boss figure tied to demonic power.',
                    'interpretations' => 'His recurring returns frame him as an enduring demonic threat rather than a one-time villain.',
                    'theories' => 'Community lore connects Ferumbras to wider demonic hierarchies; specifics remain unconfirmed.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Ferumbras',
                    'overview' => 'Ferumbras es uno de los antagonistas más infames de Tibia, un poderoso archidemonio hechicero.',
                    'canon' => 'Ferumbras aparece en el contenido oficial de Tibia como una figura recurrente de raids y jefes ligada al poder demoníaco.',
                    'interpretations' => 'Sus retornos recurrentes lo presentan como una amenaza demoníaca perdurable, no un villano de una sola vez.',
                    'theories' => 'El lore de la comunidad conecta a Ferumbras con jerarquías demoníacas más amplias; los detalles no están confirmados.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Ferumbras', 'url' => 'https://tibia.fandom.com/wiki/Ferumbras'],
            ],
        ], $userId);

        $orshabaal = $service->create([
            'slug' => 'orshabaal',
            'type' => EntryType::Creature->value,
            'status' => EntryStatus::Published->value,
            'primary_image' => $this->img('Orshabaal.gif'),
            'meta' => ['classification' => 'Demon', 'rank' => 'Boss', 'hitpoints' => 22000, 'experience' => 15000],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'Orshabaal',
                    'overview' => 'Orshabaal is a legendary demonic boss, historically one of Tibia\'s most feared raid bosses.',
                    'canon' => 'Orshabaal appears in official content as a powerful demon boss summoned in raids.',
                    'interpretations' => 'Its status places it among the upper ranks of demonic creatures.',
                    'theories' => 'Fan lore ties Orshabaal to a broader demonic pantheon; unconfirmed.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Orshabaal',
                    'overview' => 'Orshabaal es un jefe demoníaco legendario, históricamente uno de los jefes de raid más temidos de Tibia.',
                    'canon' => 'Orshabaal aparece en el contenido oficial como un poderoso jefe demonio invocado en raids.',
                    'interpretations' => 'Su estatus lo coloca entre los rangos superiores de las criaturas demoníacas.',
                    'theories' => 'El lore de fans vincula a Orshabaal con un panteón demoníaco más amplio; no confirmado.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Orshabaal', 'url' => 'https://tibia.fandom.com/wiki/Orshabaal'],
            ],
        ], $userId);

        $apoc = $service->create([
            'slug' => 'apoc',
            'type' => EntryType::Character->value,
            'status' => EntryStatus::Published->value,
            'meta' => ['title' => 'Knight', 'affiliation' => 'Tibia Library'],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'Apoc',
                    'overview' => 'Apoc is a famous knight of Tibia, quoted in the official Tibia Library for his vivid accounts of the world\'s deadliest creatures.',
                    'canon' => 'The official Tibia Library attributes to the knight Apoc detailed descriptions of creatures such as the Demon, presented as first-hand observations.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Apoc',
                    'overview' => 'Apoc es un famoso caballero de Tibia, citado en la Library oficial de Tibia por sus vívidos relatos sobre las criaturas más mortíferas del mundo.',
                    'canon' => 'La Library oficial de Tibia atribuye al caballero Apoc descripciones detalladas de criaturas como el Demonio, presentadas como observaciones de primera mano.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::OfficialArticle->value, 'title' => 'Tibia Library — Creatures', 'url' => 'https://www.tibia.com/library/?subtopic=creatures'],
            ],
        ], $userId);

        $zathroth = $service->create([
            'slug' => 'zathroth',
            'type' => EntryType::Concept->value,
            'status' => EntryStatus::Published->value,
            'meta' => ['classification' => 'Deity'],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'Zathroth',
                    'overview' => 'Zathroth is one of the creator gods of Tibian myth, associated with destruction, dark magic and the demonic.',
                    'canon' => 'In Tibia\'s mythology Zathroth is counted among the gods who shaped the world. Demons are described as his servants.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Zathroth',
                    'overview' => 'Zathroth es uno de los dioses creadores del mito tibiano, asociado a la destrucción, la magia oscura y lo demoníaco.',
                    'canon' => 'En la mitología de Tibia, Zathroth se cuenta entre los dioses que dieron forma al mundo. Los demonios se describen como sus sirvientes.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Zathroth', 'url' => 'https://tibia.fandom.com/wiki/Zathroth'],
            ],
        ], $userId);

        $service->create([
            'slug' => 'demon',
            'type' => EntryType::Creature->value,
            'status' => EntryStatus::Published->value,
            'featured' => true,
            'primary_image' => $this->img('Demon.gif'),
            'meta' => [
                'classification' => 'Demon',
                'hitpoints' => 8200,
                'experience' => 6000,
                'immune_to' => 'Fire',
                'weak_to' => 'Holy, Ice',
                'battle_cry' => 'CHAMEK ATH UTHUL ARAK!',
            ],
            'translations' => [
                [
                    'locale' => Locale::English->value,
                    'name' => 'Demon',
                    'overview' => 'Demons are among the most malevolent, powerful and dangerous creatures in Tibia — servants of evil that leave a trail of death and destruction wherever they appear.',
                    'canon' => <<<'TXT'
The official Tibia Library preserves the words of the famous knight Apoc: "Demons are the most malevolent, powerful, and dangerous creatures in Tibia. In addition to their awesome physical strength, they can also use powerful spells, such as fireballs and fire fields. Especially dangerous is their gaze, which can produce beams of pure energy to annihilate their poor victims. Moreover, they drain mana off their victims, heal themselves and summon fire elementals as their vassals." They usually dwell in the deepest dungeons near hell, but sometimes appear on the surface, leaving death and destruction behind them.

In combat, a Demon has 8,200 hitpoints and yields 6,000 experience. It is immune to fire damage and cannot be paralysed; it is strong against death, earth, energy and physical damage, and weak to holy and ice. Demons can neither be summoned nor convinced, and they can sense invisible creatures.

TibiaWiki documents Demons as the servants of evil — more or less devoted servants of Zathroth — whose masters are known as Demonlords, Demon Overlords and Archdemons. They shout "CHAMEK ATH UTHUL ARAK!", meaning "Sacrifice your blood!". A Blessed Wooden Stake used on a slain Demon has a chance to gather Demon Dust.
TXT,
                    'interpretations' => 'Their devotion to Zathroth and their position beneath Demonlords and Archdemons frame ordinary Demons as the foot-soldiers of a larger infernal hierarchy rather than independent agents. The repeated emphasis on dungeons "near hell" suggests an otherworldly, planar origin rather than native Tibian fauna.',
                    'theories' => 'Community lore often maps individual Demons and bosses onto a structured demonic pantheon led by named Archdemons such as Ferumbras, Orshabaal and Morgaroth. While each of those bosses is canonical, the precise chain of command between them and the rank-and-file Demon is largely fan-assembled and should be treated as unconfirmed.',
                ],
                [
                    'locale' => Locale::Spanish->value,
                    'name' => 'Demonio',
                    'overview' => 'Los demonios están entre las criaturas más malévolas, poderosas y peligrosas de Tibia: sirvientes del mal que dejan un rastro de muerte y destrucción allá donde aparecen.',
                    'canon' => <<<'TXT'
La Library oficial de Tibia conserva las palabras del famoso caballero Apoc: "Los demonios son las criaturas más malévolas, poderosas y peligrosas de Tibia. Además de su asombrosa fuerza física, también pueden usar poderosos hechizos, como bolas de fuego y campos de fuego. Especialmente peligrosa es su mirada, que puede producir rayos de energía pura para aniquilar a sus pobres víctimas. Además, drenan el maná de sus víctimas, se curan a sí mismos e invocan elementales de fuego como vasallos." Suelen habitar en las mazmorras más profundas cerca del infierno, pero a veces aparecen en la superficie, dejando muerte y destrucción tras de sí.

En combate, un Demonio tiene 8.200 puntos de vida y otorga 6.000 de experiencia. Es inmune al daño de fuego y no puede ser paralizado; es fuerte contra el daño de muerte, tierra, energía y físico, y débil ante el sagrado y el hielo. Los demonios no pueden ser invocados ni convencidos, y pueden detectar a las criaturas invisibles.

TibiaWiki documenta a los demonios como los sirvientes del mal —sirvientes más o menos devotos de Zathroth— cuyos amos se conocen como Señores Demonio, Soberanos Demonio y Archidemonios. Gritan "CHAMEK ATH UTHUL ARAK!", que significa "¡Sacrifica tu sangre!". Usar una Estaca de Madera Bendita sobre un Demonio abatido tiene una probabilidad de obtener Polvo de Demonio (Demon Dust).
TXT,
                    'interpretations' => 'Su devoción a Zathroth y su posición por debajo de los Señores Demonio y Archidemonios presentan a los demonios comunes como la tropa de una jerarquía infernal mayor, más que como agentes independientes. El énfasis repetido en mazmorras "cerca del infierno" sugiere un origen de otro plano, no fauna nativa de Tibia.',
                    'theories' => 'El lore de la comunidad suele asignar demonios y jefes individuales a un panteón demoníaco estructurado, liderado por Archidemonios con nombre como Ferumbras, Orshabaal y Morgaroth. Aunque cada uno de esos jefes es canónico, la cadena de mando precisa entre ellos y el demonio común es en gran parte ensamblada por fans y debe tratarse como no confirmada.',
                ],
            ],
            'sources' => [
                ['type' => SourceType::OfficialArticle->value, 'title' => 'Tibia Library — Creatures: Demon', 'url' => 'https://www.tibia.com/library/?subtopic=creatures&race=demon', 'note' => 'Description by the knight Apoc; combat statistics.'],
                ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Demon', 'url' => 'https://tibia.fandom.com/wiki/Demon', 'note' => 'Servants of Zathroth; battle cry; Demon Dust.'],
            ],
            'related_entry_ids' => [$orshabaal->id, $ferumbras->id, $apoc->id, $zathroth->id, $thais->id],
        ], $userId);
    }
}
