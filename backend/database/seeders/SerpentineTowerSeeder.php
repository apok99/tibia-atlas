<?php

namespace Database\Seeders;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Services\EntryService;
use Illuminate\Database\Seeder;

/**
 * The full Serpentine Tower article.
 *
 * The entry existed as a TibiaWiki stub whose text was the generic "Ankrahmun
 * has three library sections" intro — TibiaWiki redirects Serpentine Tower to
 * Ankrahmun Libraries, so the importer/stub-filler grabbed the wrong lead and
 * copied it into both overview and canon. This seeder replaces that with the
 * written article (ES + EN), its sources and its related entries.
 *
 * Every factual claim below is on TibiaWiki (Ankrahmun Libraries § Serpentine
 * Tower, Serpentine Tower Quest/Spoiler, Treasure Rooms, Portable Hole,
 * Tothdral, Mysteries) or in the official 7.3 update news; the framing prose is
 * editorial. Nothing about the unsolved levers is asserted as answered.
 *
 *   php artisan db:seed --class=SerpentineTowerSeeder
 *
 * Idempotent — re-running overwrites the article in place.
 */
class SerpentineTowerSeeder extends Seeder
{
    /** TibiaWiki file proxy — redirects to the real image, works in <img src>. */
    private function img(string $file): string
    {
        return 'https://tibia.fandom.com/wiki/Special:FilePath/'.rawurlencode($file);
    }

    public function run(): void
    {
        $service = app(EntryService::class);

        // Only link entries that are actually published — the sidebar would
        // otherwise point at draft item pages the public API won't serve.
        $relatedIds = Entry::published()
            ->whereIn('slug', [
                'ankrahmun',
                'tothdral',
                'fire-elemental',
                'vampire',
                'behemoth',
                'green-djinn',
            ])
            ->pluck('id')
            ->all();

        $payload = [
            'slug' => 'serpentine-tower',
            'type' => EntryType::Concept->value,
            'status' => EntryStatus::Published->value,
            'primary_image' => $this->img('Serpentine.JPG'),
            'meta' => [
                'region' => 'Ankrahmun',
                'continent' => 'Darama',
                'implemented' => '7.3 (2004)',
                // No `artwork`: the entry page labels that figure "official
                // artwork", and every image of this tower is a player
                // screenshot from TibiaWiki, not CipSoft art.
            ],
            'translations' => [
                ['locale' => Locale::English->value] + $this->en(),
                ['locale' => Locale::Spanish->value] + $this->es(),
            ],
            'sources' => [
                [
                    'type' => SourceType::OfficialArticle->value,
                    'title' => 'Tibia — Update 7.3 news (11 August 2004)',
                    'url' => 'https://www.tibia.com/news/?subtopic=newsarchive&id=271',
                    'note' => 'The update that opened Ankrahmun, and with it the tower.',
                ],
                [
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: Ankrahmun Libraries § Serpentine Tower',
                    'url' => 'https://tibia.fandom.com/wiki/Ankrahmun_Libraries#Serpentine_Tower',
                    'note' => 'Description of the tower, its library shelves and the rooms below.',
                ],
                [
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: Serpentine Tower Quest / Spoiler',
                    'url' => 'https://tibia.fandom.com/wiki/Serpentine_Tower_Quest/Spoiler',
                    'note' => 'The White Pearl method and the lamp → lever → switch chain.',
                ],
                [
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: Treasure Rooms § Serpentine Tower Treasure Room',
                    'url' => 'https://tibia.fandom.com/wiki/Treasure_Rooms',
                    'note' => 'Inventory of the unreachable treasure room.',
                ],
                [
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: Portable Hole',
                    'url' => 'https://tibia.fandom.com/wiki/Portable_Hole',
                    'note' => 'Item id 3248; movable between the 2004 summer and Christmas updates.',
                ],
                [
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: Tothdral',
                    'url' => 'https://tibia.fandom.com/wiki/Tothdral',
                ],
                [
                    'type' => SourceType::TibiaWiki->value,
                    'title' => 'TibiaWiki: Mysteries',
                    'url' => 'https://tibia.fandom.com/wiki/Mysteries',
                    'note' => 'Lists the tower among the open mysteries of Tibia.',
                ],
            ],
            'related_entry_ids' => $relatedIds,
        ];

        $existing = Entry::withTrashed()->where('slug', 'serpentine-tower')->first();

        if ($existing) {
            if ($existing->trashed()) {
                $existing->restore();
            }
            $service->update($existing, $payload);
        } else {
            $service->create($payload, null);
        }
    }

    /** @return array<string, string> */
    private function en(): array
    {
        return [
            'name' => 'Serpentine Tower',

            'overview' => 'The Serpentine Tower is the mage tower of Ankrahmun and the oldest unfinished riddle in the city of the dead. From the street it is unremarkable: a sorcerer guild, a library, and a short quest that hands out a white pearl. Below the ground floor, though, the tower keeps going — three caged creatures, a djinn behind magic walls, four cold coal basins and a treasure room full of items that exist nowhere else in Tibia, strung together by a chain of levers that has never been shown to lead anywhere.',

            'canon' => implode("\n\n", [
                'The tower stands in Ankrahmun, south-east of the depot and one level up, and it is exactly as old as the city: update 7.3, released on 11 August 2004, opened the desert city on Darama and the Serpentine Tower with it.',

                'Above ground it is the seat of Ankrahmun\'s sorcerer guild. Its keeper is Tothdral — guild leader, clairvoyant and teacher — and any sorcerer may climb to his library to learn spells and trade with him. The library is not scenery. Nine bookcases hold the magical literature of the desert: the spell books of Foeburner, Stoneskin, Move Earth and Improved Find Person, the volume titled simply Forbidden Spell, and beside them Controlled Demon Summoning, Ancient Mummies, Legion of Slaughter, Suns and Stars, The Larokhon and The Lamp of Tazur. Two of them — Morgathla Reveals the Secrets of the Mask and Recovering the Secret of the Mask — carry the story of the mask into the tower. A room below the library keeps two more books: Divination Spell on a table and Cat-Eye Spell in a drawer.',

                'The ground floor is where the Serpentine Tower Quest runs — also called the Ankrahmun Sorcerer Guild Quest, and better known simply as the White Pearl Quest. It is short and deliberately oblique: climb to the top of the tower, walk back down to the ground floor, and in the northern room place a pot on the open fire. The flame arms the magic forcefield on the eastern wall, which stops being a barrier and becomes a teleport; behind it a chest holds the White Pearl. It is premium content, recommended from level 8, and the only real danger is what lies further down.',

                'Below the pearl the tower turns strange. In the quest room a wall lamp can be used: it covers whoever touches it in red sparkles and never lights. Down the white stairs is the room of the caged creatures — a Fire Elemental, a Vampire and a Behemoth, each sealed in its own cell. Only the fire elemental is ever released, by a lever on the floor above; kill it and there is a switch inside its empty cage, and throwing that switch takes down the magic walls holding a Green Djinn a floor below. The djinn\'s cage has a switch of its own, and a second lever lies hidden beneath the leftmost energy field of that same room. Neither has ever been shown to do anything. Four coal basins stand around them, empty.',

                'The switch under the fire elemental also opens the room that made the tower famous. It is a treasure room in the strict sense — visible, never reachable — and what it displays exists nowhere else: a Blood Orb, the Carrot of Doom, a Ring of Wishes, the Horn of Sundering, Boots of Waterwalking, a Blessed Ankh, a Djinn\'s Lamp, and a portable hole. The last is the oddest of all. It reads as an item with one charge left, but it is part of the floor, and its sprite is one of the frames an old Sudden Death drew as it struck. Between the summer update of 2004 and the Christmas update of the same year the portable hole could be picked up and carried around; after that it was nailed down, and no one has ever established what it was for.',

                'On regular worlds no player has freed the vampire or the behemoth. On test servers the behemoth has been let out, though whether a gamemaster opened the cage was never established. Twenty years on, the tower is still listed among the mysteries of Tibia, filed under the question the community has asked since 2004: what does the djinn\'s lever do?',
            ]),

            'interpretations' => implode("\n\n", [
                'Two readings have lived side by side ever since. The first is that the tower is a joke. The treasure room would be a display case CipSoft assembled out of oddities and never meant to be opened, the extra levers scenery, and the portable hole a stray animation frame given a funny name and left where players could see it but not take it. Much of the community holds this view, and two decades of digging have turned up nothing that contradicts it.',

                'The second is that a quest was designed and never finished. The layout reads like a chain — lamp, lever, elemental, switch, magic walls, djinn — and chains in Tibia normally end at a door. The four empty coal basins are what keeps the theory alive: they are usually matched to the four creatures of the tower, one apiece, and coal that has never been lit invites the idea that something is meant to burn there. The lever hidden under an energy field in the djinn\'s room is the other loose end, because a switch placed where a player has to work to reach it is not how decoration is usually built.',

                'Neither reading can be closed. CipSoft has never commented on the tower, no update note has ever touched it, and the only cage that ever opened did so where the ordinary rules did not apply. The Serpentine Tower is documented here as what it demonstrably is: a finished quest with a white pearl at the end, and beneath it several floors of switches that have never been made to answer.',
            ]),

            'theories' => 'Open for editors, none confirmed by CipSoft: (1) what the switch inside the Green Djinn\'s cage and the lever under the energy field do — no effect has ever been reproduced on a regular world; (2) whether the four coal basins accept fuel of any kind; (3) how the behemoth was released on test servers, and whether a gamemaster was involved; (4) whether the treasure-room items were ever meant to be rewards, or only exhibits.',

            'research_gaps' => 'No official CipSoft statement about the tower exists, and no update note has ever modified it since 7.3 beyond fixing the portable hole in place in the 2004 Christmas update. Everything below the quest room is documented from player reports only.',
        ];
    }

    /** @return array<string, string> */
    private function es(): array
    {
        return [
            'name' => 'Serpentine Tower',

            'overview' => 'La Torre Serpentina es la torre de magos de Ankrahmun y el acertijo sin resolver más antiguo de la ciudad de los muertos. Desde la calle no llama la atención: un gremio de hechiceros, una biblioteca y una misión breve que entrega una perla blanca. Pero bajo la planta baja la torre sigue bajando — tres criaturas enjauladas, un djinn tras muros mágicos, cuatro braseros de carbón apagados y una sala del tesoro llena de objetos que no existen en ningún otro lugar de Tibia, encadenados por una sucesión de palancas que nunca se ha demostrado que lleve a ninguna parte.',

            'canon' => implode("\n\n", [
                'La torre se alza en Ankrahmun, al sureste del depot y un nivel por encima, y tiene exactamente la misma edad que la ciudad: la actualización 7.3, publicada el 11 de agosto de 2004, abrió la ciudad del desierto en Darama y con ella la Torre Serpentina.',

                'Sobre el nivel del suelo es la sede del gremio de hechiceros de Ankrahmun. Su guardián es Tothdral —líder del gremio, clarividente y maestro—, y cualquier hechicero puede subir a su biblioteca a aprender hechizos y comerciar con él. La biblioteca no es decorado. Nueve estanterías guardan la literatura mágica del desierto: los libros de hechizo de Foeburner, Stoneskin, Move Earth e Improved Find Person, el volumen titulado sin más Forbidden Spell y, junto a ellos, Controlled Demon Summoning, Ancient Mummies, Legion of Slaughter, Suns and Stars, The Larokhon y The Lamp of Tazur. Dos de ellos —Morgathla Reveals the Secrets of the Mask y Recovering the Secret of the Mask— traen a la torre la historia de la máscara. Una sala bajo la biblioteca conserva dos libros más: Divination Spell sobre una mesa y Cat-Eye Spell en un cajón.',

                'En la planta baja transcurre la Serpentine Tower Quest, llamada también Ankrahmun Sorcerer Guild Quest y conocida sobre todo como la misión de la White Pearl. Es corta y deliberadamente indirecta: hay que subir hasta lo alto de la torre, volver a bajar a la planta baja y, en la sala del norte, colocar una olla (pot) sobre el fuego abierto. La llama activa el campo de fuerza mágico del muro este, que deja de ser una barrera y se convierte en un teletransporte; detrás, un cofre guarda la White Pearl. Es contenido premium, recomendado a partir del nivel 8, y el único peligro real es lo que hay más abajo.',

                'Bajo la perla la torre se vuelve extraña. En la sala de la misión hay una lámpara de pared que puede usarse: cubre de destellos rojos a quien la toca y nunca se enciende. Bajando por las escaleras blancas se llega a la sala de las criaturas enjauladas — un Fire Elemental, un Vampire y un Behemoth, cada uno sellado en su propia celda. Solo el elemental de fuego llega a salir, liberado por una palanca del piso superior; al matarlo aparece un interruptor dentro de su jaula vacía, y accionarlo derriba los muros mágicos que retienen a un Green Djinn un piso más abajo. La jaula del djinn tiene su propio interruptor, y una segunda palanca permanece escondida bajo el campo de energía más a la izquierda de esa misma sala. Nunca se ha demostrado que ninguno de los dos haga nada. A su alrededor hay cuatro braseros de carbón, vacíos.',

                'El interruptor bajo el Fire Elemental abre además la sala que hizo famosa a la torre. Es una sala del tesoro en sentido estricto —visible, inalcanzable— y lo que exhibe no existe en ningún otro sitio: un Blood Orb, la Carrot of Doom, un Ring of Wishes, el Horn of Sundering, unas Boots of Waterwalking, un Blessed Ankh, una Djinn\'s Lamp y un portable hole. Este último es el más raro de todos. Se lee como un objeto al que le queda una carga, pero forma parte del suelo, y su sprite es uno de los fotogramas que dibujaba una vieja Sudden Death al impactar. Entre la actualización de verano de 2004 y la de Navidad de ese mismo año el portable hole podía cogerse y llevarse de un sitio a otro; después quedó clavado, y nadie ha averiguado nunca para qué servía.',

                'En los mundos normales ningún jugador ha liberado al Vampire ni al Behemoth. En servidores de prueba sí se ha visto salir al behemoth, aunque nunca se estableció si fue un gamemaster quien abrió la jaula. Veinte años después la torre sigue figurando entre los misterios de Tibia, archivada bajo la pregunta que la comunidad repite desde 2004: ¿qué hace la palanca del djinn?',
            ]),

            'interpretations' => implode("\n\n", [
                'Desde entonces conviven dos lecturas. La primera es que la torre es una broma. La sala del tesoro sería una vitrina que CipSoft montó con rarezas y nunca pensó abrir, las palancas de más serían decorado y el portable hole, un fotograma suelto de animación al que se le puso un nombre gracioso y se dejó donde los jugadores pudieran verlo sin poder cogerlo. Buena parte de la comunidad defiende esta lectura, y dos décadas de excavar no han encontrado nada que la contradiga.',

                'La segunda es que se diseñó una misión y no se terminó. El trazado se lee como una cadena —lámpara, palanca, elemental, interruptor, muros mágicos, djinn— y en Tibia las cadenas suelen acabar en una puerta. Los cuatro braseros vacíos son lo que mantiene viva la teoría: se suelen emparejar con las cuatro criaturas de la torre, uno por cada una, y un carbón que nunca se ha encendido invita a pensar que algo debería arder ahí. El otro cabo suelto es la palanca escondida bajo el campo de energía de la sala del djinn, porque un interruptor colocado donde el jugador tiene que esforzarse para llegar no suele ser decorado.',

                'Ninguna de las dos lecturas puede cerrarse. CipSoft nunca se ha pronunciado sobre la torre, ninguna nota de actualización la ha tocado y la única jaula que llegó a abrirse lo hizo donde las reglas normales no se aplicaban. La Torre Serpentina queda documentada aquí por lo que demostrablemente es: una misión terminada con una perla blanca al final y, debajo, varios pisos de interruptores a los que nadie ha logrado sacar respuesta.',
            ]),

            'theories' => 'Abierto para editores, nada confirmado por CipSoft: (1) qué hacen el interruptor de la jaula del Green Djinn y la palanca bajo el campo de energía —no se ha reproducido ningún efecto en un mundo normal—; (2) si los cuatro braseros admiten algún tipo de combustible; (3) cómo se liberó al behemoth en los servidores de prueba y si intervino un gamemaster; (4) si los objetos de la sala del tesoro llegaron a plantearse como recompensas o solo como piezas de exposición.',

            'research_gaps' => 'No existe ninguna declaración oficial de CipSoft sobre la torre, y ninguna nota de actualización la ha modificado desde la 7.3 más allá de fijar el portable hole al suelo en la actualización de Navidad de 2004. Todo lo que hay por debajo de la sala de la misión está documentado únicamente a partir de informes de jugadores.',
        ];
    }
}
