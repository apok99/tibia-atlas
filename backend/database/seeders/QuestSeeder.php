<?php

namespace Database\Seeders;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Models\User;
use App\Services\EntryService;
use Illuminate\Database\Seeder;

/**
 * The most important Tibia quests, ranked by in-game significance and lore.
 *
 * Curated set of the great "world" / endgame quests plus the two iconic
 * challenge quests every Tibian knows. Factual scaffolding (location,
 * recommended level, premium status, antagonists, rewards) is taken from the
 * official quest infoboxes on TibiaWiki; the narrative prose is editorial and
 * should be re-verified by editors — accuracy over completeness, never invent.
 */
class QuestSeeder extends Seeder
{
    /** TibiaWiki file proxy — redirects to the real image, works in <img src>. */
    private function img(string $file): string
    {
        return 'https://tibia.fandom.com/wiki/Special:FilePath/'.$file;
    }

    public function run(): void
    {
        $service = app(EntryService::class);
        $userId = User::where('email', 'admin@tibiaatlas.test')->value('id');

        foreach ($this->quests() as $q) {
            // Resolve optional related entries by slug, keeping only those that exist.
            $relatedIds = Entry::whereIn('slug', $q['related'] ?? [])->pluck('id')->all();

            $payload = [
                'slug' => $q['slug'],
                'type' => EntryType::Quest->value,
                'status' => EntryStatus::Published->value,
                'featured' => $q['featured'] ?? false,
                'primary_image' => $this->img($q['image']),
                'meta' => $q['meta'],
                'translations' => [
                    ['locale' => Locale::English->value] + $q['en'],
                    ['locale' => Locale::Spanish->value] + $q['es'],
                ],
                'sources' => $q['sources'],
                'related_entry_ids' => $relatedIds,
            ];

            // Several of these quests already exist as empty stub entries from
            // earlier glossary/import passes; upgrade those in place instead of
            // colliding on the unique slug.
            $existing = Entry::withTrashed()->where('slug', $q['slug'])->first();
            if ($existing) {
                if ($existing->trashed()) {
                    $existing->restore();
                }
                $service->update($existing, $payload);
            } else {
                $service->create($payload, $userId);
            }
        }
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function quests(): array
    {
        return [
            // 1 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-pits-of-inferno-quest',
                'featured' => true,
                'image' => 'Demon.gif',
                'related' => ['demon', 'zathroth', 'apoc'],
                'meta' => [
                    'importance_rank' => 1,
                    'quest_type' => 'World / endgame quest',
                    'region' => 'Plains of Havoc (Mainland)',
                    'recommended_level' => 130,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Pits of Inferno',
                ],
                'en' => [
                    'name' => 'The Pits of Inferno Quest',
                    'overview' => 'The Pits of Inferno is the most storied of Tibia\'s great quests: a descent into the burning underworld beneath the Plains of Havoc, where the Nightmare Knights wage an endless war against the powers of the Ruthless Seven.',
                    'canon' => 'The quest takes place in the Pits of Inferno, a vast infernal dungeon reached beneath the Plains of Havoc near the Necromant House. According to its in-game premise, the once-glorious Nightmare Knights established themselves in these pits to fight off evil. The pits contain seven thrones, each holding a fragment of the spirit of one of the Ruthless Seven — the demon lords who rule the underworld. Adventurers descend in teams and confront the seven throne guardians (including Verminor, Bazir, Apocalypse, Ashfalor, Pumin, Mazoran and Infernatil) amid demons, Betrayed Wraiths, Blightwalkers and other denizens of hell. Completing it grants access to the Hub shortcut, the famed Soft Boots, and is required to finish The Inquisition Quest.',
                    'interpretations' => 'The Pits of Inferno is best read as Tibia\'s portrait of its hells — a counterpart to the heroic surface world where the Ruthless Seven, masters of the demon hordes, are given form. The Nightmare Knights\' presence frames the quest not as treasure-hunting but as a holding action in a cosmic war that can never truly be won.',
                    'theories' => 'Because each throne is said to hold "a little of the spirit" of a member of the Ruthless Seven, players have long debated whether the throne guardians are the demon lords themselves, mere echoes, or summoned avatars — and how this realm relates to Ferumbras and Morgaroth, who are described as servants of the Seven.',
                ],
                'es' => [
                    'name' => 'La Misión de los Pozos del Infierno',
                    'overview' => 'Los Pozos del Infierno son la más legendaria de las grandes misiones de Tibia: un descenso al inframundo ardiente bajo las Llanuras del Caos, donde los Caballeros de la Pesadilla libran una guerra eterna contra el poder de los Siete Despiadados.',
                    'canon' => 'La misión transcurre en los Pozos del Infierno, una vasta mazmorra infernal a la que se accede bajo las Plains of Havoc, cerca de la Casa del Nigromante. Según su premisa dentro del juego, los antaño gloriosos Caballeros de la Pesadilla se establecieron en estos pozos para combatir el mal. Los pozos contienen siete tronos, cada uno con un fragmento del espíritu de uno de los Siete Despiadados (Ruthless Seven), los señores demoníacos que gobiernan el inframundo. Los aventureros descienden en grupo y se enfrentan a los siete guardianes de los tronos (entre ellos Verminor, Bazir, Apocalypse, Ashfalor, Pumin, Mazoran e Infernatil) entre demonios, Betrayed Wraiths, Blightwalkers y otros moradores del infierno. Completarla otorga acceso al atajo del Hub, las célebres Soft Boots, y es requisito para terminar la Misión de la Inquisición.',
                    'interpretations' => 'Los Pozos del Infierno se leen mejor como el retrato que hace Tibia de sus infiernos: el reverso del heroico mundo de la superficie, donde los Siete Despiadados, amos de las hordas de demonios, toman forma. La presencia de los Caballeros de la Pesadilla enmarca la misión no como una caza de tesoros, sino como una contención en una guerra cósmica que nunca podrá ganarse del todo.',
                    'theories' => 'Como se dice que cada trono guarda "un poco del espíritu" de un miembro de los Siete Despiadados, los jugadores debaten desde hace tiempo si los guardianes de los tronos son los propios señores demoníacos, meros ecos o avatares invocados, y cómo se relaciona este reino con Ferumbras y Morgaroth, descritos como servidores de los Siete.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Pits of Inferno Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Pits_of_Inferno_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 2 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-inquisition-quest',
                'featured' => true,
                'image' => 'Ushuriel.gif',
                'related' => ['demon', 'zathroth'],
                'meta' => [
                    'importance_rank' => 2,
                    'quest_type' => 'World / outfit quest',
                    'region' => 'Various (starts in Thais)',
                    'recommended_level' => 150,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Thais',
                ],
                'en' => [
                    'name' => 'The Inquisition Quest',
                    'overview' => 'The Inquisition Quest sends adventurers to join a holy order hunting The Seven — a cabal of immensely powerful fallen beings — culminating in the Demon Hunter outfit and some of the game\'s most coveted rewards.',
                    'canon' => 'Beginning in Thais and ranging across the world, the quest enlists the player into the Inquisition to track down and destroy The Seven: Ushuriel, Annihilon, Hellgorak, Madareth, Latrivan, Golgordan and Zugurosh. Each is a boss of tremendous power, fought through dungeons teeming with Juggernauts, Lost Souls, Dark Torturers and Demons. The final mission requires level 100. Rewards include the Demon Hunter Outfit and both addons, access to the deeper Demon Forge, the Blessing of the Inquisition, the High Inquisitor, Master of the Nexus and Demonbane achievements, and a choice of a powerful weapon or armor.',
                    'interpretations' => 'Where the Pits of Inferno depicts the demon lords of the underworld, the Inquisition centers on a different septet of evils and on organized, militant faith. It is one of the clearest expressions in Tibia of religion as an active force — an order that does not merely worship but takes up arms against the supernatural.',
                    'theories' => 'The nature and origin of The Seven is a recurring topic among lore enthusiasts, who connect them to the broader mythology of the gods and to Zathroth, the deity associated with darkness and undeath, though the precise genealogy is never spelled out in full.',
                ],
                'es' => [
                    'name' => 'La Misión de la Inquisición',
                    'overview' => 'La Misión de la Inquisición lleva a los aventureros a unirse a una orden sagrada que da caza a Los Siete —una camarilla de seres caídos inmensamente poderosos—, culminando en el atuendo de Cazador de Demonios y algunas de las recompensas más codiciadas del juego.',
                    'canon' => 'Comenzando en Thais y extendiéndose por todo el mundo, la misión recluta al jugador en la Inquisición para rastrear y destruir a Los Siete: Ushuriel, Annihilon, Hellgorak, Madareth, Latrivan, Golgordan y Zugurosh. Cada uno es un jefe de enorme poder, combatido a través de mazmorras plagadas de Juggernauts, Lost Souls, Dark Torturers y Demons. La última misión exige nivel 100. Las recompensas incluyen el atuendo de Cazador de Demonios y sus dos addons, acceso a las zonas profundas de la Demon Forge, la Bendición de la Inquisición, los logros High Inquisitor, Master of the Nexus y Demonbane, y la elección de un arma o armadura poderosa.',
                    'interpretations' => 'Mientras que los Pozos del Infierno retratan a los señores demoníacos del inframundo, la Inquisición se centra en otro septeto de males y en una fe militante y organizada. Es una de las expresiones más claras en Tibia de la religión como fuerza activa: una orden que no se limita a adorar, sino que toma las armas contra lo sobrenatural.',
                    'theories' => 'La naturaleza y el origen de Los Siete es un tema recurrente entre los aficionados al lore, que los vinculan con la mitología más amplia de los dioses y con Zathroth, la deidad asociada a la oscuridad y la no-muerte, aunque su genealogía exacta nunca se detalla por completo.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Inquisition Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Inquisition_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 3 ───────────────────────────────────────────────────────────
            [
                'slug' => 'wrath-of-the-emperor-quest',
                'featured' => true,
                'image' => 'Draken_Warmaster.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 3,
                    'quest_type' => 'World / story quest',
                    'region' => 'Zao',
                    'recommended_level' => 130,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Zao Rebel Camp',
                ],
                'en' => [
                    'name' => 'Wrath of the Emperor Quest',
                    'overview' => 'Wrath of the Emperor is the climactic story quest of the eastern continent of Zao, in which the player joins the lizard rebellion against the tyrannical draken empire and strikes at the heart of the imperial capital, Razachai.',
                    'canon' => 'Set primarily in Zao — including the Zao Rebel Camp and the draken city of Razachai — with a passage through Banuta, the quest casts the player as an ally of the rebel lizards rising against the draken who rule them. The path leads through High Class Lizards, Drakens, Ghastly and Undead Dragons, and Dragon Lords to the Inner Sanctum of Razachai. Rewards include access to Razachai and its teleports, the Wayfarer outfit, and a choice of high-tier draken armor among other treasures.',
                    'interpretations' => 'The quest reads as Tibia\'s great tale of empire and rebellion: the draken as a cruel ruling caste over the lizard peoples, and the player as the outside force that tips a brewing revolt. It deepens the identity of Zao as a land defined by its internal war rather than a mere hunting frontier.',
                    'theories' => 'The draken empire\'s ambitions and the full scope of the "emperor\'s wrath" invite speculation about whether the conflict in Zao is purely local or part of a wider threat to the mainland, a question the quest gestures at without fully resolving.',
                ],
                'es' => [
                    'name' => 'La Misión de la Ira del Emperador',
                    'overview' => 'La Ira del Emperador es la misión narrativa culminante del continente oriental de Zao, en la que el jugador se une a la rebelión de los lagartos contra el tiránico imperio draken y golpea el corazón de la capital imperial, Razachai.',
                    'canon' => 'Ambientada principalmente en Zao —incluidos el Zao Rebel Camp y la ciudad draken de Razachai—, con un paso por Banuta, la misión convierte al jugador en aliado de los lagartos rebeldes que se alzan contra los draken que los dominan. El camino atraviesa High Class Lizards, Drakens, Ghastly y Undead Dragons, y Dragon Lords hasta el Sanctasanctórum de Razachai. Las recompensas incluyen el acceso a Razachai y sus teleports, el atuendo Wayfarer y la elección de armaduras draken de alto nivel, entre otros tesoros.',
                    'interpretations' => 'La misión se lee como el gran relato de imperio y rebelión de Tibia: los draken como una cruel casta dominante sobre los pueblos lagarto, y el jugador como la fuerza externa que inclina una revuelta latente. Profundiza la identidad de Zao como una tierra definida por su guerra interna más que como una mera frontera de caza.',
                    'theories' => 'Las ambiciones del imperio draken y el alcance pleno de la "ira del emperador" invitan a especular sobre si el conflicto de Zao es puramente local o parte de una amenaza mayor para el continente, una cuestión que la misión sugiere sin resolver del todo.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Wrath of the Emperor Quest', 'url' => 'https://tibia.fandom.com/wiki/Wrath_of_the_Emperor_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 4 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-new-frontier-quest',
                'featured' => false,
                'image' => 'Lizard_High_Guard.gif',
                'related' => ['thais'],
                'meta' => [
                    'importance_rank' => 4,
                    'quest_type' => 'Access / story quest',
                    'region' => 'Farmine & Zao',
                    'recommended_level' => 110,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Farmine',
                ],
                'en' => [
                    'name' => 'The New Frontier Quest',
                    'overview' => 'The New Frontier is the great expedition quest that opens the eastern continent of Zao, following the imperial mining venture that founded Farmine in search of new riches far from Kazordoon.',
                    'canon' => 'The quest spans much of the world — Kazordoon, Edron, Venore, Thais, Port Hope and the new outpost of Farmine — as the player aids a mining expedition. Its premise is that, after centuries, the resources around the Big Old One (Kazordoon) grew alarmingly short, so the imperial mining guild financed a project to seek new mines far away; that venture leads to the founding of Farmine and the opening of the path to Zao. The last mission requires roughly level 77, with dangers ranging from Stone Golems and Shards of Corruption to Mooh\'Tah Masters and Lizard High Guards.',
                    'interpretations' => 'As an access quest, The New Frontier is the narrative bridge that makes a whole continent reachable. It frames Zao not as something the heroes conquered but as a land the dwarven-imperial world stumbled into out of need — colonisation driven by scarcity, with all the conflict that follows.',
                    'theories' => 'The "corruption" encountered during the expedition and the strange forces around Farmine fuel discussion about what truly lies beneath the new continent, themes that later Zao quests such as Wrath of the Emperor and Children of the Revolution pick up.',
                ],
                'es' => [
                    'name' => 'La Misión de la Nueva Frontera',
                    'overview' => 'La Nueva Frontera es la gran misión de expedición que abre el continente oriental de Zao, siguiendo la empresa minera imperial que fundó Farmine en busca de nuevas riquezas lejos de Kazordoon.',
                    'canon' => 'La misión recorre buena parte del mundo —Kazordoon, Edron, Venore, Thais, Port Hope y el nuevo enclave de Farmine— mientras el jugador ayuda a una expedición minera. Su premisa es que, tras siglos, los recursos en torno al Big Old One (Kazordoon) escasearon de forma alarmante, así que el gremio minero imperial financió un proyecto para buscar nuevas minas lejos de allí; esa empresa lleva a la fundación de Farmine y a la apertura del camino hacia Zao. La última misión exige en torno al nivel 77, con peligros que van desde Stone Golems y Shards of Corruption hasta Mooh\'Tah Masters y Lizard High Guards.',
                    'interpretations' => 'Como misión de acceso, La Nueva Frontera es el puente narrativo que hace alcanzable todo un continente. Presenta Zao no como algo que los héroes conquistaron, sino como una tierra a la que el mundo enano-imperial llegó por necesidad: colonización impulsada por la escasez, con todo el conflicto que de ello se deriva.',
                    'theories' => 'La "corrupción" que se encuentra durante la expedición y las extrañas fuerzas en torno a Farmine alimentan el debate sobre qué se esconde realmente bajo el nuevo continente, temas que misiones posteriores de Zao como la Ira del Emperador y Children of the Revolution retoman.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The New Frontier Quest', 'url' => 'https://tibia.fandom.com/wiki/The_New_Frontier_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 5 ───────────────────────────────────────────────────────────
            [
                'slug' => 'in-service-of-yalahar-quest',
                'featured' => false,
                'image' => 'Azerus.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 5,
                    'quest_type' => 'World / outfit quest',
                    'region' => 'Yalahar',
                    'recommended_level' => 120,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Edron',
                ],
                'en' => [
                    'name' => 'In Service of Yalahar Quest',
                    'overview' => 'In Service of Yalahar takes the player into the vast, ancient city of Yalahar to investigate its mysteries and confront the warlock Azerus, unlocking passage through the city\'s storied quarters.',
                    'canon' => 'Ranging across Edron, Liberty Bay and Yalahar itself, the quest follows the premise that the newly found island of Yalahar must be investigated thoroughly. The player works through the city\'s distinct quarters, facing the many creatures that infest them and ultimately the boss Azerus. Rewards include passage into the innermost area and through the gates to the quarters, plus the Yalaharian outfit and a choice of Yalahari equipment.',
                    'interpretations' => 'Yalahar is one of Tibia\'s most atmospheric cities — a sprawling, half-ruined metropolis divided into quarters, each with its own character. The quest reads as an act of discovery and stewardship, the player entering "service" of a place whose former greatness is everywhere implied and nowhere fully explained.',
                    'theories' => 'The history of Yalahar\'s builders, the purpose of its quarters and the true designs of Azerus are perennial subjects of theory, with players piecing together the city\'s past from environmental detail and the books found within it.',
                ],
                'es' => [
                    'name' => 'La Misión Al Servicio de Yalahar',
                    'overview' => 'Al Servicio de Yalahar lleva al jugador a la vasta y antigua ciudad de Yalahar para investigar sus misterios y enfrentarse al brujo Azerus, desbloqueando el paso por los célebres barrios de la ciudad.',
                    'canon' => 'Extendiéndose por Edron, Liberty Bay y la propia Yalahar, la misión parte de la premisa de que la recién descubierta isla de Yalahar debe ser investigada a fondo. El jugador avanza por los distintos barrios de la ciudad, enfrentándose a las numerosas criaturas que los infestan y, finalmente, al jefe Azerus. Las recompensas incluyen el paso a la zona más interna y a través de las puertas de los barrios, además del atuendo Yalaharian y la elección de equipo Yalahari.',
                    'interpretations' => 'Yalahar es una de las ciudades más atmosféricas de Tibia: una metrópoli enorme y semiderruida dividida en barrios, cada uno con su propio carácter. La misión se lee como un acto de descubrimiento y custodia: el jugador entra "al servicio" de un lugar cuya grandeza pasada se insinúa por doquier y nunca se explica del todo.',
                    'theories' => 'La historia de los constructores de Yalahar, el propósito de sus barrios y los verdaderos planes de Azerus son temas perennes de teoría, y los jugadores reconstruyen el pasado de la ciudad a partir del detalle ambiental y de los libros que se encuentran en ella.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: In Service of Yalahar Quest', 'url' => 'https://tibia.fandom.com/wiki/In_Service_of_Yalahar_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 6 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-ancient-tombs-quest',
                'featured' => false,
                'image' => 'Morguthis.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 6,
                    'quest_type' => 'Boss / reward quest',
                    'region' => 'Ankrahmun',
                    'recommended_level' => 120,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Ankrahmun Tombs',
                ],
                'en' => [
                    'name' => 'The Ancient Tombs Quest',
                    'overview' => 'The Ancient Tombs Quest pits adventurers against the undying Pharaohs sealed beneath Ankrahmun, who guard the forged pieces of the legendary Helmet of the Ancients for all eternity.',
                    'canon' => 'Set in the Ankrahmun Tombs, the quest\'s premise is that seven advisors of the Pharaoh were "entrusted" with the secret to forge part of an ancient powerful mask, and that they will fight for an eternity to keep it. The player and allies battle each of the Pharaohs and their undead minions — among warlocks, behemoths, liches, banshees and necromancers — to claim the Helmet of the Ancients.',
                    'interpretations' => 'The quest is the keystone of Ankrahmun\'s identity as a city of the dead, where mummification and undeath are cultural rather than merely monstrous. The Pharaohs are not random bosses but a fallen court, bound by duty even in death — a vivid expression of the region\'s Egyptian-inspired theme.',
                    'theories' => 'Who the Pharaohs were in life, the origin and purpose of the Helmet of the Ancients, and how Ankrahmun\'s cult of the dead arose are all matters players reconstruct from the tombs themselves and from the city\'s lore.',
                ],
                'es' => [
                    'name' => 'La Misión de las Tumbas Antiguas',
                    'overview' => 'La Misión de las Tumbas Antiguas enfrenta a los aventureros con los Faraones imperecederos sellados bajo Ankrahmun, que custodian por toda la eternidad las piezas forjadas del legendario Yelmo de los Ancianos.',
                    'canon' => 'Ambientada en las Tumbas de Ankrahmun, la premisa de la misión es que a siete consejeros del Faraón se les "confió" el secreto para forjar parte de una antigua y poderosa máscara, y que lucharán por toda la eternidad para conservarla. El jugador y sus aliados combaten a cada uno de los Faraones y a sus secuaces no-muertos —entre warlocks, behemoths, liches, banshees y necromancers— para reclamar el Yelmo de los Ancianos (Helmet of the Ancients).',
                    'interpretations' => 'La misión es la piedra angular de la identidad de Ankrahmun como ciudad de los muertos, donde la momificación y la no-muerte son culturales más que meramente monstruosas. Los Faraones no son jefes cualesquiera, sino una corte caída, atada por el deber incluso en la muerte: una expresión vívida del tema de inspiración egipcia de la región.',
                    'theories' => 'Quiénes fueron los Faraones en vida, el origen y propósito del Yelmo de los Ancianos y cómo surgió el culto a los muertos de Ankrahmun son cuestiones que los jugadores reconstruyen a partir de las propias tumbas y del lore de la ciudad.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Ancient Tombs Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Ancient_Tombs_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 7 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-annihilator-quest',
                'featured' => false,
                'image' => 'Magic_Sword.gif',
                'related' => ['demon'],
                'meta' => [
                    'importance_rank' => 7,
                    'quest_type' => 'Challenge quest',
                    'region' => 'Edron',
                    'recommended_level' => 130,
                    'access' => 'Premium',
                    'party' => 'Team of 4',
                    'starts_in' => 'Hero Cave (Edron)',
                ],
                'en' => [
                    'name' => 'The Annihilator Quest',
                    'overview' => 'The Annihilator — "Anni" to generations of players — is Tibia\'s most iconic team challenge: four adventurers descend into the Hero Cave below Edron to face a chamber of demons guarding a great treasure.',
                    'canon' => 'Located in the Hero Cave beneath Edron, the quest\'s premise is that deep in the earth, near hell, demons guard a great treasure that only the bravest dare retrieve. Traditionally undertaken by a team of four, the climactic room pits the party against several Angry Demons at once. Each victorious player chooses one reward from the Magic Sword, Demon Armor, Stonecutter Axe, or a present box, and the quest unlocks the Demon outfit.',
                    'interpretations' => 'More than its lore, the Annihilator endures as a cultural landmark of Tibia — a rite of passage and a test of coordination, trust and gear. For many players it is the first true "endgame" goal, and the Magic Sword its most legendary prize.',
                    'theories' => 'The quest\'s lore is deliberately spare, and discussion tends to focus less on story than on its place in the game\'s history and the enduring mystique of its rewards.',
                ],
                'es' => [
                    'name' => 'La Misión del Aniquilador (Annihilator)',
                    'overview' => 'El Annihilator —"Anni" para generaciones de jugadores— es el desafío en equipo más icónico de Tibia: cuatro aventureros descienden a la Hero Cave bajo Edron para enfrentarse a una sala de demonios que custodian un gran tesoro.',
                    'canon' => 'Situada en la Hero Cave bajo Edron, la premisa de la misión es que en lo profundo de la tierra, cerca del infierno, los demonios guardan un gran tesoro que solo los más valientes se atreven a recuperar. Tradicionalmente realizada por un equipo de cuatro, la sala final enfrenta al grupo con varios Angry Demons a la vez. Cada jugador victorioso elige una recompensa entre la Magic Sword, la Demon Armor, el Stonecutter Axe o una caja de regalo, y la misión desbloquea el atuendo de Demonio.',
                    'interpretations' => 'Más allá de su lore, el Annihilator perdura como un hito cultural de Tibia: un rito de paso y una prueba de coordinación, confianza y equipo. Para muchos jugadores es el primer verdadero objetivo de "endgame", y la Magic Sword su premio más legendario.',
                    'theories' => 'El lore de la misión es deliberadamente escueto, y el debate tiende a centrarse menos en la historia que en su lugar en la historia del juego y en la perdurable mística de sus recompensas.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Annihilator Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Annihilator_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 8 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-demon-oak-quest',
                'featured' => false,
                'image' => 'Demon_Legs.gif',
                'related' => ['demon'],
                'meta' => [
                    'importance_rank' => 8,
                    'quest_type' => 'Challenge quest',
                    'region' => 'Plains of Havoc',
                    'recommended_level' => 130,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Plains of Havoc',
                ],
                'en' => [
                    'name' => 'The Demon Oak Quest',
                    'overview' => 'The Demon Oak is Tibia\'s signature solo trial: a lone adventurer fells a monstrous demonic tree on the Plains of Havoc, surviving wave after wave of summoned horrors for the chance at the prized Demon Legs.',
                    'canon' => 'Set on the Plains of Havoc, the quest\'s premise is that the Ruthless Seven have sent a powerful demonic being to the region. The player must chop down the Demon Oak itself, which summons relentless waves of undead and demons — Banshees, Betrayed Wraiths, Blightwalkers, Grim Reapers, Undead Dragons, Demons and more. Success earns the Herbicide achievement, the second addon of the Demon outfit, and a choice of reward including the famed Demon Legs.',
                    'interpretations' => 'Where the Annihilator celebrates teamwork, the Demon Oak is the great test of the individual — a self-contained duel against an endless tide that rewards preparation, nerve and stamina. Its tie to the Ruthless Seven links this small clearing to the larger mythology of the Pits of Inferno.',
                    'theories' => 'The Demon Oak\'s exact nature — a corrupted tree, a vessel, or merely a weapon dispatched by the Seven — is left to interpretation, as is why the Plains of Havoc remain so persistently a battleground for infernal incursions.',
                ],
                'es' => [
                    'name' => 'La Misión del Roble Demoníaco (Demon Oak)',
                    'overview' => 'El Demon Oak es la prueba en solitario por excelencia de Tibia: un aventurero solo tala un monstruoso árbol demoníaco en las Plains of Havoc, sobreviviendo a oleada tras oleada de horrores invocados por la oportunidad de obtener las codiciadas Demon Legs.',
                    'canon' => 'Ambientada en las Plains of Havoc, la premisa de la misión es que los Siete Despiadados (Ruthless Seven) han enviado a un poderoso ser demoníaco a la región. El jugador debe talar el propio Demon Oak, que invoca oleadas incesantes de no-muertos y demonios: Banshees, Betrayed Wraiths, Blightwalkers, Grim Reapers, Undead Dragons, Demons y más. El éxito otorga el logro Herbicide, el segundo addon del atuendo de Demonio y la elección de una recompensa que incluye las célebres Demon Legs.',
                    'interpretations' => 'Donde el Annihilator celebra el trabajo en equipo, el Demon Oak es la gran prueba del individuo: un duelo autónomo contra una marea interminable que premia la preparación, el temple y la resistencia. Su vínculo con los Siete Despiadados conecta este pequeño claro con la mitología mayor de los Pozos del Infierno.',
                    'theories' => 'La naturaleza exacta del Demon Oak —un árbol corrupto, un recipiente o simplemente un arma enviada por los Siete— queda a la interpretación, igual que por qué las Plains of Havoc siguen siendo de forma tan persistente un campo de batalla para incursiones infernales.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Demon Oak Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Demon_Oak_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 9 ───────────────────────────────────────────────────────────
            [
                'slug' => 'the-shattered-isles-quest',
                'featured' => false,
                'image' => 'Pirate_Corsair.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 9,
                    'quest_type' => 'Access / outfit quest',
                    'region' => 'Shattered Isles',
                    'recommended_level' => 65,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Liberty Bay',
                ],
                'en' => [
                    'name' => 'The Shattered Isles Quest',
                    'overview' => 'The Shattered Isles Quest drops the player into the pirate war of the southern seas, siding with the freedom fighters of Meriana against the raiding hordes of Nargor and opening a whole archipelago of islands.',
                    'canon' => 'Spanning Liberty Bay, Meriana, Goroma, Nargor and Edron, the quest pits the player in a battle between the peace-loving pirates of Meriana and the pillaging pirates of Nargor. The player\'s mission is to overcome Nargor and aid Meriana, contending with pirates, a sinister cult and island wildlife along the way. Rewards include the ability to travel to Goroma from Liberty Bay, access to Meriana, and the Pirate outfit.',
                    'interpretations' => 'The Shattered Isles defines the swashbuckling, tropical corner of Tibia\'s world. Framed as a clash of two pirate factions rather than good against monstrous evil, it gives the southern seas a more human, factional flavour than the great infernal quests.',
                    'theories' => 'The cult encountered in the isles and the wider history of Goldenland and the southern seas remain partly mysterious, fuelling speculation about what older powers lie behind the pirates\' feud.',
                ],
                'es' => [
                    'name' => 'La Misión de las Islas Rotas (Shattered Isles)',
                    'overview' => 'La Misión de las Shattered Isles sumerge al jugador en la guerra pirata de los mares del sur, tomando partido por los luchadores por la libertad de Meriana contra las hordas saqueadoras de Nargor, y abriendo todo un archipiélago de islas.',
                    'canon' => 'Abarcando Liberty Bay, Meriana, Goroma, Nargor y Edron, la misión enfrenta al jugador en una batalla entre los pacíficos piratas de Meriana y los saqueadores piratas de Nargor. La misión del jugador es vencer a Nargor y ayudar a Meriana, lidiando por el camino con piratas, un siniestro culto y la fauna de las islas. Las recompensas incluyen poder viajar a Goroma desde Liberty Bay, el acceso a Meriana y el atuendo de Pirata.',
                    'interpretations' => 'Las Shattered Isles definen el rincón tropical y de aventura pirata del mundo de Tibia. Planteada como un choque entre dos facciones piratas más que como el bien contra un mal monstruoso, da a los mares del sur un tono más humano y faccional que las grandes misiones infernales.',
                    'theories' => 'El culto que se encuentra en las islas y la historia más amplia de Goldenland y los mares del sur siguen siendo en parte un misterio, lo que alimenta la especulación sobre qué poderes más antiguos están detrás de la disputa de los piratas.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Shattered Isles Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Shattered_Isles_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 10 ──────────────────────────────────────────────────────────
            [
                'slug' => 'children-of-the-revolution-quest',
                'featured' => false,
                'image' => 'Lizard_Legionnaire.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 10,
                    'quest_type' => 'Story / task quest',
                    'region' => 'Zao',
                    'recommended_level' => 70,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Zao',
                ],
                'en' => [
                    'name' => 'Children of the Revolution Quest',
                    'overview' => 'Children of the Revolution continues the saga of the lizard rebellion in Zao, deepening the player\'s ties to the rebels of the Muggy Plains as they resist the draken empire.',
                    'canon' => 'Set in Zao and the Muggy Plains, the quest furthers the rebel storyline begun with The New Frontier and carried through Wrath of the Emperor. The player contends with High Class Lizards, Killer Caimans, Eternal Guardians and mutated beasts. Rewards include 10,000 experience, a Tome of Knowledge, the Serpent Crest (the second addon of the Warmaster outfit) and the ability to begin various ongoing tasks.',
                    'interpretations' => 'The quest fleshes out Zao\'s rebellion as a sustained movement rather than a single uprising, giving the lizard "children of the revolution" a continuity and identity. It cements Zao as a region whose stories are about politics and resistance.',
                    'theories' => 'How the rebellion ultimately fares against the draken, and whether the player\'s aid tips the balance for good, are threads the Zao quests leave open for ongoing interpretation.',
                ],
                'es' => [
                    'name' => 'La Misión Hijos de la Revolución',
                    'overview' => 'Children of the Revolution continúa la saga de la rebelión de los lagartos en Zao, estrechando los lazos del jugador con los rebeldes de las Muggy Plains mientras resisten al imperio draken.',
                    'canon' => 'Ambientada en Zao y las Muggy Plains, la misión prolonga la trama rebelde iniciada con La Nueva Frontera y desarrollada en la Ira del Emperador. El jugador se enfrenta a High Class Lizards, Killer Caimans, Eternal Guardians y bestias mutadas. Las recompensas incluyen 10.000 de experiencia, un Tome of Knowledge, el Serpent Crest (segundo addon del atuendo Warmaster) y la posibilidad de iniciar diversas tareas continuas.',
                    'interpretations' => 'La misión desarrolla la rebelión de Zao como un movimiento sostenido y no como un único levantamiento, dando a los lagartos "hijos de la revolución" una continuidad y una identidad. Consolida a Zao como una región cuyas historias tratan de política y resistencia.',
                    'theories' => 'Cómo le va finalmente a la rebelión frente a los draken, y si la ayuda del jugador inclina la balanza definitivamente, son hilos que las misiones de Zao dejan abiertos a la interpretación continua.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Children of the Revolution Quest', 'url' => 'https://tibia.fandom.com/wiki/Children_of_the_Revolution_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 11 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-djinn-war',
                'featured' => false,
                'image' => 'Efreet.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 11,
                    'quest_type' => 'Faction quest',
                    'region' => 'Darama (Ankrahmun)',
                    'recommended_level' => 50,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Ankrahmun',
                ],
                'en' => [
                    'name' => 'The Djinn War',
                    'overview' => 'The Djinn War is Tibia\'s great faction quest: the player must choose a side in the ancient feud between the blue Marids and the green Efreet, two rival races of djinn, and help one obliterate the other.',
                    'canon' => 'The djinn are split into two warring factions — the Marids, led from the Blue Djinn Fortress of Ashta\'daramai, and the Efreet, their green-skinned counterparts. The quest comes in two mutually exclusive versions: ally with the Marids to crush the Efreet, or with the Efreet to crush the Marids. Whichever side you take earns that faction\'s "eternal trust," the ability to trade with its djinn merchants (Nah\'Bob and Haroun for the Marids), and the standing to hunt the rival faction. The path runs through djinn fortresses, orcs, gargoyles and a guardian dragon.',
                    'interpretations' => 'The Djinn War is one of the purest expressions of faction design in Tibia: a binary, irreversible choice that permanently colours a character\'s relationship with an entire race. It dramatises the djinn not as monsters but as proud, ancient peoples locked in a grudge older than the human kingdoms.',
                    'theories' => 'The original cause of the schism between Marid and Efreet is left deliberately vague, inviting players to read the war as anything from a dynastic split to a clash of fundamentally opposed natures.',
                ],
                'es' => [
                    'name' => 'La Guerra de los Djinn',
                    'overview' => 'La Guerra de los Djinn es la gran misión de facción de Tibia: el jugador debe elegir bando en la antigua disputa entre los Marids azules y los Efreet verdes, dos razas rivales de djinn, y ayudar a una a aniquilar a la otra.',
                    'canon' => 'Los djinn están divididos en dos facciones enfrentadas: los Marids, dirigidos desde la Fortaleza de los Djinn Azules de Ashta\'daramai, y los Efreet, sus homólogos de piel verde. La misión existe en dos versiones mutuamente excluyentes: aliarse con los Marids para destruir a los Efreet, o con los Efreet para destruir a los Marids. Sea cual sea el bando elegido, se gana la "confianza eterna" de esa facción, la posibilidad de comerciar con sus mercaderes djinn (Nah\'Bob y Haroun para los Marids) y el derecho a cazar a la facción rival. El camino atraviesa fortalezas djinn, orcos, gárgolas y un dragón guardián.',
                    'interpretations' => 'La Guerra de los Djinn es una de las expresiones más puras del diseño de facciones en Tibia: una elección binaria e irreversible que tiñe para siempre la relación de un personaje con toda una raza. Presenta a los djinn no como monstruos, sino como pueblos antiguos y orgullosos atrapados en un rencor más viejo que los reinos humanos.',
                    'theories' => 'La causa original del cisma entre Marid y Efreet se deja deliberadamente vaga, lo que invita a leer la guerra como cualquier cosa, desde una escisión dinástica hasta un choque de naturalezas fundamentalmente opuestas.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Djinn War - Marid Faction', 'url' => 'https://tibia.fandom.com/wiki/The_Djinn_War_-_Marid_Faction'],
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Djinn War - Efreet Faction', 'url' => 'https://tibia.fandom.com/wiki/The_Djinn_War_-_Efreet_Faction'],
                ],
            ],

            // 12 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-postman-missions-quest',
                'featured' => false,
                'image' => 'Post_Horn.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 12,
                    'quest_type' => 'Classic / service quest',
                    'region' => 'All of Tibia',
                    'recommended_level' => 25,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Tibia Postal Service HQ',
                ],
                'en' => [
                    'name' => 'The Postman Missions Quest',
                    'overview' => 'One of Tibia\'s most beloved classic quests: the player rises through the ranks of the Tibian Postal Service under postmaster Kevin, delivering messages across the whole world to earn the cherished privileges of a postman.',
                    'canon' => 'Beginning in Kevin\'s office at the Tibia Postal Service Headquarters, the quest is a five-step career — Assistant Postman, Postman, Grand Postman, Grand Postman for Special Operations and finally Arch Postman — that sends the player on errands all over Tibia. The journey carries little danger but great breadth. Rewards include cheaper parcels, letters and boat fares, use of locked mailboxes, the Post Officer\'s Hat, the Post Horn and the Archpostman achievement.',
                    'interpretations' => 'The Postman quest is treasured less for combat than for the way it turns the player loose on the entire map as a courier, threading together distant cities through the humble, very human institution of the post. Its rewards are conveniences that quietly improve everyday play for years.',
                    'theories' => 'There is little hidden lore here; the quest\'s fame rests on charm and utility rather than mystery, and it endures as a fixture of Tibian culture.',
                ],
                'es' => [
                    'name' => 'La Misión del Cartero (Postman)',
                    'overview' => 'Una de las misiones clásicas más queridas de Tibia: el jugador asciende por el escalafón del Servicio Postal Tibiano a las órdenes del jefe de correos Kevin, repartiendo mensajes por todo el mundo para ganar los preciados privilegios de cartero.',
                    'canon' => 'Comenzando en la oficina de Kevin, en el Cuartel General del Servicio Postal de Tibia, la misión es una carrera de cinco pasos —Assistant Postman, Postman, Grand Postman, Grand Postman for Special Operations y, por fin, Arch Postman— que envía al jugador a hacer recados por toda Tibia. El viaje conlleva poco peligro pero mucha amplitud. Las recompensas incluyen parcels, letters y pasajes de barco más baratos, el uso de buzones cerrados, el Post Officer\'s Hat, el Post Horn y el logro Archpostman.',
                    'interpretations' => 'La misión del Cartero se aprecia menos por el combate que por la forma en que suelta al jugador por todo el mapa como mensajero, hilvanando ciudades lejanas a través de la humilde y muy humana institución del correo. Sus recompensas son comodidades que mejoran discretamente el juego cotidiano durante años.',
                    'theories' => 'Aquí hay poco lore oculto; la fama de la misión se asienta en el encanto y la utilidad más que en el misterio, y perdura como un emblema de la cultura tibiana.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Postman Missions Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Postman_Missions_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 13 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-paradox-tower-quest',
                'featured' => false,
                'image' => 'Phoenix_Egg.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 13,
                    'quest_type' => 'Puzzle quest',
                    'region' => 'Kazordoon',
                    'recommended_level' => 50,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Paradox Tower',
                ],
                'en' => [
                    'name' => 'The Paradox Tower Quest',
                    'overview' => 'The Paradox Tower is Tibia\'s famous riddle quest, in which a player must outwit the mathematical taunts of a madman who built a tower of puzzles near Kazordoon.',
                    'canon' => 'Set in the Paradox Tower near Kazordoon, the quest challenges the player to "surpass the wrath of a madman and subject yourself to his twisted taunting" — a series of riddles and number puzzles rather than pure combat, though wyverns, minotaurs and bonelords lurk along the way. Solving it earns the Mathemagician achievement and a choice of rewards including gold, the Wand of Cosmic Energy, talons and a Phoenix Egg.',
                    'interpretations' => 'The Paradox Tower stands out in a game built around fighting by rewarding wit instead. It is remembered as one of Tibia\'s signature brain-teaser quests, its mad architect a memorable voice of cruel, playful intellect.',
                    'theories' => 'The identity and motives of the tower\'s "madman" are left as flavour, part of the quest\'s puzzle-box charm rather than a thread into the wider lore.',
                ],
                'es' => [
                    'name' => 'La Misión de la Torre Paradoja',
                    'overview' => 'La Torre Paradoja es la famosa misión de acertijos de Tibia, en la que el jugador debe superar en ingenio las burlas matemáticas de un loco que construyó una torre de rompecabezas cerca de Kazordoon.',
                    'canon' => 'Ambientada en la Paradox Tower, cerca de Kazordoon, la misión reta al jugador a "superar la ira de un loco y someterse a sus retorcidas burlas": una serie de acertijos y rompecabezas numéricos más que combate puro, aunque por el camino acechan wyverns, minotauros y bonelords. Resolverla otorga el logro Mathemagician y la elección de recompensas como oro, la Wand of Cosmic Energy, talons y un Phoenix Egg.',
                    'interpretations' => 'La Torre Paradoja destaca en un juego construido en torno al combate al premiar el ingenio en su lugar. Se recuerda como una de las misiones de rompecabezas emblemáticas de Tibia, y su arquitecto loco como una voz memorable de inteligencia cruel y juguetona.',
                    'theories' => 'La identidad y los motivos del "loco" de la torre se dejan como ambientación, parte del encanto de caja de puzles de la misión más que un hilo hacia el lore mayor.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Paradox Tower Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Paradox_Tower_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 14 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-hidden-city-of-beregar-quest',
                'featured' => false,
                'image' => 'Firewalker_Boots.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 14,
                    'quest_type' => 'Access / discovery quest',
                    'region' => 'Beregar',
                    'recommended_level' => 60,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Ab\'Dendriel',
                ],
                'en' => [
                    'name' => 'The Hidden City of Beregar Quest',
                    'overview' => 'This quest uncovers Beregar, a long-lost city of dwarves hidden on an island near Yalahar, opening its mines and a new corner of the dwarven world to adventurers.',
                    'canon' => 'The quest\'s premise is a tale of a long-lost tribe of dwarves said to have settled on one of the islands around Yalahar — a huge city that a returning warrior described but no one believed. Ranging across Beregar, Fenrock, Mistrock, Ab\'Dendriel, Yalahar, Venore and Kazordoon, the player verifies the legend and earns access to the Beregar Mines, along with rewards such as the Firewalker Boots, Dwarven Legs and a Gold Ingot.',
                    'interpretations' => 'Beregar expands Tibia\'s dwarven civilisation beyond Kazordoon, framing the dwarves as a people whose history is one of migration and forgotten colonies. The quest is classic exploration: the recovery of a place the world had written off as a sailor\'s tall tale.',
                    'theories' => 'How Beregar was lost and what severed it from the dwarves of Kazordoon are questions the quest raises through its premise more than it answers.',
                ],
                'es' => [
                    'name' => 'La Misión de la Ciudad Oculta de Beregar',
                    'overview' => 'Esta misión descubre Beregar, una ciudad de enanos perdida durante mucho tiempo y oculta en una isla cerca de Yalahar, abriendo sus minas y un nuevo rincón del mundo enano a los aventureros.',
                    'canon' => 'La premisa de la misión es la leyenda de una tribu de enanos largamente perdida que, según se dice, se asentó en una de las islas en torno a Yalahar: una enorme ciudad que un guerrero, al regresar, describió pero nadie creyó. Recorriendo Beregar, Fenrock, Mistrock, Ab\'Dendriel, Yalahar, Venore y Kazordoon, el jugador verifica la leyenda y obtiene acceso a las Beregar Mines, junto con recompensas como las Firewalker Boots, las Dwarven Legs y un Gold Ingot.',
                    'interpretations' => 'Beregar amplía la civilización enana de Tibia más allá de Kazordoon, presentando a los enanos como un pueblo cuya historia es de migración y colonias olvidadas. La misión es exploración clásica: la recuperación de un lugar que el mundo había descartado como un cuento de marineros.',
                    'theories' => 'Cómo se perdió Beregar y qué la separó de los enanos de Kazordoon son preguntas que la misión plantea con su premisa más que responde.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Hidden City of Beregar Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Hidden_City_of_Beregar_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 15 ──────────────────────────────────────────────────────────
            [
                'slug' => 'cults-of-tibia-quest',
                'featured' => false,
                'image' => 'Barkless_Devotee.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 15,
                    'quest_type' => 'Investigation / lore quest',
                    'region' => 'Various (Feyrist)',
                    'recommended_level' => 150,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Various',
                ],
                'en' => [
                    'name' => 'Cults of Tibia Quest',
                    'overview' => 'A lore-rich investigation across the whole world, exposing the secret cults that hide all over Tibia and tracking their dark workings to a series of hidden bosses.',
                    'canon' => 'Its premise is simply that secret cults are hiding all over Tibia. The quest leads the player through the Outlaw Camp, Ab\'Dendriel, the Edron Orc Cave, Mintwallin, the Carlin Graveyard, the Dark Pyramid, Thais and Feyrist, investigating cultists and confronting their enforcers, among them the Barkless and the Ravenous Hunger. Rewards include 325,000 experience, the Corruption Contained achievement, a Mystery Box and a vocation-specific crown.',
                    'interpretations' => 'Cults of Tibia is one of the game\'s most explicitly investigative quests, treating the world as a crime scene seeded with conspiracies. It rewards reading, observation and travel, weaving disparate dungeons into a single hidden web of devotion to forbidden powers.',
                    'theories' => 'The cults\' ultimate masters and how their scattered cells connect are central puzzles for lore enthusiasts, tying the quest to Tibia\'s broader mythology of corruption and the worship of dark beings.',
                ],
                'es' => [
                    'name' => 'La Misión Cultos de Tibia',
                    'overview' => 'Una investigación rica en lore por todo el mundo, que saca a la luz los cultos secretos escondidos por toda Tibia y rastrea sus oscuras maquinaciones hasta una serie de jefes ocultos.',
                    'canon' => 'Su premisa es, sencillamente, que hay cultos secretos escondidos por toda Tibia. La misión lleva al jugador por el Outlaw Camp, Ab\'Dendriel, la Edron Orc Cave, Mintwallin, el Carlin Graveyard, la Dark Pyramid, Thais y Feyrist, investigando a los cultistas y enfrentándose a sus ejecutores, entre ellos los Barkless y el Ravenous Hunger. Las recompensas incluyen 325.000 de experiencia, el logro Corruption Contained, una Mystery Box y una corona específica de vocación.',
                    'interpretations' => 'Cultos de Tibia es una de las misiones más explícitamente detectivescas del juego, que trata el mundo como una escena del crimen sembrada de conspiraciones. Premia la lectura, la observación y el viaje, entretejiendo mazmorras dispares en una única red oculta de devoción a poderes prohibidos.',
                    'theories' => 'Los amos últimos de los cultos y cómo se conectan sus células dispersas son enigmas centrales para los aficionados al lore, que vinculan la misión con la mitología más amplia de Tibia sobre la corrupción y la adoración de seres oscuros.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Cults of Tibia Quest', 'url' => 'https://tibia.fandom.com/wiki/Cults_of_Tibia_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 16 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-secret-library-quest',
                'featured' => false,
                'image' => 'Grand_Master_Oberon.gif',
                'related' => ['zathroth'],
                'meta' => [
                    'importance_rank' => 16,
                    'quest_type' => 'World / endgame quest',
                    'region' => 'Various',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Cormaya',
                ],
                'en' => [
                    'name' => 'The Secret Library Quest',
                    'overview' => 'A major endgame story quest in which the player races to stop the minions of Variphor from looting the Secret Library of Zathroth and the forbidden knowledge of the Godbreaker.',
                    'canon' => 'Its premise is to prevent the minions of Variphor from stealing the knowledge of how to use the Godbreaker from the Secret Library of Zathroth. The quest spans Cormaya, the Asura Palace, the Ancient Ancestral Grounds, the Falcon Bastion, the Deep Desert, the Extension Site and the Library itself, against Asuri, Deathlings, the Order of the Falcon (including Grand Master Oberon) and worse. It unlocks access to those high-level hunting grounds and the Library\'s formidable bosses.',
                    'interpretations' => 'The Secret Library deepens the mythology around Zathroth — the dark god whose hidden library holds knowledge dangerous enough to threaten gods themselves — and introduces Variphor as a looming antagonist. It is one of the clearest moments where Tibia\'s endgame turns on cosmic, god-tier stakes.',
                    'theories' => 'What the Godbreaker truly is, who Variphor serves, and how the Order of the Falcon fits into the theft are rich veins of speculation that connect this quest to later arcs like Heart of Destruction.',
                ],
                'es' => [
                    'name' => 'La Misión de la Biblioteca Secreta',
                    'overview' => 'Una gran misión narrativa de endgame en la que el jugador corre para impedir que los esbirros de Variphor saqueen la Biblioteca Secreta de Zathroth y el conocimiento prohibido del Godbreaker.',
                    'canon' => 'Su premisa es impedir que los esbirros de Variphor roben de la Biblioteca Secreta de Zathroth el conocimiento sobre cómo usar el Godbreaker. La misión abarca Cormaya, el Asura Palace, los Ancient Ancestral Grounds, el Falcon Bastion, el Deep Desert, el Extension Site y la propia Biblioteca, contra Asuri, Deathlings, la Order of the Falcon (incluido el Grand Master Oberon) y peores enemigos. Desbloquea el acceso a esas zonas de caza de alto nivel y a los formidables jefes de la Biblioteca.',
                    'interpretations' => 'La Biblioteca Secreta profundiza la mitología en torno a Zathroth —el dios oscuro cuya biblioteca oculta guarda un conocimiento lo bastante peligroso como para amenazar a los propios dioses— e introduce a Variphor como antagonista que se cierne sobre el mundo. Es uno de los momentos más claros en que el endgame de Tibia gira en torno a apuestas cósmicas, a la altura de los dioses.',
                    'theories' => 'Qué es realmente el Godbreaker, a quién sirve Variphor y cómo encaja la Order of the Falcon en el robo son ricas vetas de especulación que conectan esta misión con arcos posteriores como Heart of Destruction.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Secret Library Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Secret_Library_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 17 ──────────────────────────────────────────────────────────
            [
                'slug' => 'forgotten-knowledge-quest',
                'featured' => false,
                'image' => 'Lloyd.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 17,
                    'quest_type' => 'Boss / endgame quest',
                    'region' => 'Various',
                    'recommended_level' => 200,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Halls of Hope',
                ],
                'en' => [
                    'name' => 'Forgotten Knowledge Quest',
                    'overview' => 'A team endgame quest that recovers forgotten knowledge from ancient times — restoring the lost art of Imbuing — through a gauntlet of powerful bosses across the dreamlike Halls of Hope and beyond.',
                    'canon' => 'Its premise is that forgotten knowledge from ancient times can be retrieved to enable Imbuing again. Centered on the Halls of Hope and six other areas, the quest pits parties against a roster of formidable bosses to reclaim that lost lore. Completing it grants the ability to imbue items with elemental protection and damage, skill boosts, mana and life leech, and critical hit — a permanent, account-wide power tied directly to the game\'s itemisation.',
                    'interpretations' => 'Forgotten Knowledge is unusual in marrying a system unlock (Imbuing) to a narrative of recovered memory. Its bosses and the Halls of Hope give the quest a strange, dreamlike register, framing power as something remembered rather than discovered.',
                    'theories' => 'The nature of the Halls of Hope, who the bosses were, and why this knowledge was lost in the first place are details players assemble from the encounters and surrounding texts.',
                ],
                'es' => [
                    'name' => 'La Misión del Conocimiento Olvidado',
                    'overview' => 'Una misión de endgame en equipo que recupera el conocimiento olvidado de tiempos antiguos —restaurando el arte perdido del Imbuing— a través de una sucesión de poderosos jefes por los oníricos Halls of Hope y más allá.',
                    'canon' => 'Su premisa es que el conocimiento olvidado de tiempos antiguos puede recuperarse para volver a habilitar el Imbuing. Centrada en los Halls of Hope y otras seis zonas, la misión enfrenta a los grupos con una nómina de jefes formidables para reclamar ese saber perdido. Completarla otorga la capacidad de imbuir objetos con protección y daño elemental, mejoras de habilidad, robo de maná y vida, y golpe crítico: un poder permanente y a nivel de cuenta ligado directamente a la itemización del juego.',
                    'interpretations' => 'El Conocimiento Olvidado es singular al casar el desbloqueo de un sistema (el Imbuing) con una narrativa de memoria recuperada. Sus jefes y los Halls of Hope dan a la misión un registro extraño y onírico, presentando el poder como algo que se recuerda más que se descubre.',
                    'theories' => 'La naturaleza de los Halls of Hope, quiénes fueron los jefes y por qué se perdió este conocimiento en primer lugar son detalles que los jugadores reconstruyen a partir de los enfrentamientos y los textos del entorno.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Forgotten Knowledge Quest', 'url' => 'https://tibia.fandom.com/wiki/Forgotten_Knowledge_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 18 ──────────────────────────────────────────────────────────
            [
                'slug' => 'soul-war-quest',
                'featured' => false,
                'image' => 'Outfit_Revenant_Male.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 18,
                    'quest_type' => 'World / endgame quest',
                    'region' => 'Zarganash',
                    'recommended_level' => 600,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Zarganash',
                ],
                'en' => [
                    'name' => 'Soul War Quest',
                    'overview' => 'A high-end endgame quest set in the death-realm of Zarganash, where the player joins Goshnar to hunt down the shards of his own shattered personality before they grow strong enough to escape into the living world.',
                    'canon' => 'Its premise is to assist Goshnar and destroy his personality shards before they strengthen and escape to the living world. The quest descends through Zarganash and its nightmarish sub-realms — the Claustrophobic Inferno, the Rotten Wasteland, Ebb and Flow, the Furious Crater and the Mirrored Nightmare — each guarded by a Goshnar boss culminating in Goshnar\'s Megalomania. Rewards include a piece of the Soul Set, the base Revenant outfit and the Soul Mender achievement.',
                    'interpretations' => 'Soul War is one of Tibia\'s most conceptually striking quests: a war fought inside a being\'s fractured psyche, each realm an externalised vice. As an apex endgame challenge it is also a benchmark of cooperative skill, demanding mastery of mechanics few players ever reach.',
                    'theories' => 'Who Goshnar is, how his soul came to splinter, and what it would mean for the shards to reach the living world are deep lore questions the quest dramatises while leaving much to interpretation.',
                ],
                'es' => [
                    'name' => 'La Misión Guerra de las Almas (Soul War)',
                    'overview' => 'Una misión de endgame de altísimo nivel ambientada en el reino de la muerte de Zarganash, donde el jugador se une a Goshnar para dar caza a los fragmentos de su propia personalidad destrozada antes de que se vuelvan lo bastante fuertes como para escapar al mundo de los vivos.',
                    'canon' => 'Su premisa es ayudar a Goshnar y destruir los fragmentos de su personalidad antes de que se fortalezcan y escapen al mundo de los vivos. La misión desciende por Zarganash y sus pesadillescos subreinos —el Claustrophobic Inferno, el Rotten Wasteland, Ebb and Flow, el Furious Crater y el Mirrored Nightmare—, cada uno custodiado por un jefe Goshnar y culminando en Goshnar\'s Megalomania. Las recompensas incluyen una pieza del Soul Set, el atuendo base Revenant y el logro Soul Mender.',
                    'interpretations' => 'Soul War es una de las misiones conceptualmente más impactantes de Tibia: una guerra librada dentro de la psique fracturada de un ser, donde cada reino es un vicio externalizado. Como desafío cumbre del endgame, es también un referente de habilidad cooperativa, que exige un dominio de las mecánicas que pocos jugadores alcanzan.',
                    'theories' => 'Quién es Goshnar, cómo llegó a astillarse su alma y qué significaría que los fragmentos alcanzaran el mundo de los vivos son profundas preguntas de lore que la misión escenifica dejando mucho a la interpretación.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Soul War Quest', 'url' => 'https://tibia.fandom.com/wiki/Soul_War_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 19 ──────────────────────────────────────────────────────────
            [
                'slug' => 'heart-of-destruction-quest',
                'featured' => false,
                'image' => 'Anomaly.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 19,
                    'quest_type' => 'World / endgame quest',
                    'region' => 'The Otherworld',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Zao Steppe',
                ],
                'en' => [
                    'name' => 'Heart of Destruction Quest',
                    'overview' => 'An endgame quest into the Otherworld, where the player fights to stop reality itself from being devoured after the actions of Ferumbras and the minions of the thing from beyond shattered the world.',
                    'canon' => 'Its premise is that the actions of Ferumbras and the sinister minions of "the thing from beyond" (Variphor) have shattered the world, unleashing destructive, unnatural forces that try to devour reality — and must be stopped by destroying its heart. Reached through vortices in the Zao Steppe, Ankrahmun and Svargrond, the quest ranges across the Otherworld against creatures like the Breach Brood, Reality Reaver and Sparkion and bosses such as Anomaly and Outburst. Rewards include the Ender of the End achievement and access to powerful Strike, Void and Vampirism areas.',
                    'interpretations' => 'Heart of Destruction is Tibia at its most cosmic-horror: a quest where the threat is not an army or a demon lord but the unmaking of reality itself. It binds Ferumbras\' ambitions to the looming menace of Variphor, escalating the stakes from conquest to annihilation.',
                    'theories' => 'The exact identity of "the thing from beyond," its link to Variphor and the Secret Library, and the cosmology of the Otherworld are among the most discussed mysteries in modern Tibian lore.',
                ],
                'es' => [
                    'name' => 'La Misión Corazón de la Destrucción',
                    'overview' => 'Una misión de endgame hacia el Otherworld, donde el jugador lucha para impedir que la propia realidad sea devorada después de que las acciones de Ferumbras y los esbirros de la cosa del más allá destrozaran el mundo.',
                    'canon' => 'Su premisa es que las acciones de Ferumbras y los siniestros esbirros de "la cosa del más allá" (Variphor) han destrozado el mundo, desatando fuerzas destructivas y antinaturales que intentan devorar la realidad, y que deben ser detenidas destruyendo su corazón. Al que se accede por vórtices en la Zao Steppe, Ankrahmun y Svargrond, la misión recorre el Otherworld contra criaturas como el Breach Brood, el Reality Reaver y el Sparkion, y jefes como Anomaly y Outburst. Las recompensas incluyen el logro Ender of the End y el acceso a poderosas zonas de Strike, Void y Vampirism.',
                    'interpretations' => 'Heart of Destruction es Tibia en su vertiente más próxima al horror cósmico: una misión donde la amenaza no es un ejército ni un señor demoníaco, sino el deshacerse de la realidad misma. Liga las ambiciones de Ferumbras con la amenaza creciente de Variphor, elevando lo que está en juego de la conquista a la aniquilación.',
                    'theories' => 'La identidad exacta de "la cosa del más allá", su vínculo con Variphor y la Biblioteca Secreta, y la cosmología del Otherworld están entre los misterios más debatidos del lore tibiano moderno.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Heart of Destruction Quest', 'url' => 'https://tibia.fandom.com/wiki/Heart_of_Destruction_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 20 ──────────────────────────────────────────────────────────
            [
                'slug' => 'kilmaresh-quest',
                'featured' => false,
                'image' => 'Bashmu.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 20,
                    'quest_type' => 'Story / access quest',
                    'region' => 'Kilmaresh (Issavi)',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Issavi',
                ],
                'en' => [
                    'name' => 'Kilmaresh Quest',
                    'overview' => 'A story and access quest across the sun-baked southern island of Kilmaresh and its city of Issavi, where the player aids the citizens against desert cults and beasts and earns the Regalia of Suon.',
                    'canon' => 'The quest sends the player to explore the whole island of Kilmaresh and help its citizens, contending with Anuma, Fafnar Cultists, ogres, the serpentine Bashmu and Girtablilu, plus mini-bosses such as Mozradek and Xogixath. Rewards include the four parts of the Regalia of Suon, the Sun and Sea achievement, parts of the Sun Mosaic, the Citizen of Issavi outfit and shortcuts between Issavi and southern Kilmaresh.',
                    'interpretations' => 'Kilmaresh fleshes out one of Tibia\'s more recent regions — a desert-and-sea culture centred on Issavi and sun symbolism. The quest is the player\'s induction into that society, earning citizenship and regalia rather than just loot, and grounding the island as a living place with its own faith and politics.',
                    'theories' => 'The religion around Suon and the sun, the cult of Fafnar, and how Kilmaresh\'s mythology relates to Tibia\'s wider pantheon are threads the region\'s lore invites players to follow.',
                ],
                'es' => [
                    'name' => 'La Misión de Kilmaresh',
                    'overview' => 'Una misión narrativa y de acceso por la abrasadora isla meridional de Kilmaresh y su ciudad de Issavi, donde el jugador ayuda a los ciudadanos contra cultos y bestias del desierto y obtiene la Regalia de Suon.',
                    'canon' => 'La misión envía al jugador a explorar toda la isla de Kilmaresh y a ayudar a sus ciudadanos, lidiando con los Anuma, los Fafnar Cultists, ogros, los serpentinos Bashmu y los Girtablilu, además de minijefes como Mozradek y Xogixath. Las recompensas incluyen las cuatro partes de la Regalia de Suon, el logro Sun and Sea, partes del Sun Mosaic, el atuendo Citizen of Issavi y atajos entre Issavi y el sur de Kilmaresh.',
                    'interpretations' => 'Kilmaresh desarrolla una de las regiones más recientes de Tibia: una cultura de desierto y mar centrada en Issavi y en la simbología solar. La misión es la iniciación del jugador en esa sociedad, ganando ciudadanía e insignias más que simple botín, y consolidando la isla como un lugar vivo con su propia fe y política.',
                    'theories' => 'La religión en torno a Suon y el sol, el culto de Fafnar y cómo se relaciona la mitología de Kilmaresh con el panteón más amplio de Tibia son hilos que el lore de la región invita a seguir.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Kilmaresh Quest', 'url' => 'https://tibia.fandom.com/wiki/Kilmaresh_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 21 ──────────────────────────────────────────────────────────
            [
                'slug' => 'demon-helmet-quest',
                'featured' => false,
                'image' => 'Demon_Helmet.gif',
                'related' => ['demon'],
                'meta' => [
                    'importance_rank' => 21,
                    'quest_type' => 'Challenge quest',
                    'region' => 'Edron',
                    'recommended_level' => 120,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Hero Cave (Edron)',
                ],
                'en' => [
                    'name' => 'Demon Helmet Quest',
                    'overview' => 'The Demon Helmet is the classic sister-trial to the Annihilator, set in the same Hero Cave beneath Edron, where a team braves a room of demons and banshees for one of Tibia\'s most storied helmets.',
                    'canon' => 'Located in the Hero Cave below Edron and recommended for level 120 and up, the quest\'s climactic room pits the party against four Demons and eight Banshees at once, after a descent through dragons, priestesses, demon skeletons and heroes. The reward is the first addon of the Demon outfit together with the Demon Helmet, Demon Shield and Steel Boots.',
                    'interpretations' => 'Alongside the Annihilator, the Demon Helmet defines the Hero Cave as Tibia\'s archetypal high-level team dungeon. Its prize endures as a status symbol from the era when the Demon Helmet was among the best head equipment in the game.',
                    'theories' => 'Like the Annihilator, the quest is light on narrative; its standing rests on difficulty, history and the prestige of its rewards rather than on hidden lore.',
                ],
                'es' => [
                    'name' => 'La Misión del Casco de Demonio (Demon Helmet)',
                    'overview' => 'El Demon Helmet es la clásica prueba hermana del Annihilator, ambientada en la misma Hero Cave bajo Edron, donde un equipo afronta una sala de demonios y banshees por uno de los cascos más legendarios de Tibia.',
                    'canon' => 'Situada en la Hero Cave bajo Edron y recomendada a partir del nivel 120, la sala final de la misión enfrenta al grupo con cuatro Demons y ocho Banshees a la vez, tras un descenso entre dragones, priestesses, demon skeletons y heroes. La recompensa es el primer addon del atuendo de Demonio junto con el Demon Helmet, el Demon Shield y las Steel Boots.',
                    'interpretations' => 'Junto al Annihilator, el Demon Helmet consagra la Hero Cave como la mazmorra de equipo de alto nivel por excelencia de Tibia. Su premio perdura como símbolo de estatus de la época en que el Demon Helmet era de lo mejor en equipo de cabeza del juego.',
                    'theories' => 'Como el Annihilator, la misión es escasa en narrativa; su prestigio se asienta en la dificultad, la historia y la fama de sus recompensas más que en un lore oculto.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Demon Helmet Quest', 'url' => 'https://tibia.fandom.com/wiki/Demon_Helmet_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 22 ──────────────────────────────────────────────────────────
            [
                'slug' => 'black-knight-quest',
                'featured' => false,
                'image' => 'Black_Knight.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 22,
                    'quest_type' => 'Classic / story quest',
                    'region' => 'Venore',
                    'recommended_level' => 50,
                    'access' => 'Free',
                    'party' => 'Solo',
                    'starts_in' => 'Villa Scapula',
                ],
                'en' => [
                    'name' => 'Black Knight Quest',
                    'overview' => 'A beloved classic story quest in which the player confronts the Black Knight — a disgraced former commander of the Royal Army — in his lair at Villa Scapula north of Venore.',
                    'canon' => 'Set in Villa Scapula, the quest\'s premise is that the former commander of the Royal Army was abandoned by his fellow humans and now "has some bones to grind with them." The player fights through skeletons, bonelords and a wyvern to face the Black Knight himself. Notably free (non-premium), it rewards the Crown Armor and Crown Shield.',
                    'interpretations' => 'The Black Knight is one of early Tibia\'s memorable human villains — a tale of betrayal and vengeance rather than monstrous evil. As an accessible free quest with valuable knightly rewards, it has been a milestone for generations of new players.',
                    'theories' => 'Who abandoned the commander and the full story of his fall from the Royal Army are left as evocative background, fleshed out in part by in-game books such as "Black Knight Meets Bonelords."',
                ],
                'es' => [
                    'name' => 'La Misión del Caballero Negro (Black Knight)',
                    'overview' => 'Una querida misión clásica de historia en la que el jugador se enfrenta al Black Knight —un deshonrado antiguo comandante del Royal Army— en su guarida de Villa Scapula, al norte de Venore.',
                    'canon' => 'Ambientada en Villa Scapula, la premisa de la misión es que el antiguo comandante del Royal Army fue abandonado por sus semejantes humanos y ahora "tiene cuentas pendientes con ellos". El jugador combate entre skeletons, bonelords y un wyvern hasta enfrentarse al propio Black Knight. Notablemente gratuita (no premium), recompensa con la Crown Armor y el Crown Shield.',
                    'interpretations' => 'El Black Knight es uno de los villanos humanos memorables de la Tibia temprana: un relato de traición y venganza más que de maldad monstruosa. Como misión gratuita y accesible con valiosas recompensas de caballero, ha sido un hito para generaciones de jugadores nuevos.',
                    'theories' => 'Quién abandonó al comandante y la historia completa de su caída del Royal Army se dejan como un trasfondo evocador, desarrollado en parte por libros del juego como "Black Knight Meets Bonelords".',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Black Knight Quest', 'url' => 'https://tibia.fandom.com/wiki/Black_Knight_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 23 ──────────────────────────────────────────────────────────
            [
                'slug' => 'killing-in-the-name-of-quest',
                'featured' => false,
                'image' => 'Grizzly_Adams.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 23,
                    'quest_type' => 'Task / system quest',
                    'region' => 'All of Tibia',
                    'recommended_level' => 50,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Port Hope',
                ],
                'en' => [
                    'name' => 'Killing in the Name of... Quest',
                    'overview' => 'The quest that unlocks Tibia\'s great hunting-task system: working for Grizzly Adams and the Adventurers\' Guild, the player takes contracts to thin out the world\'s most dangerous creatures and special bosses.',
                    'canon' => 'Its premise is that the dangerous creatures plaguing the lands grow ever more threatening, and the townsfolk need help dealing with them. Completing it unlocks the ability to trade with Grizzly Adams and to take an ongoing series of kill-tasks across the whole world for experience and money, the ability to summon and kill special boss monsters, passage into Tiquanda with Lorek, the Holy Icon, and dozens of achievements.',
                    'interpretations' => 'More a system than a story, "Killing in the Name of..." is one of the most consequential quests in Tibia for everyday play, formalising hunting into a structured progression of tasks and bosses that shaped how players pursue experience for years.',
                    'theories' => 'Its lore is light and practical; the quest\'s importance lies in the gameplay framework it opens rather than in mystery.',
                ],
                'es' => [
                    'name' => 'La Misión Killing in the Name of...',
                    'overview' => 'La misión que desbloquea el gran sistema de tareas de caza de Tibia: al servicio de Grizzly Adams y el Gremio de Aventureros, el jugador acepta contratos para diezmar a las criaturas más peligrosas del mundo y a jefes especiales.',
                    'canon' => 'Su premisa es que las peligrosas criaturas que asolan las tierras son cada vez más amenazantes y los habitantes necesitan ayuda para enfrentarlas. Completarla desbloquea la posibilidad de comerciar con Grizzly Adams y de aceptar una serie continua de tareas de caza por todo el mundo a cambio de experiencia y dinero, la capacidad de invocar y matar jefes especiales, el paso a Tiquanda con Lorek, el Holy Icon y decenas de logros.',
                    'interpretations' => 'Más un sistema que una historia, "Killing in the Name of..." es una de las misiones más trascendentes de Tibia para el juego cotidiano, al formalizar la caza en una progresión estructurada de tareas y jefes que durante años definió cómo los jugadores buscan experiencia.',
                    'theories' => 'Su lore es ligero y práctico; la importancia de la misión reside en el marco de juego que abre más que en el misterio.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Killing in the Name of... Quest', 'url' => 'https://tibia.fandom.com/wiki/Killing_in_the_Name_of..._Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 24 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-ice-islands-quest',
                'featured' => false,
                'image' => 'Barbarian_Bloodwalker.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 24,
                    'quest_type' => 'Access / outfit quest',
                    'region' => 'Svargrond',
                    'recommended_level' => 130,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Svargrond',
                ],
                'en' => [
                    'name' => 'The Ice Islands Quest',
                    'overview' => 'The gateway to Tibia\'s frozen north, in which the player earns the trust of the barbarians of Svargrond and citizenship of their settlement amid the ice islands.',
                    'canon' => 'Its premise is that the jarl, Sven the Younger, is reluctant to accept new citizens into the barbarian settlement of Svargrond, and so sets the player a series of trials. Succeeding earns the Norseman outfit, citizenship of Svargrond, and access to the Formorgar Mines, Helheim and Tyrsung, plus dogsled travel from Nibelor to Inukaya.',
                    'interpretations' => 'The Ice Islands quest is the player\'s induction into Tibia\'s Norse-inspired frozen frontier, framing the barbarians as a proud, insular people who must be earned over rather than simply visited. It opens an entire snowbound region and its culture.',
                    'theories' => 'The history of the Svargrond barbarians, their jarls, and the threats lurking in the deeper ice (and the Formorgar) are developed across the region\'s connected quests rather than this opening alone.',
                ],
                'es' => [
                    'name' => 'La Misión de las Islas de Hielo (Ice Islands)',
                    'overview' => 'La puerta al gélido norte de Tibia, en la que el jugador se gana la confianza de los bárbaros de Svargrond y la ciudadanía de su asentamiento entre las islas de hielo.',
                    'canon' => 'Su premisa es que el jarl, Sven el Joven, es reacio a aceptar nuevos ciudadanos en el asentamiento bárbaro de Svargrond, por lo que somete al jugador a una serie de pruebas. Superarlas otorga el atuendo Norseman, la ciudadanía de Svargrond y el acceso a las Formorgar Mines, Helheim y Tyrsung, además del viaje en trineo de perros de Nibelor a Inukaya.',
                    'interpretations' => 'La misión de las Islas de Hielo es la iniciación del jugador en la helada frontera de inspiración nórdica de Tibia, presentando a los bárbaros como un pueblo orgulloso y cerrado al que hay que ganarse en vez de simplemente visitar. Abre toda una región nevada y su cultura.',
                    'theories' => 'La historia de los bárbaros de Svargrond, sus jarls y las amenazas que acechan en el hielo profundo (y en el Formorgar) se desarrollan a lo largo de las misiones conectadas de la región más que solo en esta apertura.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Ice Islands Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Ice_Islands_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 25 ──────────────────────────────────────────────────────────
            [
                'slug' => 'barbarian-arena-quest',
                'featured' => false,
                'image' => 'Cursed_Gladiator.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 25,
                    'quest_type' => 'Arena / challenge quest',
                    'region' => 'Svargrond',
                    'recommended_level' => 30,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Svargrond Arena',
                ],
                'en' => [
                    'name' => 'Barbarian Arena Quest (Svargrond Arena)',
                    'overview' => 'Tibia\'s signature solo gladiator gauntlet: in the Svargrond Arena the player fights a fixed sequence of unique bosses across three escalating tiers of difficulty.',
                    'canon' => 'In the arena at Svargrond, the player battles a roster of named champions — among them Frostfur, Bloodpaw, Bovinus, the Cursed Gladiator, Orcus the Cruel and The Dark Dancer — alone, one after another. The arena offers three difficulty tiers (Greenhorn, Scrapper and Warlord); clearing them grants a choice of rewards per tier, an inscribed bronze, silver or golden goblet, and the Warlord of Svargrond achievement.',
                    'interpretations' => 'The Svargrond Arena is Tibia\'s purest test of individual skill — no party, no shortcuts, just a player against a parade of bosses. It became a defining solo challenge and a rite of self-measurement for knights, paladins, druids and sorcerers alike.',
                    'theories' => 'The arena is built for spectacle and challenge rather than story; its unique bosses are flavourful set-pieces more than threads of the wider lore.',
                ],
                'es' => [
                    'name' => 'La Misión de la Arena Bárbara (Svargrond Arena)',
                    'overview' => 'El desafío de gladiador en solitario por excelencia de Tibia: en la Arena de Svargrond el jugador combate una secuencia fija de jefes únicos a través de tres niveles crecientes de dificultad.',
                    'canon' => 'En la arena de Svargrond, el jugador batalla en solitario contra una nómina de campeones con nombre —entre ellos Frostfur, Bloodpaw, Bovinus, el Cursed Gladiator, Orcus the Cruel y The Dark Dancer—, uno tras otro. La arena ofrece tres niveles de dificultad (Greenhorn, Scrapper y Warlord); superarlos otorga una elección de recompensas por nivel, un cáliz de bronce, plata u oro con texto grabado y el logro Warlord of Svargrond.',
                    'interpretations' => 'La Arena de Svargrond es la prueba más pura de habilidad individual de Tibia: sin grupo, sin atajos, solo el jugador contra un desfile de jefes. Se convirtió en un desafío en solitario emblemático y en un rito para medirse, lo mismo para caballeros que para paladines, druidas y hechiceros.',
                    'theories' => 'La arena está concebida para el espectáculo y el reto más que para la historia; sus jefes únicos son escenas con carácter más que hilos del lore mayor.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Barbarian Arena Quest', 'url' => 'https://tibia.fandom.com/wiki/Barbarian_Arena_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 26 ──────────────────────────────────────────────────────────
            [
                'slug' => 'roshamuul-quest',
                'featured' => false,
                'image' => 'Guzzlemaw.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 26,
                    'quest_type' => 'Access / lore quest',
                    'region' => 'Roshamuul',
                    'recommended_level' => 200,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Roshamuul',
                ],
                'en' => [
                    'name' => 'Roshamuul Quest',
                    'overview' => 'The quest that opens Roshamuul, a nightmarish prison-island recently discovered by the Inquisition, where unspeakable creatures are kept — and threaten to break free.',
                    'canon' => 'Its premise is that nightmarish creatures are lurking on an island recently found by the Inquisition. Across Roshamuul the player faces Frazzlemaws, Guzzlemaws, Silencers, Choking Fears and the dreamlike Sights of Surrender, working to contain the menace. Rewards include Clusters of Solace and Essences of Dread and Wishful Thinking, plus server-wide access to Guzzlemaw Valley and Upper Roshamuul.',
                    'interpretations' => 'Roshamuul is one of Tibia\'s most distinctive horror settings — a penal island where the Inquisition wardens a host of mind-bending demons and aberrations. The quest frames the player as part of an ongoing effort to keep a lid on something that should never escape.',
                    'theories' => 'What exactly is imprisoned at Roshamuul, who built it, and the Inquisition\'s true purpose there are rich strands of speculation tied to the order\'s wider war on the demonic.',
                ],
                'es' => [
                    'name' => 'La Misión de Roshamuul',
                    'overview' => 'La misión que abre Roshamuul, una pesadillesca isla-prisión recién descubierta por la Inquisición, donde se custodian criaturas indecibles que amenazan con liberarse.',
                    'canon' => 'Su premisa es que criaturas pesadillescas acechan en una isla recién hallada por la Inquisición. Por todo Roshamuul el jugador se enfrenta a Frazzlemaws, Guzzlemaws, Silencers, Choking Fears y los oníricos Sights of Surrender, trabajando para contener la amenaza. Las recompensas incluyen Clusters of Solace y Essences of Dread y Wishful Thinking, además del acceso a nivel de servidor a Guzzlemaw Valley y Upper Roshamuul.',
                    'interpretations' => 'Roshamuul es uno de los escenarios de horror más distintivos de Tibia: una isla penal donde la Inquisición vigila a una hueste de demonios y aberraciones que trastornan la mente. La misión presenta al jugador como parte de un esfuerzo continuo por mantener a raya algo que jamás debería escapar.',
                    'theories' => 'Qué está exactamente encarcelado en Roshamuul, quién lo construyó y el verdadero propósito de la Inquisición allí son ricas vetas de especulación ligadas a la guerra más amplia de la orden contra lo demoníaco.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Roshamuul Quest', 'url' => 'https://tibia.fandom.com/wiki/Roshamuul_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 27 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-dream-courts-quest',
                'featured' => false,
                'image' => 'Maxxenius.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 27,
                    'quest_type' => 'World / endgame quest',
                    'region' => 'Feyrist',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Feyrist',
                ],
                'en' => [
                    'name' => 'The Dream Courts Quest',
                    'overview' => 'A high-level quest into the dreaming realm of the fae, where the player aids both the Court of Summer and the Court of Winter against a threat menacing the whole world.',
                    'canon' => 'Ranging from Edron and Feyrist to the Court of Summer, the Court of Winter and the Dream Labyrinth, the quest\'s premise is that the Summer and Winter Courts need help fighting a great threat to the whole world. The player battles crazed court vanguards, sirens and spectres. Rewards include access to both courts and the Dream Labyrinth and the ability to imbue boots with Powerful Vibrancy.',
                    'interpretations' => 'The Dream Courts deepen Feyrist\'s dreamlike, fairy-tale corner of Tibia, splitting the fae into seasonal courts in the tradition of folklore. It frames the dream realm as a real and contested place whose troubles spill into the waking world.',
                    'theories' => 'The nature of the dream realm, the rivalry of Summer and Winter, and the great threat that unites them are evocative mysteries the region\'s lore keeps partly veiled.',
                ],
                'es' => [
                    'name' => 'La Misión de las Cortes del Sueño (Dream Courts)',
                    'overview' => 'Una misión de alto nivel hacia el reino onírico de las hadas, donde el jugador ayuda tanto a la Corte de Verano como a la Corte de Invierno contra una amenaza que se cierne sobre el mundo entero.',
                    'canon' => 'Extendiéndose desde Edron y Feyrist hasta la Court of Summer, la Court of Winter y el Dream Labyrinth, la premisa de la misión es que las Cortes de Verano e Invierno necesitan ayuda para combatir una gran amenaza para todo el mundo. El jugador batalla contra enloquecidas vanguardias de las cortes, sirenas y espectros. Las recompensas incluyen el acceso a ambas cortes y al Dream Labyrinth, y la capacidad de imbuir botas con Powerful Vibrancy.',
                    'interpretations' => 'Las Cortes del Sueño profundizan el onírico rincón de cuento de hadas de Feyrist en Tibia, dividiendo a las hadas en cortes estacionales en la tradición del folclore. Presentan el reino de los sueños como un lugar real y disputado cuyos problemas se desbordan al mundo de la vigilia.',
                    'theories' => 'La naturaleza del reino de los sueños, la rivalidad entre Verano e Invierno y la gran amenaza que las une son misterios evocadores que el lore de la región mantiene en parte velados.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Dream Courts Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Dream_Courts_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 28 ──────────────────────────────────────────────────────────
            [
                'slug' => 'feaster-of-souls-quest',
                'featured' => false,
                'image' => 'Feaster_of_Souls_-_Death_Knell_1.png',
                'related' => [],
                'meta' => [
                    'importance_rank' => 28,
                    'quest_type' => 'World / lore quest',
                    'region' => 'Netherworld & Zarganash',
                    'recommended_level' => 300,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Brain Grounds',
                ],
                'en' => [
                    'name' => 'Feaster of Souls Quest',
                    'overview' => 'A quest into the realm between life and death, where the player investigates a web of portals leading to the Netherworld and Zarganash to uncover what feasts on souls.',
                    'canon' => 'Its premise is to investigate a series of portals and travel to the Netherworld and Zarganash to uncover the mysteries of the realm between life and death. Across the Brain Grounds, Netherworld, Barren Drift and Zarganash, the player faces lost souls and prospectors, minibosses Unaz the Mean, Irgix the Flimsy and Vok the Freakish, and team bosses. The reward is the Poltergeist outfit and the Prospectre and Beyonder achievements.',
                    'interpretations' => 'Feaster of Souls maps Tibia\'s afterlife as a tangible, traversable geography, linking the death-realm of Zarganash later central to the Soul War. It treats the boundary between living and dead as a place that can be explored, exploited and threatened.',
                    'theories' => 'The mechanics of the soul-realm, the prospectors who mine it, and the entity that feasts on souls connect to deeper questions about undeath and the gods that the Zarganash quests circle around.',
                ],
                'es' => [
                    'name' => 'La Misión del Devorador de Almas (Feaster of Souls)',
                    'overview' => 'Una misión hacia el reino entre la vida y la muerte, donde el jugador investiga una red de portales que llevan al Netherworld y a Zarganash para descubrir qué se alimenta de las almas.',
                    'canon' => 'Su premisa es investigar una serie de portales y viajar al Netherworld y a Zarganash para desvelar los misterios del reino entre la vida y la muerte. Por las Brain Grounds, el Netherworld, el Barren Drift y Zarganash, el jugador se enfrenta a almas perdidas y prospectores, a los minijefes Unaz the Mean, Irgix the Flimsy y Vok the Freakish, y a jefes de equipo. La recompensa es el atuendo Poltergeist y los logros Prospectre y Beyonder.',
                    'interpretations' => 'Feaster of Souls cartografía el más allá de Tibia como una geografía tangible y transitable, enlazando con el reino de la muerte de Zarganash, después central en la Soul War. Trata la frontera entre vivos y muertos como un lugar que puede explorarse, explotarse y amenazarse.',
                    'theories' => 'Las mecánicas del reino de las almas, los prospectores que lo explotan y la entidad que se alimenta de almas conectan con preguntas más profundas sobre la no-muerte y los dioses en torno a los cuales giran las misiones de Zarganash.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Feaster of Souls Quest', 'url' => 'https://tibia.fandom.com/wiki/Feaster_of_Souls_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 29 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-order-of-the-lion-quest',
                'featured' => false,
                'image' => 'Drume.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 29,
                    'quest_type' => 'Story / faction quest',
                    'region' => 'Bounac',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Bounac',
                ],
                'en' => [
                    'name' => 'The Order of the Lion Quest',
                    'overview' => 'A knightly siege story set in Bounac, in which the player earns the trust of the Order of the Lion and helps defend their castle against usurpers.',
                    'canon' => 'Its premise is to gain the trust of the Order of the Lion and help them fight the usurpers trying to seize control of their castle in Bounac. The player contends with members of the Order and the conflict\'s commanders. Rewards include the Lionheart achievement, the title "Hero of Bounac," and the chance to kill bosses for pieces of the Lion Set.',
                    'interpretations' => 'The Order of the Lion gives Tibia a self-contained tale of chivalry, loyalty and civil strife — a besieged knightly order and a contested castle. It is a focused political drama rather than a cosmic threat, grounding Bounac as a place with its own honour and factions.',
                    'theories' => 'The history of the Order, the legitimacy of the usurpers, and Bounac\'s place in the wider world are background the quest sketches and leaves open.',
                ],
                'es' => [
                    'name' => 'La Misión de la Orden del León (Order of the Lion)',
                    'overview' => 'Una historia de asedio caballeresco ambientada en Bounac, en la que el jugador se gana la confianza de la Orden del León y ayuda a defender su castillo de unos usurpadores.',
                    'canon' => 'Su premisa es ganarse la confianza de la Order of the Lion y ayudarles a combatir a los usurpadores que intentan hacerse con el control de su castillo en Bounac. El jugador se enfrenta a miembros de la Orden y a los comandantes del conflicto. Las recompensas incluyen el logro Lionheart, el título "Hero of Bounac" y la posibilidad de matar jefes para conseguir piezas del Lion Set.',
                    'interpretations' => 'La Orden del León brinda a Tibia un relato autónomo de caballería, lealtad y guerra civil: una orden de caballeros asediada y un castillo disputado. Es un drama político concentrado más que una amenaza cósmica, que afianza Bounac como un lugar con su propio honor y sus facciones.',
                    'theories' => 'La historia de la Orden, la legitimidad de los usurpadores y el lugar de Bounac en el mundo más amplio son trasfondos que la misión esboza y deja abiertos.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Order of the Lion Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Order_of_the_Lion_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 30 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-first-dragon-quest',
                'featured' => false,
                'image' => 'The_First_Dragon.gif',
                'related' => [],
                'meta' => [
                    'importance_rank' => 30,
                    'quest_type' => 'Lore / boss quest',
                    'region' => 'All of Tibia',
                    'recommended_level' => 200,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Various',
                ],
                'en' => [
                    'name' => 'The First Dragon Quest',
                    'overview' => 'A lore quest chasing the origin of dragonkind itself, as the player follows clues about the very first dragon to make contact with humans and confronts a lineage of dragon bosses.',
                    'canon' => 'Its premise follows new clues about the first dragon that had direct contact with humans — Garsharak\'s son — gathered from informants such as the chatterbox Vigintius. The hunt ranges all over Tibia against a variety of dragons and the bosses Kalyassa, Gelidrazah the Frozen, Tazhadur and Zorvorax, culminating in The First Dragon itself.',
                    'interpretations' => 'The First Dragon reaches back into Tibia\'s deep mythology, treating dragons not just as monsters but as an ancient bloodline with a genesis tied to early human history. It is one of the clearest quests devoted purely to uncovering origin lore.',
                    'theories' => 'Garsharak, the lineage of the elemental dragon bosses, and what the First Dragon\'s contact with humanity truly meant are central threads for those tracing the deep history of dragonkind.',
                ],
                'es' => [
                    'name' => 'La Misión del Primer Dragón (The First Dragon)',
                    'overview' => 'Una misión de lore que persigue el origen mismo de los dragones, mientras el jugador sigue pistas sobre el primerísimo dragón que tuvo contacto con los humanos y se enfrenta a un linaje de jefes dragón.',
                    'canon' => 'Su premisa sigue nuevas pistas sobre el primer dragón que tuvo contacto directo con los humanos —el hijo de Garsharak—, recogidas de informantes como el parlanchín Vigintius. La caza recorre toda Tibia contra una variedad de dragones y los jefes Kalyassa, Gelidrazah the Frozen, Tazhadur y Zorvorax, culminando en el propio The First Dragon.',
                    'interpretations' => 'El Primer Dragón se adentra en la mitología profunda de Tibia, tratando a los dragones no solo como monstruos, sino como un linaje antiguo cuyo génesis se vincula a la historia humana temprana. Es una de las misiones más claramente dedicadas a desvelar lore de orígenes.',
                    'theories' => 'Garsharak, el linaje de los jefes dragón elementales y qué significó realmente el contacto del Primer Dragón con la humanidad son hilos centrales para quienes rastrean la historia profunda de los dragones.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The First Dragon Quest', 'url' => 'https://tibia.fandom.com/wiki/The_First_Dragon_Quest'],
                    ['type' => SourceType::OfficialArticle->value, 'title' => 'Official Tibia', 'url' => 'https://www.tibia.com'],
                ],
            ],

            // 31 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-outlaw-camp-quest',
                'featured' => false,
                'image' => 'Dwarven_Shield.gif',
                'related' => ['thais'],
                'meta' => [
                    'quest_type' => 'Classic / starter quest',
                    'region' => 'Thais',
                    'recommended_level' => 8,
                    'access' => 'Free',
                    'party' => 'Solo',
                    'starts_in' => 'Outlaw Camp (near Thais)',
                ],
                'en' => [
                    'name' => 'The Outlaw Camp Quest',
                    'overview' => 'One of the first real adventures a Thais-based character can attempt: a raid on the bandit camp north of the city, long used as a rite of passage for low-level free players.',
                    'canon' => 'The quest takes place in the Outlaw Camp north of Thais, a fortified bandit hideout. The player fights through its defenders to reach the treasure chests within. It is a free-account quest with no premium requirement, traditionally one of the earliest goals a new mainland character pursues.',
                    'interpretations' => 'The Outlaw Camp endures less for its story than for its role as a teaching ground — an early taste of organised danger and reward that introduces new players to dungeon-style questing.',
                    'theories' => 'There is little hidden lore here; the camp is remembered as a classic stepping-stone rather than a thread into the wider mythology.',
                ],
                'es' => [
                    'name' => 'La Misión del Campamento de Forajidos (Outlaw Camp)',
                    'overview' => 'Una de las primeras aventuras de verdad que puede intentar un personaje afincado en Thais: un asalto al campamento de bandidos al norte de la ciudad, usado durante años como rito de paso para jugadores free de bajo nivel.',
                    'canon' => 'La misión transcurre en el Outlaw Camp al norte de Thais, un escondite de bandidos fortificado. El jugador se abre paso entre sus defensores para alcanzar los cofres del tesoro del interior. Es una misión para cuentas free, sin requisito premium, y tradicionalmente uno de los primeros objetivos de un personaje nuevo en el continente.',
                    'interpretations' => 'El Campamento de Forajidos perdura menos por su historia que por su papel como campo de aprendizaje: un primer contacto con el peligro organizado y la recompensa que introduce a los jugadores nuevos en las misiones de mazmorra.',
                    'theories' => 'Aquí hay poco lore oculto; el campamento se recuerda como un trampolín clásico más que como un hilo hacia la mitología mayor.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Outlaw Camp Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Outlaw_Camp_Quest'],
                ],
            ],

            // 32 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-travelling-trader-quest',
                'featured' => false,
                'image' => 'Bag_You_Desire.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Service / reward quest',
                    'region' => 'Mainland',
                    'recommended_level' => 10,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Rashid (travelling merchant)',
                ],
                'en' => [
                    'name' => 'The Travelling Trader Quest',
                    'overview' => 'A beloved errand quest centred on the wandering merchant Rashid, famous as the path to the coveted Bag you Desire — an upgraded backpack and a quality-of-life staple for generations of players.',
                    'canon' => 'The quest follows Rashid, the travelling trader who visits a different city each day of the week. By running his errands and meeting his conditions the player earns the ability to sell to him and, most famously, obtains the Bag you Desire. It carries little combat danger and is prized as one of the great convenience quests.',
                    'interpretations' => 'Rashid and his weekly circuit give the mainland a recurring, human rhythm, and the quest cements him as one of Tibia\'s most useful NPCs. Its appeal is practical: a reward that quietly improves everyday play for years.',
                    'theories' => 'Rashid\'s past and why he is condemned to wander from city to city are touched on in his dialogue and remain a small but cherished piece of NPC lore.',
                ],
                'es' => [
                    'name' => 'La Misión del Comerciante Viajero (Travelling Trader)',
                    'overview' => 'Una querida misión de recados centrada en el mercader errante Rashid, famosa por ser el camino hacia la codiciada Bag you Desire: una mochila mejorada y un básico de comodidad para generaciones de jugadores.',
                    'canon' => 'La misión sigue a Rashid, el comerciante viajero que visita una ciudad distinta cada día de la semana. Haciendo sus recados y cumpliendo sus condiciones, el jugador obtiene la posibilidad de venderle y, sobre todo, consigue la Bag you Desire. Conlleva poco peligro de combate y se valora como una de las grandes misiones de comodidad.',
                    'interpretations' => 'Rashid y su circuito semanal dan al continente un ritmo recurrente y humano, y la misión lo consolida como uno de los NPCs más útiles de Tibia. Su atractivo es práctico: una recompensa que mejora discretamente el juego cotidiano durante años.',
                    'theories' => 'El pasado de Rashid y por qué está condenado a vagar de ciudad en ciudad se insinúan en sus diálogos y siguen siendo una pequeña pero apreciada pieza del lore de NPCs.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Travelling Trader Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Travelling_Trader_Quest'],
                ],
            ],

            // 33 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-explorer-society-quest',
                'featured' => false,
                'image' => 'Explorer_Brooch.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Society / task quest',
                    'region' => 'Port Hope & beyond',
                    'recommended_level' => 25,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Explorer Society outpost (Port Hope)',
                ],
                'en' => [
                    'name' => 'The Explorer Society Quest',
                    'overview' => 'A long-running series of small tasks for the Royal Explorer Society, sending the player across Tibia to study creatures and curiosities in exchange for the Explorer Brooch and the society\'s favour.',
                    'canon' => 'Beginning at the Explorer Society outpost near Port Hope, the quest is a collection of missions handed out by the society\'s scholars — gathering specimens, observing creatures and exploring far corners of the world. Completing them earns the Explorer Brooch and standing with the society.',
                    'interpretations' => 'The Explorer Society frames adventuring as scholarship: the player as a field researcher rather than a treasure hunter. It threads many distant locations together under a single, gently academic banner.',
                    'theories' => 'The society\'s broader aims and the gaps in its knowledge are part of the quest\'s charm, encouraging players to see the world as something still being mapped and catalogued.',
                ],
                'es' => [
                    'name' => 'La Misión de la Sociedad de Exploradores (Explorer Society)',
                    'overview' => 'Una larga serie de pequeñas tareas para la Royal Explorer Society, que envía al jugador por toda Tibia a estudiar criaturas y curiosidades a cambio del Explorer Brooch y el favor de la sociedad.',
                    'canon' => 'Comenzando en el puesto de la Explorer Society cerca de Port Hope, la misión es un conjunto de encargos que reparten los eruditos de la sociedad: recoger especímenes, observar criaturas y explorar rincones lejanos del mundo. Completarlos otorga el Explorer Brooch y prestigio ante la sociedad.',
                    'interpretations' => 'La Explorer Society presenta la aventura como erudición: el jugador como investigador de campo más que como cazatesoros. Hilvana muchos lugares lejanos bajo una misma bandera, suavemente académica.',
                    'theories' => 'Los objetivos más amplios de la sociedad y los huecos de su conocimiento forman parte del encanto de la misión, e invitan a ver el mundo como algo que aún se está cartografiando y catalogando.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Explorer Society Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Explorer_Society_Quest'],
                ],
            ],

            // 34 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-scatterbrained-sorcerer-quest',
                'featured' => false,
                'image' => 'Ring_of_the_Sky.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Classic / errand quest',
                    'region' => 'Edron',
                    'recommended_level' => 30,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Edron',
                ],
                'en' => [
                    'name' => 'The Scatterbrained Sorcerer Quest',
                    'overview' => 'A whimsical errand quest in which the player aids a forgetful old sorcerer near Edron, running his odd tasks in return for magical rewards.',
                    'canon' => 'Set around Edron, the quest centres on a scatterbrained old mage who needs the player\'s help with a string of errands. Working through his requests earns the player his gratitude and rewards, including enchanted gear of interest to mid-level adventurers.',
                    'interpretations' => 'The Scatterbrained Sorcerer is part of Tibia\'s tradition of light, character-driven quests — comic relief and personality rather than world-shaking stakes, anchoring Edron as a place full of eccentric residents.',
                    'theories' => 'The sorcerer\'s history and the true nature of his absent-mindedness are played for charm rather than mystery, with little deeper lore intended.',
                ],
                'es' => [
                    'name' => 'La Misión del Hechicero Despistado (Scatterbrained Sorcerer)',
                    'overview' => 'Una caprichosa misión de recados en la que el jugador ayuda a un viejo hechicero olvidadizo cerca de Edron, haciendo sus extrañas tareas a cambio de recompensas mágicas.',
                    'canon' => 'Ambientada en torno a Edron, la misión gira en torno a un viejo mago despistado que necesita la ayuda del jugador con una serie de recados. Cumplir sus peticiones otorga su gratitud y recompensas, entre ellas equipo encantado de interés para aventureros de nivel medio.',
                    'interpretations' => 'El Hechicero Despistado forma parte de la tradición de Tibia de misiones ligeras y guiadas por personajes: alivio cómico y carácter más que apuestas que sacudan el mundo, afianzando Edron como un lugar lleno de residentes excéntricos.',
                    'theories' => 'La historia del hechicero y la verdadera causa de su despiste se juegan por su encanto más que por el misterio, sin un lore más profundo pretendido.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Scatterbrained Sorcerer Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Scatterbrained_Sorcerer_Quest'],
                ],
            ],

            // 35 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-queen-of-the-banshees-quest',
                'featured' => false,
                'image' => 'Queen_of_the_Banshees.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Puzzle / boss quest',
                    'region' => 'Maze of the Banshees',
                    'recommended_level' => 60,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Maze of the Banshees',
                ],
                'en' => [
                    'name' => 'The Queen of the Banshees Quest',
                    'overview' => 'A famously long and intricate quest through the Maze of the Banshees, demanding patience and exploration to reach and defeat the Queen of the Banshees herself.',
                    'canon' => 'Set in the sprawling Maze of the Banshees, the quest is a multi-stage descent through traps, locked passages and undead — banshees, ghosts and worse — toward a confrontation with the Queen of the Banshees. It is remembered as one of Tibia\'s most demanding mid-level quests, rewarding thorough exploration with access and treasure.',
                    'interpretations' => 'The quest is a showcase of Tibia\'s maze-and-puzzle design, its difficulty lying as much in navigation and persistence as in combat. The Queen anchors the banshees as a courtly, undead power rather than mere wandering spirits.',
                    'theories' => 'The origin of the Queen and her court, and the purpose of the great maze built around her, are left atmospheric and open, part of the quest\'s eerie appeal.',
                ],
                'es' => [
                    'name' => 'La Misión de la Reina de las Banshees (Queen of the Banshees)',
                    'overview' => 'Una misión célebre por su longitud y complejidad a través del Maze of the Banshees, que exige paciencia y exploración para llegar y derrotar a la propia Reina de las Banshees.',
                    'canon' => 'Ambientada en el laberíntico Maze of the Banshees, la misión es un descenso de varias fases entre trampas, pasajes cerrados y no-muertos —banshees, fantasmas y cosas peores— hacia un enfrentamiento con la Queen of the Banshees. Se recuerda como una de las misiones de nivel medio más exigentes de Tibia, que premia la exploración minuciosa con acceso y tesoro.',
                    'interpretations' => 'La misión es un escaparate del diseño de laberintos y rompecabezas de Tibia, con una dificultad que reside tanto en la navegación y la constancia como en el combate. La Reina afianza a las banshees como un poder cortesano y no-muerto, más que como simples espíritus errantes.',
                    'theories' => 'El origen de la Reina y su corte, y el propósito del gran laberinto construido a su alrededor, se dejan atmosféricos y abiertos, parte del inquietante atractivo de la misión.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Queen of the Banshees Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Queen_of_the_Banshees_Quest'],
                ],
            ],

            // 36 ──────────────────────────────────────────────────────────
            [
                'slug' => 'bigfoots-burden-quest',
                'featured' => false,
                'image' => 'Gnome.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Access / faction quest',
                    'region' => 'Warzones (deep underground)',
                    'recommended_level' => 80,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Gnomprona / gnome outpost',
                ],
                'en' => [
                    'name' => 'Bigfoot\'s Burden Quest',
                    'overview' => 'The great gnome quest, in which the player earns the trust of the gnomes and opens the deep Warzones — a series of progressively harder underground battlegrounds and their bosses.',
                    'canon' => 'Working with the gnomes through their burden of holding back the threats below, the quest unlocks the Warzones (Warzone 1, 2 and 3) and a chain of tasks and rewards. It is a gateway to a whole tier of mid-to-high-level group hunting and to the gnome outfits and associated achievements.',
                    'interpretations' => 'Bigfoot\'s Burden defines the gnomes as Tibia\'s diggers and frontier engineers, perpetually holding a line against what lurks deeper in the earth. The Warzones turn that premise into escalating, team-oriented content.',
                    'theories' => 'What ultimately lies beneath the Warzones, and the full extent of the gnomes\' long war underground, are threads the quest opens and later content continues to explore.',
                ],
                'es' => [
                    'name' => 'La Misión Bigfoot\'s Burden',
                    'overview' => 'La gran misión de los gnomos, en la que el jugador se gana la confianza de los gnomos y abre las profundas Warzones: una serie de campos de batalla subterráneos cada vez más difíciles y sus jefes.',
                    'canon' => 'Colaborando con los gnomos en su carga de contener las amenazas de las profundidades, la misión desbloquea las Warzones (Warzone 1, 2 y 3) y una cadena de tareas y recompensas. Es la puerta de entrada a todo un nivel de caza en grupo de nivel medio-alto y a los atuendos de gnomo y sus logros asociados.',
                    'interpretations' => 'Bigfoot\'s Burden define a los gnomos como los excavadores e ingenieros de frontera de Tibia, que sostienen sin descanso una línea frente a lo que acecha en lo más hondo de la tierra. Las Warzones convierten esa premisa en contenido en grupo de dificultad creciente.',
                    'theories' => 'Qué se esconde finalmente bajo las Warzones, y el alcance pleno de la larga guerra subterránea de los gnomos, son hilos que la misión abre y que el contenido posterior sigue explorando.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Bigfoot\'s Burden Quest', 'url' => 'https://tibia.fandom.com/wiki/Bigfoot%27s_Burden_Quest'],
                ],
            ],

            // 37 ──────────────────────────────────────────────────────────
            [
                'slug' => 'ferumbras-ascension-quest',
                'featured' => false,
                'image' => 'Ferumbras_Mortal_Shell.gif',
                'related' => ['demon'],
                'meta' => [
                    'quest_type' => 'World / boss quest',
                    'region' => 'Ferumbras\' Citadel',
                    'recommended_level' => 120,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Edron / Ferumbras\' Citadel',
                ],
                'en' => [
                    'name' => 'Ferumbras\' Ascension Quest',
                    'overview' => 'A major endgame boss quest set in Ferumbras\' Citadel, where teams battle a roster of powerful bosses tied to the archmage\'s power and his Mortal Shell.',
                    'canon' => 'Set in Ferumbras\' Citadel, the quest pits parties against a series of bosses — including the Mortal Shell of Ferumbras and other lieutenants — in a layered fortress. It is built around organised team play and yields high-tier rewards, including unique items and access to repeatable boss fights.',
                    'interpretations' => 'The quest reframes Ferumbras, the game\'s archetypal villain-mage, as an ongoing endgame threat whose power persists beyond any single defeat — a citadel of his making that adventurers return to again and again.',
                    'theories' => 'The relationship between Ferumbras\' "ascension," his Mortal Shell and his ties to the Ruthless Seven feeds long-running discussion about how the archmage cheats death and what his ultimate ambition truly is.',
                ],
                'es' => [
                    'name' => 'La Misión de la Ascensión de Ferumbras (Ferumbras\' Ascension)',
                    'overview' => 'Una gran misión de jefes de endgame ambientada en la Ferumbras\' Citadel, donde los equipos combaten contra un elenco de poderosos jefes ligados al poder del archimago y a su Mortal Shell.',
                    'canon' => 'Ambientada en la Ferumbras\' Citadel, la misión enfrenta a los grupos contra una serie de jefes —entre ellos la Mortal Shell de Ferumbras y otros lugartenientes— en una fortaleza de varios niveles. Está construida en torno al juego en equipo organizado y otorga recompensas de alto nivel, incluidos objetos únicos y acceso a combates de jefe repetibles.',
                    'interpretations' => 'La misión replantea a Ferumbras, el mago-villano arquetípico del juego, como una amenaza de endgame continua cuyo poder persiste más allá de cualquier derrota puntual: una ciudadela de su propia hechura a la que los aventureros regresan una y otra vez.',
                    'theories' => 'La relación entre la "ascensión" de Ferumbras, su Mortal Shell y sus vínculos con los Siete Despiadados alimenta un debate de larga data sobre cómo el archimago burla la muerte y cuál es su ambición última.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Ferumbras\' Ascension', 'url' => 'https://tibia.fandom.com/wiki/Ferumbras%27_Ascension'],
                ],
            ],

            // 38 ──────────────────────────────────────────────────────────
            [
                'slug' => 'a-pirates-tail-quest',
                'featured' => false,
                'image' => 'Pirate_Hat.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Story / access quest',
                    'region' => 'Southern seas',
                    'recommended_level' => 120,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Liberty Bay area',
                ],
                'en' => [
                    'name' => 'A Pirate\'s Tail Quest',
                    'overview' => 'A seafaring story quest of pirates and lost crews in Tibia\'s southern waters, opening new island content and a string of nautical rewards.',
                    'canon' => 'A story-driven quest set among the southern seas and their pirate culture, in which the player becomes entangled in a tale of ships, crews and buried trouble. It opens new locations and offers themed rewards, expanding the swashbuckling corner of the world first defined by the Shattered Isles.',
                    'interpretations' => 'A Pirate\'s Tail leans into Tibia\'s lighter, adventurous register — sea travel, pirate lore and discovery — giving the southern waters fresh stories long after the original pirate quests.',
                    'theories' => 'How its events connect to the older feuds of Meriana, Nargor and Goldenland is part of the fun for players tracking the continuity of Tibia\'s pirate saga.',
                ],
                'es' => [
                    'name' => 'La Misión A Pirate\'s Tail',
                    'overview' => 'Una misión narrativa marinera de piratas y tripulaciones perdidas en las aguas del sur de Tibia, que abre nuevo contenido isleño y una serie de recompensas náuticas.',
                    'canon' => 'Una misión guiada por la historia, ambientada en los mares del sur y su cultura pirata, en la que el jugador se ve enredado en un relato de barcos, tripulaciones y problemas enterrados. Abre nuevas ubicaciones y ofrece recompensas temáticas, ampliando el rincón de aventura pirata del mundo que definieron por primera vez las Shattered Isles.',
                    'interpretations' => 'A Pirate\'s Tail se apoya en el registro más ligero y aventurero de Tibia —viaje por mar, lore pirata y descubrimiento—, dando a las aguas del sur historias nuevas mucho después de las misiones piratas originales.',
                    'theories' => 'Cómo se conectan sus sucesos con las viejas disputas de Meriana, Nargor y Goldenland es parte de la diversión para quienes siguen la continuidad de la saga pirata de Tibia.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: A Pirate\'s Tail Quest', 'url' => 'https://tibia.fandom.com/wiki/A_Pirate%27s_Tail_Quest'],
                ],
            ],

            // 39 ──────────────────────────────────────────────────────────
            [
                'slug' => 'dangerous-depths-quest',
                'featured' => false,
                'image' => 'The_Baron_from_Below.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Access / endgame quest',
                    'region' => 'Deep caverns (Kazordoon & Gnomprona)',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Gnome outposts',
                ],
                'en' => [
                    'name' => 'Dangerous Depths Quest',
                    'overview' => 'A high-level continuation of the gnome and dwarf struggle underground, opening deep cavern hunting grounds and powerful bosses like the lava-dwelling threats far below.',
                    'canon' => 'Continuing the gnomes\' and dwarves\' war against what lies beneath, the quest opens deep cave regions and introduces endgame bosses including The Baron from Below, The Count of the Core and The Duke of the Depths. It is built around high-level group play, with access, achievements and strong rewards.',
                    'interpretations' => 'Dangerous Depths pushes the gnome storyline into true endgame territory, escalating the "burden" of holding the underground into a war against named lords of the deep — a vertical frontier that keeps expanding downward.',
                    'theories' => 'The identity of the depth lords and what ultimately drives the things in the lava remain open threads tying Dangerous Depths to the wider gnome and dwarf mythology.',
                ],
                'es' => [
                    'name' => 'La Misión Dangerous Depths',
                    'overview' => 'Una continuación de alto nivel de la lucha de gnomos y enanos en las profundidades, que abre zonas de caza en cavernas profundas y poderosos jefes como las amenazas que habitan la lava en lo más hondo.',
                    'canon' => 'Continuando la guerra de gnomos y enanos contra lo que yace debajo, la misión abre regiones de cuevas profundas e introduce jefes de endgame como The Baron from Below, The Count of the Core y The Duke of the Depths. Está construida en torno al juego en grupo de alto nivel, con acceso, logros y recompensas potentes.',
                    'interpretations' => 'Dangerous Depths lleva la trama de los gnomos a un terreno de endgame de verdad, elevando la "carga" de contener las profundidades hasta convertirla en una guerra contra señores con nombre del subsuelo: una frontera vertical que no deja de extenderse hacia abajo.',
                    'theories' => 'La identidad de los señores de las profundidades y qué impulsa en última instancia a las criaturas de la lava siguen siendo hilos abiertos que enlazan Dangerous Depths con la mitología más amplia de gnomos y enanos.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Dangerous Depths Quest', 'url' => 'https://tibia.fandom.com/wiki/Dangerous_Depths_Quest'],
                ],
            ],

            // 40 ──────────────────────────────────────────────────────────
            [
                'slug' => 'grave-danger-quest',
                'featured' => false,
                'image' => 'Skull_Staff.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Boss / reward quest',
                    'region' => 'Various',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Various',
                ],
                'en' => [
                    'name' => 'Grave Danger Quest',
                    'overview' => 'A high-level boss quest centred on a rogues\' gallery of powerful enemies, granting access to repeatable boss encounters and sought-after endgame rewards.',
                    'canon' => 'The quest sends high-level adventurers against a roster of dangerous bosses, unlocking repeatable fights and rewards aimed at the endgame. It is structured around organised team play, with achievements and valuable loot for those who clear its toughest encounters.',
                    'interpretations' => 'Grave Danger is emblematic of Tibia\'s modern endgame design: a hub of challenging, repeatable boss content rather than a single linear story, built to give high-level characters lasting goals.',
                    'theories' => 'The connections between its various bosses and the broader lore they each belong to give theory-minded players threads to pull, even as the quest\'s main draw is the challenge itself.',
                ],
                'es' => [
                    'name' => 'La Misión Grave Danger',
                    'overview' => 'Una misión de jefes de alto nivel centrada en una galería de enemigos poderosos, que otorga acceso a combates de jefe repetibles y a codiciadas recompensas de endgame.',
                    'canon' => 'La misión envía a aventureros de alto nivel contra un elenco de jefes peligrosos, desbloqueando combates repetibles y recompensas orientadas al endgame. Está estructurada en torno al juego en equipo organizado, con logros y botín valioso para quienes superan sus enfrentamientos más duros.',
                    'interpretations' => 'Grave Danger es emblemática del diseño de endgame moderno de Tibia: un núcleo de contenido de jefes desafiante y repetible, más que una única historia lineal, pensado para dar a los personajes de alto nivel objetivos duraderos.',
                    'theories' => 'Las conexiones entre sus distintos jefes y el lore más amplio al que pertenece cada uno dan hilos de los que tirar a los jugadores aficionados a las teorías, aunque el principal reclamo de la misión sea el propio desafío.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Grave Danger Quest', 'url' => 'https://tibia.fandom.com/wiki/Grave_Danger_Quest'],
                ],
            ],

            // 41 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-rookie-guard-quest',
                'featured' => false,
                'image' => 'Sabre.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Tutorial questline',
                    'region' => 'Rookgaard',
                    'recommended_level' => 2,
                    'access' => 'Free',
                    'party' => 'Solo',
                    'starts_in' => 'Rookgaard (Academy)',
                ],
                'en' => [
                    'name' => 'The Rookie Guard Quest',
                    'overview' => 'The guided first-steps questline of Rookgaard, walking brand-new characters through the island\'s basics as a recruit of the local guard.',
                    'canon' => 'Set entirely on Rookgaard, the starter island, the quest enrolls the new player into the Rookie Guard and leads them through a chain of small missions that teach movement, fighting, looting and trading. Rewards are starter gear — a Sabre, Sword, Brass Helmet, Studded Armor and the like — meant to outfit a character for the climb toward the mainland.',
                    'interpretations' => 'More tutorial than tale, the Rookie Guard quest is the modern on-ramp to Tibia, framing the first hours of play as basic training before a character earns passage off Rookgaard.',
                    'theories' => 'There is no deep lore here; its significance is as the shared first chapter of nearly every Tibian\'s journey.',
                ],
                'es' => [
                    'name' => 'La Misión de la Guardia Novata (Rookie Guard)',
                    'overview' => 'La misión guiada de primeros pasos de Rookgaard, que lleva a los personajes recién creados por lo básico de la isla como recluta de la guardia local.',
                    'canon' => 'Ambientada por completo en Rookgaard, la isla de inicio, la misión alista al jugador nuevo en la Rookie Guard y lo guía por una cadena de pequeñas tareas que enseñan a moverse, luchar, lootear y comerciar. Las recompensas son equipo inicial —un Sabre, una Sword, un Brass Helmet, una Studded Armor y similares— pensado para equipar al personaje de cara a su ascenso hacia el continente.',
                    'interpretations' => 'Más tutorial que relato, la misión de la Rookie Guard es la rampa de entrada moderna a Tibia: presenta las primeras horas de juego como un entrenamiento básico antes de que un personaje se gane el paso fuera de Rookgaard.',
                    'theories' => 'Aquí no hay lore profundo; su importancia es la de ser el primer capítulo compartido del viaje de casi todo tibiano.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Rookie Guard Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Rookie_Guard_Quest'],
                ],
            ],

            // 42 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-desert-dungeon-quest',
                'featured' => false,
                'image' => 'Protection_Amulet.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Classic / vocation quest',
                    'region' => 'Jakundaf Desert',
                    'recommended_level' => 20,
                    'access' => 'Free',
                    'party' => 'Team (one of each vocation)',
                    'starts_in' => 'Jakundaf Desert',
                ],
                'en' => [
                    'name' => 'The Desert Dungeon Quest',
                    'overview' => 'A classic free-account team quest — fondly called the "10k" or Vocation Quest — hidden deep beneath the Jakundaf Desert, where four vocations must cooperate to claim its treasure.',
                    'canon' => 'Deep below the Jakundaf Desert lies an old, complex dungeon whose secret can only be opened with the four base vocations working together. Each participating vocation earns a Golden Bag with 25 Platinum Coins, alongside a shared Green Bag holding a Protection Amulet, Ring of Healing, Magic Light Wand and an Ankh.',
                    'interpretations' => 'The Desert Dungeon is one of Tibia\'s oldest cooperative puzzles, remembered as an early team milestone and a teaching example of how the four vocations were designed to complement one another.',
                    'theories' => 'Its "old myth, buried by the sands of time" framing is pure atmosphere; the quest endures for its gameplay and its nostalgia rather than any deeper mystery.',
                ],
                'es' => [
                    'name' => 'La Misión de la Mazmorra del Desierto (Desert Dungeon)',
                    'overview' => 'Una clásica misión en equipo para cuentas free —llamada con cariño la "10k" o Misión de Vocaciones— escondida en lo profundo del Jakundaf Desert, donde cuatro vocaciones deben cooperar para reclamar su tesoro.',
                    'canon' => 'En lo profundo bajo el Jakundaf Desert yace una mazmorra antigua y compleja cuyo secreto solo puede abrirse con las cuatro vocaciones base trabajando juntas. Cada vocación participante obtiene una Golden Bag con 25 Platinum Coins, junto a una Green Bag compartida con un Protection Amulet, un Ring of Healing, una Magic Light Wand y un Ankh.',
                    'interpretations' => 'La Mazmorra del Desierto es uno de los rompecabezas cooperativos más antiguos de Tibia, recordada como un hito temprano de equipo y como ejemplo didáctico de cómo se diseñaron las cuatro vocaciones para complementarse.',
                    'theories' => 'Su marco de "viejo mito sepultado por las arenas del tiempo" es pura ambientación; la misión perdura por su jugabilidad y su nostalgia más que por ningún misterio profundo.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Desert Dungeon Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Desert_Dungeon_Quest'],
                ],
            ],

            // 43 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-sweaty-cyclops-quest',
                'featured' => false,
                'image' => 'Cyclops.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Classic / service quest',
                    'region' => 'Ab\'Dendriel',
                    'recommended_level' => 20,
                    'access' => 'Free',
                    'party' => 'Solo',
                    'starts_in' => 'Ab\'Dendriel',
                ],
                'en' => [
                    'name' => 'The Sweaty Cyclops Quest',
                    'overview' => 'A small, beloved classic near Ab\'Dendriel that unlocks dealings with A Sweaty Cyclops, who trades useful goods for raw materials.',
                    'canon' => 'The quest sees the player win the cooperation of the cantankerous A Sweaty Cyclops near Ab\'Dendriel. Once befriended, the cyclops will exchange resources and craft useful items, making him a handy service NPC for lower-level characters.',
                    'interpretations' => 'The Sweaty Cyclops is a piece of Tibia\'s gentle humour, turning a hulking monster type into a grumbling tradesman — an early sign that not every cyclops is simply an enemy.',
                    'theories' => 'There is little hidden lore; the quest\'s charm lies in its character and its practical value to new adventurers.',
                ],
                'es' => [
                    'name' => 'La Misión del Cíclope Sudoroso (Sweaty Cyclops)',
                    'overview' => 'Un pequeño y querido clásico cerca de Ab\'Dendriel que desbloquea los tratos con A Sweaty Cyclops, que intercambia bienes útiles por materias primas.',
                    'canon' => 'La misión consiste en ganarse la cooperación del cascarrabias A Sweaty Cyclops cerca de Ab\'Dendriel. Una vez en buenos términos, el cíclope intercambia recursos y fabrica objetos útiles, convirtiéndose en un cómodo NPC de servicio para personajes de bajo nivel.',
                    'interpretations' => 'El Sweaty Cyclops es una muestra del humor amable de Tibia, que convierte a un tipo de monstruo descomunal en un comerciante gruñón: una señal temprana de que no todo cíclope es simplemente un enemigo.',
                    'theories' => 'Hay poco lore oculto; el encanto de la misión reside en su personaje y en su utilidad práctica para los aventureros nuevos.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Sweaty Cyclops Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Sweaty_Cyclops_Quest'],
                ],
            ],

            // 44 ──────────────────────────────────────────────────────────
            [
                'slug' => 'barbarian-test-quest',
                'featured' => false,
                'image' => 'Mead_Horn.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Access / rite quest',
                    'region' => 'Svargrond',
                    'recommended_level' => 25,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Svargrond',
                ],
                'en' => [
                    'name' => 'Barbarian Test Quest',
                    'overview' => 'A rite of passage among the barbarians of Svargrond, proving the player worthy of citizenship and the privileges of the frozen north.',
                    'canon' => 'Set in Svargrond, the quest puts the player through the barbarians\' tests to earn their respect. Completing it grants a Mead Horn, the right to fight in the Svargrond Arena, citizenship of Svargrond, and the ability to travel with Buddel — opening up the surrounding ice region.',
                    'interpretations' => 'The Barbarian Test frames Svargrond as a proud, insular culture that outsiders must earn their way into, tying access to the northern lands to acceptance by its people rather than mere geography.',
                    'theories' => 'The barbarians\' customs and their relationship to the wider north are sketched through the trial, leaving room to read Svargrond as a frontier society with its own code.',
                ],
                'es' => [
                    'name' => 'La Misión de la Prueba Bárbara (Barbarian Test)',
                    'overview' => 'Un rito de paso entre los bárbaros de Svargrond, que demuestra que el jugador es digno de la ciudadanía y de los privilegios del norte helado.',
                    'canon' => 'Ambientada en Svargrond, la misión somete al jugador a las pruebas de los bárbaros para ganarse su respeto. Completarla otorga un Mead Horn, el derecho a combatir en la Svargrond Arena, la ciudadanía de Svargrond y la posibilidad de viajar con Buddel, abriendo la región de hielo circundante.',
                    'interpretations' => 'La Prueba Bárbara presenta Svargrond como una cultura orgullosa y cerrada en la que los forasteros deben ganarse la entrada, vinculando el acceso a las tierras del norte a la aceptación por su gente más que a la mera geografía.',
                    'theories' => 'Las costumbres de los bárbaros y su relación con el norte más amplio se esbozan a través de la prueba, dejando margen para leer Svargrond como una sociedad de frontera con su propio código.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Barbarian Test Quest', 'url' => 'https://tibia.fandom.com/wiki/Barbarian_Test_Quest'],
                ],
            ],

            // 45 ──────────────────────────────────────────────────────────
            [
                'slug' => 'hot-cuisine-quest',
                'featured' => false,
                'image' => 'Frying_Pan.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Classic / cooking quest',
                    'region' => 'Near Ankrahmun',
                    'recommended_level' => 35,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Jean Pierre',
                ],
                'en' => [
                    'name' => 'Hot Cuisine Quest',
                    'overview' => 'A light-hearted cooking quest in which the player helps the chef Jean Pierre, learning to prepare a menu of unusual Tibian dishes.',
                    'canon' => 'Starting with Jean Pierre, who needs help with his cooking, the quest sends the player gathering ingredients and preparing delicious dishes. Completion grants the Culinary Master achievement and the recipe books Jean Pierre\'s Cookbook I and II, unlocking a range of food the player can cook.',
                    'interpretations' => 'Hot Cuisine is one of Tibia\'s purest "for fun" quests, a domestic, comic counterpoint to the world\'s great battles that has made cooking a small, enduring hobby within the game.',
                    'theories' => 'No deeper lore is intended; the quest is cherished as flavour in the most literal sense.',
                ],
                'es' => [
                    'name' => 'La Misión Hot Cuisine (Alta Cocina)',
                    'overview' => 'Una desenfadada misión de cocina en la que el jugador ayuda al chef Jean Pierre, aprendiendo a preparar un menú de inusuales platos tibianos.',
                    'canon' => 'Comenzando con Jean Pierre, que necesita ayuda con su cocina, la misión envía al jugador a reunir ingredientes y preparar platos deliciosos. Completarla otorga el logro Culinary Master y los recetarios Jean Pierre\'s Cookbook I y II, desbloqueando una variedad de comida que el jugador puede cocinar.',
                    'interpretations' => 'Hot Cuisine es una de las misiones más puramente "para divertirse" de Tibia, un contrapunto doméstico y cómico a las grandes batallas del mundo que ha convertido la cocina en una pequeña y perdurable afición dentro del juego.',
                    'theories' => 'No se pretende un lore más profundo; la misión se aprecia como sabor en el sentido más literal.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Hot Cuisine Quest', 'url' => 'https://tibia.fandom.com/wiki/Hot_Cuisine_Quest'],
                ],
            ],

            // 46 ──────────────────────────────────────────────────────────
            [
                'slug' => 'crusader-helmet-quest',
                'featured' => false,
                'image' => 'Crusader_Helmet.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Classic / treasure quest',
                    'region' => 'Dwarf Mines (Kazordoon)',
                    'recommended_level' => 40,
                    'access' => 'Free',
                    'party' => 'Solo',
                    'starts_in' => 'Dwarf Mines',
                ],
                'en' => [
                    'name' => 'Crusader Helmet Quest',
                    'overview' => 'A classic treasure quest in the dwarven mines, where a shining helmet lies hidden deep underground behind a guard of giant spiders.',
                    'canon' => 'According to its legend, the dwarves hid a shiny helmet deep in their mines, guarded by giant spiders. The player braves the depths to retrieve it, claiming the Crusader Helmet — a solid piece of armor and a well-known goal for free-account knights.',
                    'interpretations' => 'The Crusader Helmet quest is emblematic of Tibia\'s early "go deep, beat the guardian, take the prize" design, and remains a rite of passage for players gearing up without premium.',
                    'theories' => 'Why the dwarves hid the helmet and who forged it are left unsaid, part of the spare, treasure-room flavour of the classic quests.',
                ],
                'es' => [
                    'name' => 'La Misión del Crusader Helmet',
                    'overview' => 'Una clásica misión de tesoro en las minas enanas, donde un yelmo reluciente yace oculto en lo profundo del subsuelo tras una guardia de arañas gigantes.',
                    'canon' => 'Según su leyenda, los enanos escondieron un yelmo reluciente en lo profundo de sus minas, custodiado por giant spiders. El jugador se adentra en las profundidades para recuperarlo y reclamar el Crusader Helmet, una sólida pieza de armadura y un objetivo muy conocido para los caballeros de cuenta free.',
                    'interpretations' => 'La misión del Crusader Helmet es emblemática del diseño temprano de Tibia de "baja a lo hondo, vence al guardián y llévate el premio", y sigue siendo un rito de paso para quienes se equipan sin premium.',
                    'theories' => 'Por qué los enanos escondieron el yelmo y quién lo forjó se dejan sin decir, parte del sabor escueto de sala-del-tesoro de las misiones clásicas.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Crusader Helmet Quest', 'url' => 'https://tibia.fandom.com/wiki/Crusader_Helmet_Quest'],
                ],
            ],

            // 47 ──────────────────────────────────────────────────────────
            [
                'slug' => 'orc-fortress-quest',
                'featured' => false,
                'image' => 'Fire_Sword.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Classic / treasure quest',
                    'region' => 'Orc Fortress (near Ab\'Dendriel)',
                    'recommended_level' => 50,
                    'access' => 'Free',
                    'party' => 'Team',
                    'starts_in' => 'Orc Fortress',
                ],
                'en' => [
                    'name' => 'The Orc Fortress Quest',
                    'overview' => 'A storied free-account treasure quest into the Orc Fortress, where the Orc King\'s hoard is guarded by the fortress\'s fiercest warriors.',
                    'canon' => 'Its legend holds that the Orc King hoards a treasure in his throne room, defended by the best warriors of the fortress near Ab\'Dendriel. Fighting through orc warriors, berserkers and leaders, the player reaches the rewards — among them a Knight Armor, a Knight Axe and the coveted Fire Sword.',
                    'interpretations' => 'The Orc Fortress is one of the great early-game goals for free players, the Fire Sword in particular long serving as an aspirational weapon for low-level knights.',
                    'theories' => 'The orcs\' kingship and warrior culture are gestured at through the fortress, framing them as an organised martial society rather than mindless monsters.',
                ],
                'es' => [
                    'name' => 'La Misión de la Fortaleza Orca (Orc Fortress)',
                    'overview' => 'Una célebre misión de tesoro para cuentas free dentro de la Orc Fortress, donde el botín del Orc King está custodiado por los guerreros más fieros de la fortaleza.',
                    'canon' => 'Su leyenda sostiene que el Orc King atesora un botín en su sala del trono, defendido por los mejores guerreros de la fortaleza cerca de Ab\'Dendriel. Abriéndose paso entre orc warriors, berserkers y líderes, el jugador alcanza las recompensas, entre ellas una Knight Armor, un Knight Axe y la codiciada Fire Sword.',
                    'interpretations' => 'La Orc Fortress es uno de los grandes objetivos de juego temprano para jugadores free; la Fire Sword en particular ha servido durante mucho tiempo como arma aspiracional para caballeros de bajo nivel.',
                    'theories' => 'La realeza y la cultura guerrera de los orcos se insinúan a través de la fortaleza, presentándolos como una sociedad marcial organizada y no como monstruos sin mente.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Orc Fortress Quest', 'url' => 'https://tibia.fandom.com/wiki/Orc_Fortress_Quest'],
                ],
            ],

            // 48 ──────────────────────────────────────────────────────────
            [
                'slug' => 'what-a-foolish-quest',
                'featured' => false,
                'image' => 'Jester_Hat.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Outfit quest',
                    'region' => 'Various (Mainland)',
                    'recommended_level' => 60,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Thais',
                ],
                'en' => [
                    'name' => 'What a Foolish Quest',
                    'overview' => 'A long, comedic outfit quest that rewards the Jester set — the perfect attire for any Tibian who loves clowning around.',
                    'canon' => 'Ranging across Thais, Edron, Cormaya, Kazordoon, Carlin and more, the quest is a string of foolish errands that ends in the Jester Outfit and its addons, plus a Jester Staff and Jester Hat, and the achievements Allow Cookies?, Perfect Fool and Fool at Heart.',
                    'interpretations' => 'What a Foolish Quest is Tibia at its most playful, a tour of the mainland dressed as comedy, with the Jester outfit prized as a badge of having endured (and enjoyed) the joke.',
                    'theories' => 'There is no hidden mythology here; the quest is celebrated purely for its humour and its distinctive cosmetic reward.',
                ],
                'es' => [
                    'name' => 'La Misión What a Foolish (Del Bufón)',
                    'overview' => 'Una larga misión de atuendo cómica que recompensa el conjunto de Jester (Bufón): la vestimenta perfecta para cualquier tibiano al que le encante hacer el payaso.',
                    'canon' => 'Recorriendo Thais, Edron, Cormaya, Kazordoon, Carlin y más, la misión es una sucesión de recados absurdos que culmina en el Jester Outfit y sus addons, además de un Jester Staff y un Jester Hat, y los logros Allow Cookies?, Perfect Fool y Fool at Heart.',
                    'interpretations' => 'What a Foolish Quest es Tibia en su faceta más juguetona, un recorrido por el continente disfrazado de comedia, con el atuendo de Bufón apreciado como insignia de haber aguantado (y disfrutado) la broma.',
                    'theories' => 'Aquí no hay mitología oculta; la misión se celebra puramente por su humor y por su característica recompensa cosmética.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: What a Foolish Quest', 'url' => 'https://tibia.fandom.com/wiki/What_a_Foolish_Quest'],
                ],
            ],

            // 49 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-gravedigger-of-drefia-quest',
                'featured' => false,
                'image' => 'Skull.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Mount / task quest',
                    'region' => 'Drefia',
                    'recommended_level' => 60,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Drefia (Omrabas)',
                ],
                'en' => [
                    'name' => 'The Gravedigger of Drefia Quest',
                    'overview' => 'A grim quest in the undead city of Drefia, serving the dark figure Omrabas through unsettling ceremonies in exchange for a sinister reward.',
                    'canon' => 'Its legend invites those unafraid of dark ceremonies to seek out Omrabas in Drefia and offer their help, for which he has something very "handy" in return. The quest yields gems, black pearls, experience and a Nail Case used to obtain the Hellgrip mount.',
                    'interpretations' => 'The Gravedigger leans fully into Drefia\'s necromantic gloom, casting the player as a willing participant in macabre rites — a quest that earns its rewards through complicity rather than heroism.',
                    'theories' => 'Omrabas and the true purpose of his ceremonies belong to Drefia\'s deeper undeath lore, hinted at across the city\'s quests and books.',
                ],
                'es' => [
                    'name' => 'La Misión del Sepulturero de Drefia (Gravedigger of Drefia)',
                    'overview' => 'Una misión lúgubre en la ciudad no-muerta de Drefia, sirviendo a la oscura figura de Omrabas mediante inquietantes ceremonias a cambio de una siniestra recompensa.',
                    'canon' => 'Su leyenda invita a quienes no temen las ceremonias oscuras a buscar a Omrabas en Drefia y ofrecerle ayuda, por la que él tiene algo muy "a mano" como recompensa. La misión otorga gemas, black pearls, experiencia y un Nail Case que se usa para obtener la montura Hellgrip.',
                    'interpretations' => 'El Gravedigger se sumerge de lleno en la penumbra nigromántica de Drefia, situando al jugador como participante voluntario en ritos macabros: una misión que gana sus recompensas por complicidad más que por heroísmo.',
                    'theories' => 'Omrabas y el verdadero propósito de sus ceremonias pertenecen al lore más profundo de la no-muerte de Drefia, insinuado a lo largo de las misiones y libros de la ciudad.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Gravedigger of Drefia Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Gravedigger_of_Drefia_Quest'],
                ],
            ],

            // 50 ──────────────────────────────────────────────────────────
            [
                'slug' => 'an-uneasy-alliance-quest',
                'featured' => false,
                'image' => 'Tome_of_Knowledge.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Faction / task quest',
                    'region' => 'Zao',
                    'recommended_level' => 70,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Zao',
                ],
                'en' => [
                    'name' => 'An Uneasy Alliance Quest',
                    'overview' => 'A Zao quest about winning the trust of the orcs\' minotaur leader, building a fragile bridge between humans and the warlike peoples of the eastern continent.',
                    'canon' => 'Its premise is that Curos, the minotaur leader of the orcs of Zao, will accept help from humans — but only those who can earn his hard-won trust. The player undertakes his tasks for rewards including two Tomes of Knowledge, experience and gold.',
                    'interpretations' => 'An Uneasy Alliance extends Zao\'s themes of fractured peoples and shifting loyalties, showing the rebellion against the draken as a patchwork of wary allies rather than a single united front.',
                    'theories' => 'Curos\'s leadership of the orcs and how the various Zao factions relate are threads the quest opens within the larger lizard-and-draken saga.',
                ],
                'es' => [
                    'name' => 'La Misión An Uneasy Alliance (Una Alianza Incómoda)',
                    'overview' => 'Una misión de Zao sobre ganarse la confianza del líder minotauro de los orcos, tendiendo un frágil puente entre los humanos y los belicosos pueblos del continente oriental.',
                    'canon' => 'Su premisa es que Curos, el minotauro líder de los orcos de Zao, aceptará la ayuda de humanos, pero solo de quienes logren ganarse su difícil confianza. El jugador realiza sus tareas a cambio de recompensas que incluyen dos Tomes of Knowledge, experiencia y oro.',
                    'interpretations' => 'An Uneasy Alliance amplía los temas de Zao de pueblos fracturados y lealtades cambiantes, mostrando la rebelión contra los draken como un mosaico de aliados recelosos más que como un frente único y unido.',
                    'theories' => 'El liderazgo de Curos sobre los orcos y cómo se relacionan las distintas facciones de Zao son hilos que la misión abre dentro de la saga mayor de lagartos y draken.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: An Uneasy Alliance Quest', 'url' => 'https://tibia.fandom.com/wiki/An_Uneasy_Alliance_Quest'],
                ],
            ],

            // 51 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-thieves-guild-quest',
                'featured' => false,
                'image' => 'Assassin_Dagger.gif',
                'related' => ['thais'],
                'meta' => [
                    'quest_type' => 'Faction / story quest',
                    'region' => 'Thais & beyond',
                    'recommended_level' => 70,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Thais (Dorian)',
                ],
                'en' => [
                    'name' => 'The Thieves Guild Quest',
                    'overview' => 'A story quest in which the player joins an underground guild of thieves beneath Thais, learning their trade through a series of cloak-and-dagger missions.',
                    'canon' => 'Beginning by talking to Dorian, the player is inducted into a secret guild formed under Thais and sent on missions that range across Carlin, Venore, Port Hope, Liberty Bay and the Dark Cathedral. Rewards include the ability to trade with Black Bert and a choice of a Modified Crossbow, a Spellbook of Warding or an Assassin Dagger, plus the Amateur Actor and Master Thief achievements.',
                    'interpretations' => 'The Thieves Guild gives Tibia a rare taste of the criminal underworld, casting the player not as a hero but as an initiate of a hidden organisation — a change of moral register from the usual monster-slaying.',
                    'theories' => 'The guild\'s reach and its place beneath the kingdom\'s capital invite speculation about how much of Thais\'s order rests on what happens out of sight.',
                ],
                'es' => [
                    'name' => 'La Misión del Gremio de Ladrones (Thieves Guild)',
                    'overview' => 'Una misión de historia en la que el jugador se une a un gremio clandestino de ladrones bajo Thais, aprendiendo su oficio a través de una serie de misiones de capa y espada.',
                    'canon' => 'Empezando por hablar con Dorian, el jugador es iniciado en un gremio secreto formado bajo Thais y enviado a misiones que recorren Carlin, Venore, Port Hope, Liberty Bay y la Dark Cathedral. Las recompensas incluyen la posibilidad de comerciar con Black Bert y la elección entre un Modified Crossbow, un Spellbook of Warding o un Assassin Dagger, además de los logros Amateur Actor y Master Thief.',
                    'interpretations' => 'El Gremio de Ladrones da a Tibia un raro sabor del hampa, situando al jugador no como héroe sino como iniciado de una organización oculta: un cambio de registro moral frente a la habitual matanza de monstruos.',
                    'theories' => 'El alcance del gremio y su ubicación bajo la capital del reino invitan a especular sobre cuánto del orden de Thais se sostiene sobre lo que ocurre fuera de la vista.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Thieves Guild Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Thieves_Guild_Quest'],
                ],
            ],

            // 52 ──────────────────────────────────────────────────────────
            [
                'slug' => 'vampire-shield-quest',
                'featured' => false,
                'image' => 'Vampire_Shield.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Treasure / boss quest',
                    'region' => 'Hero Cave (Edron)',
                    'recommended_level' => 80,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Hero Cave (Edron)',
                ],
                'en' => [
                    'name' => 'Vampire Shield Quest',
                    'overview' => 'A treasure quest in the caves beneath Edron, where a warlock and his heroes guard a hoard centred on the prized Vampire Shield.',
                    'canon' => 'Set in the Hero Cave beneath Edron, the quest pits the player against a warlock and a band of heroes guarding their treasure. The rewards include the Vampire Shield, a Dragon Lance, a Strange Symbol, a Black Pearl and a Mysterious Fetish.',
                    'interpretations' => 'Sharing the Hero Cave with the famed Annihilator, the Vampire Shield quest is part of the same beloved cluster of Edron challenges, remembered for its strong mid-level shield reward.',
                    'theories' => 'The warlock and his "heroes" are left as atmosphere, their presence in the Hero Cave reinforcing it as a place where dark power and lost treasure meet.',
                ],
                'es' => [
                    'name' => 'La Misión del Vampire Shield',
                    'overview' => 'Una misión de tesoro en las cuevas bajo Edron, donde un brujo y sus héroes custodian un botín centrado en el codiciado Vampire Shield.',
                    'canon' => 'Ambientada en la Hero Cave bajo Edron, la misión enfrenta al jugador con un brujo y una banda de héroes que custodian su tesoro. Las recompensas incluyen el Vampire Shield, una Dragon Lance, un Strange Symbol, una Black Pearl y un Mysterious Fetish.',
                    'interpretations' => 'Compartiendo la Hero Cave con el célebre Annihilator, la misión del Vampire Shield forma parte del mismo querido grupo de desafíos de Edron, recordada por su sólida recompensa de escudo de nivel medio.',
                    'theories' => 'El brujo y sus "héroes" se dejan como ambientación; su presencia en la Hero Cave la refuerza como un lugar donde el poder oscuro y el tesoro perdido se encuentran.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Vampire Shield Quest', 'url' => 'https://tibia.fandom.com/wiki/Vampire_Shield_Quest'],
                ],
            ],

            // 53 ──────────────────────────────────────────────────────────
            [
                'slug' => 'behemoth-quest',
                'featured' => false,
                'image' => 'Demon_Shield.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Treasure / boss quest',
                    'region' => 'Cyclopolis (Edron)',
                    'recommended_level' => 80,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Cyclopolis (Edron)',
                ],
                'en' => [
                    'name' => 'The Behemoth Quest',
                    'overview' => 'A classic Edron treasure quest whose vault is famously guarded by behemoths, rewarding a small fortune in high-end gear.',
                    'canon' => 'Located around Cyclopolis near Edron, the quest\'s treasure room is defended by behemoths. Surviving it grants a rich haul — a Demon Shield, Golden Armor, Guardian Halberd, Platinum Amulet, Life Ring, Crystal Ring and a selection of precious gems.',
                    'interpretations' => 'The Behemoth Quest is one of the great mid-game treasure runs, its name long synonymous with the danger of cracking a guarded vault for a stack of valuable rewards.',
                    'theories' => 'Like other classic treasure rooms, its lore is minimal; the draw is the challenge of the behemoth guardians and the wealth beyond them.',
                ],
                'es' => [
                    'name' => 'La Misión del Behemoth',
                    'overview' => 'Una clásica misión de tesoro de Edron cuya cámara está célebremente custodiada por behemoths, y que recompensa con una pequeña fortuna en equipo de alta gama.',
                    'canon' => 'Situada en torno a Cyclopolis cerca de Edron, la sala del tesoro de la misión está defendida por behemoths. Sobrevivir otorga un rico botín: un Demon Shield, una Golden Armor, una Guardian Halberd, un Platinum Amulet, un Life Ring, un Crystal Ring y una selección de gemas preciosas.',
                    'interpretations' => 'La Misión del Behemoth es una de las grandes incursiones de tesoro de mitad de juego, con un nombre durante mucho tiempo sinónimo del peligro de forzar una cámara custodiada a cambio de un montón de recompensas valiosas.',
                    'theories' => 'Como otras salas del tesoro clásicas, su lore es mínimo; el reclamo es el desafío de los behemoths guardianes y la riqueza que hay tras ellos.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Behemoth Quest', 'url' => 'https://tibia.fandom.com/wiki/Behemoth_Quest'],
                ],
            ],

            // 54 ──────────────────────────────────────────────────────────
            [
                'slug' => 'elemental-spheres-quest',
                'featured' => false,
                'image' => 'Dragon_Robe.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Outfit / team quest',
                    'region' => 'Edron',
                    'recommended_level' => 100,
                    'access' => 'Premium',
                    'party' => 'Team (one of each vocation)',
                    'starts_in' => 'Edron',
                ],
                'en' => [
                    'name' => 'Elemental Spheres Quest',
                    'overview' => 'A team quest in Edron in which four vocations, each wielding an element, unite to free the frozen magister Alverus and master the Elemental Spheres.',
                    'canon' => 'After an experiment of Magister Alverus went wrong, he lies frozen in one of Edron\'s Ivory Towers, and only the power of four vocations together — each tied to an element — can save him. Each vocation faces its own elemental overlords and earns a unique reward: the Dragon Robe (sorcerers), Greenwood Coat (druids), Windborn Colossus Armor (knights), The Ironworker (paladins) or Spirit Bind (monks), plus the Lord of the Elements achievement.',
                    'interpretations' => 'The Elemental Spheres crystallise Tibia\'s vocation design into a single quest, demanding genuine cooperation and rewarding each class with iconic, vocation-specific gear.',
                    'theories' => 'Alverus\'s failed experiment and the nature of the elemental spheres tie the quest to Edron\'s identity as a centre of arcane study and dangerous magic.',
                ],
                'es' => [
                    'name' => 'La Misión de las Esferas Elementales (Elemental Spheres)',
                    'overview' => 'Una misión en equipo en Edron en la que cuatro vocaciones, cada una manejando un elemento, se unen para liberar al magíster congelado Alverus y dominar las Elemental Spheres.',
                    'canon' => 'Tras salir mal un experimento del Magíster Alverus, este queda congelado en una de las Ivory Towers de Edron, y solo el poder de cuatro vocaciones juntas —cada una ligada a un elemento— puede salvarlo. Cada vocación se enfrenta a sus propios señores elementales y obtiene una recompensa única: la Dragon Robe (sorcerers), la Greenwood Coat (druids), la Windborn Colossus Armor (knights), The Ironworker (paladins) o el Spirit Bind (monks), además del logro Lord of the Elements.',
                    'interpretations' => 'Las Elemental Spheres cristalizan el diseño de vocaciones de Tibia en una sola misión, exigiendo una cooperación genuina y recompensando a cada clase con equipo icónico y específico de su vocación.',
                    'theories' => 'El experimento fallido de Alverus y la naturaleza de las esferas elementales vinculan la misión con la identidad de Edron como centro de estudio arcano y magia peligrosa.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Elemental Spheres Quest', 'url' => 'https://tibia.fandom.com/wiki/Elemental_Spheres_Quest'],
                ],
            ],

            // 55 ──────────────────────────────────────────────────────────
            [
                'slug' => 'threatened-dreams-quest',
                'featured' => false,
                'image' => 'Butterfly_Ring.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Access / story quest',
                    'region' => 'Feyrist',
                    'recommended_level' => 100,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Fields of Glory',
                ],
                'en' => [
                    'name' => 'Threatened Dreams Quest',
                    'overview' => 'The quest that opens the dreamlike land of Feyrist, as the player defends its fae inhabitants from the nightmares spilling out of Roshamuul.',
                    'canon' => 'Its premise is that the nightmares dwelling in Roshamuul threaten the peaceful existence of the inhabitants of Feyrist. Ranging through the Fields of Glory, Poacher Caves, Edron and Cormaya, the player earns access to Feyrist and a trove of themed rewards — a Butterfly Ring, Ancient Coins, Rainbow Quartzes, a Sun Catcher, Moon Mirror and Starlight Vial among them.',
                    'interpretations' => 'Threatened Dreams sets up Feyrist as Tibia\'s realm of fairies and dreams, defined in direct opposition to Roshamuul\'s nightmares — a soft, luminous counterweight to that bleak prison-island.',
                    'theories' => 'The relationship between dreams and nightmares, and between Feyrist and Roshamuul, is a recurring thread for players tracing this corner of the world\'s mythology.',
                ],
                'es' => [
                    'name' => 'La Misión Threatened Dreams (Sueños Amenazados)',
                    'overview' => 'La misión que abre la onírica tierra de Feyrist, en la que el jugador defiende a sus habitantes feéricos de las pesadillas que se derraman desde Roshamuul.',
                    'canon' => 'Su premisa es que las pesadillas que moran en Roshamuul amenazan la existencia pacífica de los habitantes de Feyrist. Recorriendo los Fields of Glory, las Poacher Caves, Edron y Cormaya, el jugador obtiene acceso a Feyrist y un tesoro de recompensas temáticas: un Butterfly Ring, Ancient Coins, Rainbow Quartzes, un Sun Catcher, un Moon Mirror y un Starlight Vial, entre otras.',
                    'interpretations' => 'Threatened Dreams establece Feyrist como el reino de las hadas y los sueños de Tibia, definido en oposición directa a las pesadillas de Roshamuul: un contrapeso suave y luminoso a esa sombría isla-prisión.',
                    'theories' => 'La relación entre sueños y pesadillas, y entre Feyrist y Roshamuul, es un hilo recurrente para quienes rastrean la mitología de este rincón del mundo.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Threatened Dreams Quest', 'url' => 'https://tibia.fandom.com/wiki/Threatened_Dreams_Quest'],
                ],
            ],

            // 56 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-ape-city-quest',
                'featured' => false,
                'image' => 'Merlkin.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Access / story quest',
                    'region' => 'Banuta (Tiquanda)',
                    'recommended_level' => 130,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Tiquanda (Hairycles)',
                ],
                'en' => [
                    'name' => 'The Ape City Quest',
                    'overview' => 'A quest to befriend the apes of Banuta in the jungles of Tiquanda, proving the player a true friend to the merlkin sage Hairycles.',
                    'canon' => 'The renowned merlkin Hairycles seeks true friends among humans, and to prove yourself one you must help the apes of Banuta. Success brings the ability to be healed by Hairycles, to buy bananas, and a set of "see/hear/speak no evil" Monkey Statues, along with deeper access to the ape city.',
                    'interpretations' => 'The Ape City quest fleshes out the apes of Tiquanda as a culture with its own sages and customs, turning a jungle monster zone into a community the player can earn a place within.',
                    'theories' => 'Hairycles\'s wisdom and the apes\' view of humanity add texture to Tiquanda, hinting at a society richer than its role as a hunting ground suggests.',
                ],
                'es' => [
                    'name' => 'La Misión de la Ciudad de los Simios (Ape City)',
                    'overview' => 'Una misión para ganarse la amistad de los simios de Banuta en las junglas de Tiquanda, demostrando al sabio merlkin Hairycles que el jugador es un verdadero amigo.',
                    'canon' => 'El renombrado merlkin Hairycles busca amigos verdaderos entre los humanos, y para demostrar que eres uno debes ayudar a los simios de Banuta. El éxito trae la posibilidad de ser curado por Hairycles, de comprar bananas y un conjunto de Monkey Statues de "no ver/oír/hablar el mal", junto con un acceso más profundo a la ciudad de los simios.',
                    'interpretations' => 'La misión de Ape City desarrolla a los simios de Tiquanda como una cultura con sus propios sabios y costumbres, convirtiendo una zona de monstruos de jungla en una comunidad en la que el jugador puede ganarse un lugar.',
                    'theories' => 'La sabiduría de Hairycles y la visión que los simios tienen de la humanidad dan textura a Tiquanda, insinuando una sociedad más rica de lo que sugiere su papel como terreno de caza.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Ape City Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Ape_City_Quest'],
                ],
            ],

            // 57 ──────────────────────────────────────────────────────────
            [
                'slug' => 'hero-of-rathleton-quest',
                'featured' => false,
                'image' => 'Jaccus_Maxxen.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Boss / story quest',
                    'region' => 'Oramond',
                    'recommended_level' => 200,
                    'access' => 'Premium',
                    'party' => 'Team',
                    'starts_in' => 'Rathleton (Oramond)',
                ],
                'en' => [
                    'name' => 'Hero of Rathleton Quest',
                    'overview' => 'A high-level quest defending the glooth-powered city of Rathleton in Oramond from its old enemy, the mad inventor Jaccus Maxxen.',
                    'canon' => 'Jaccus Maxxen, an old enemy of Rathleton, has become a threat to the city once more. The player ventures into Jaccus Maxxen\'s Dungeon to confront him, earning access to the dungeon, a Glooth Glider Blueprint and glooth-themed rewards for becoming the city\'s hero.',
                    'interpretations' => 'Hero of Rathleton crowns the Oramond storyline, defined by its unique "glooth" technology, and frames Rathleton as a city saved by an outside champion against an enemy born of its own ingenuity.',
                    'theories' => 'Jaccus Maxxen\'s grudge and the strange glooth that powers Rathleton are central to Oramond\'s identity as Tibia\'s most industrial, invention-driven region.',
                ],
                'es' => [
                    'name' => 'La Misión Héroe de Rathleton (Hero of Rathleton)',
                    'overview' => 'Una misión de alto nivel para defender la ciudad de Rathleton, impulsada por glooth, en Oramond, de su viejo enemigo, el inventor loco Jaccus Maxxen.',
                    'canon' => 'Jaccus Maxxen, viejo enemigo de Rathleton, vuelve a ser una amenaza para la ciudad. El jugador se adentra en el Jaccus Maxxen\'s Dungeon para enfrentarse a él, ganando acceso a la mazmorra, un Glooth Glider Blueprint y recompensas temáticas de glooth por convertirse en el héroe de la ciudad.',
                    'interpretations' => 'Hero of Rathleton corona la trama de Oramond, definida por su singular tecnología "glooth", y presenta Rathleton como una ciudad salvada por un campeón externo frente a un enemigo nacido de su propio ingenio.',
                    'theories' => 'El rencor de Jaccus Maxxen y el extraño glooth que da energía a Rathleton son centrales para la identidad de Oramond como la región más industrial y volcada en la invención de Tibia.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Hero of Rathleton Quest', 'url' => 'https://tibia.fandom.com/wiki/Hero_of_Rathleton_Quest'],
                ],
            ],

            // 58 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-lost-brother-quest',
                'featured' => false,
                'image' => 'Red_Gem.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Story / access quest',
                    'region' => 'Asura Palace (Tiquanda)',
                    'recommended_level' => 200,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Tiquanda',
                ],
                'en' => [
                    'name' => 'The Lost Brother Quest',
                    'overview' => 'A high-level quest helping a merchant uncover the fate of his brother, who followed a beautiful woman into the luxurious — and deadly — Asura Palace.',
                    'canon' => 'A merchant asks the player to find out what happened to his brother, last seen following a beautiful woman into a lavish palace. The trail leads to the Asura Palace in Tiquanda, home to the asura, granting experience, the ability to trade with Tarun, a Red Gem and the Lost Palace Raider achievement.',
                    'interpretations' => 'The Lost Brother opens the door to the Asura Palace and its djinn-like inhabitants, wrapping a high-level hunting ground in a small, human story of seduction and loss.',
                    'theories' => 'The asura, their palace and the "beautiful woman" at the heart of the tale belong to a strand of lore about temptation and ruin that the quest hints at more than explains.',
                ],
                'es' => [
                    'name' => 'La Misión del Hermano Perdido (The Lost Brother)',
                    'overview' => 'Una misión de alto nivel para ayudar a un mercader a descubrir el destino de su hermano, que siguió a una hermosa mujer hasta el lujoso —y mortal— Asura Palace.',
                    'canon' => 'Un mercader pide al jugador que averigüe qué le ocurrió a su hermano, visto por última vez siguiendo a una hermosa mujer hacia un opulento palacio. El rastro lleva al Asura Palace en Tiquanda, hogar de los asura, y otorga experiencia, la posibilidad de comerciar con Tarun, un Red Gem y el logro Lost Palace Raider.',
                    'interpretations' => 'El Hermano Perdido abre la puerta al Asura Palace y a sus habitantes semejantes a djinn, envolviendo un terreno de caza de alto nivel en una pequeña historia humana de seducción y pérdida.',
                    'theories' => 'Los asura, su palacio y la "hermosa mujer" en el corazón del relato pertenecen a una hebra de lore sobre la tentación y la ruina que la misión insinúa más que explica.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Lost Brother Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Lost_Brother_Quest'],
                ],
            ],

            // 59 ──────────────────────────────────────────────────────────
            [
                'slug' => 'adventures-of-galthen-quest',
                'featured' => false,
                'image' => 'Compass.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Exploration / repeatable quest',
                    'region' => 'Various (Bounac, Edron, Iksupan)',
                    'recommended_level' => 250,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Kesar the Younger',
                ],
                'en' => [
                    'name' => 'Adventures of Galthen Quest',
                    'overview' => 'A globe-spanning investigation quest in which the player helps Kesar the Younger uncover the dark forces behind the abduction of his wife, Yselda.',
                    'canon' => 'Kesar the Younger\'s wife, Yselda, has been taken from him, and he asks the player to investigate the dark forces behind this malicious plot. The trail ranges across Bounac, Edron, the Port Hope surroundings and Iksupan, unfolding as a high-level adventure tied to the explorer Galthen\'s legacy.',
                    'interpretations' => 'Adventures of Galthen is built as ongoing, exploration-driven content, threading distant regions into a single investigation and rewarding curiosity across the map rather than a single dungeon clear.',
                    'theories' => 'Yselda\'s abductors and the "dark forces" behind them are the hook into a larger mystery the quest deliberately keeps unspooling.',
                ],
                'es' => [
                    'name' => 'La Misión Adventures of Galthen',
                    'overview' => 'Una misión de investigación de alcance mundial en la que el jugador ayuda a Kesar the Younger a desentrañar las fuerzas oscuras tras el secuestro de su esposa, Yselda.',
                    'canon' => 'A Kesar the Younger le han arrebatado a su esposa, Yselda, y pide al jugador que investigue las fuerzas oscuras tras esta malévola trama. El rastro recorre Bounac, Edron, los alrededores de Port Hope e Iksupan, desplegándose como una aventura de alto nivel ligada al legado del explorador Galthen.',
                    'interpretations' => 'Adventures of Galthen está construida como contenido continuo y guiado por la exploración, hilvanando regiones lejanas en una sola investigación y premiando la curiosidad por todo el mapa más que el despeje de una única mazmorra.',
                    'theories' => 'Los secuestradores de Yselda y las "fuerzas oscuras" tras ellos son el gancho hacia un misterio mayor que la misión deja deliberadamente abierto.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: Adventures of Galthen Quest', 'url' => 'https://tibia.fandom.com/wiki/Adventures_of_Galthen_Quest'],
                ],
            ],

            // 60 ──────────────────────────────────────────────────────────
            [
                'slug' => 'the-isle-of-evil-quest',
                'featured' => false,
                'image' => 'Fishing_Rod.gif',
                'related' => [],
                'meta' => [
                    'quest_type' => 'Access / story quest',
                    'region' => 'Isle of Evil (southern seas)',
                    'recommended_level' => 50,
                    'access' => 'Premium',
                    'party' => 'Solo',
                    'starts_in' => 'Kazordoon',
                ],
                'en' => [
                    'name' => 'The Isle of Evil Quest',
                    'overview' => 'A treasure-hunt quest following ancient texts and fairy tales to a secret isle of evil, rewarding a mechanical fishing rod and curious trophies.',
                    'canon' => 'Ancient texts and fairy tales tell of a hidden isle of evil, and the quest leads the player across Kazordoon, Yalahar, Liberty Bay, Northport and the isle itself to find it. Rewards include access to the Isle of Evil, the Isle of Evil book, a Mechanical Fishing Rod, a Fan Doll of King Tibianus, 6,666 experience and an achievement.',
                    'interpretations' => 'The Isle of Evil plays as a classic seafaring treasure hunt, its menacing name undercut by playful rewards — a quest more about discovery and curiosities than confronting any true evil.',
                    'theories' => 'What the "evil" of the isle truly was, and the legends that pointed to it, are left as fairy-tale framing rather than firm lore.',
                ],
                'es' => [
                    'name' => 'La Misión de la Isla del Mal (Isle of Evil)',
                    'overview' => 'Una misión de búsqueda del tesoro que sigue textos antiguos y cuentos de hadas hasta una isla secreta del mal, recompensando con una caña de pescar mecánica y curiosos trofeos.',
                    'canon' => 'Textos antiguos y cuentos de hadas hablan de una isla oculta del mal, y la misión lleva al jugador por Kazordoon, Yalahar, Liberty Bay, Northport y la propia isla para encontrarla. Las recompensas incluyen el acceso a la Isle of Evil, el libro Isle of Evil, una Mechanical Fishing Rod, un Fan Doll of King Tibianus, 6.666 de experiencia y un logro.',
                    'interpretations' => 'La Isle of Evil funciona como una clásica búsqueda del tesoro marinera, con su nombre amenazante desmentido por recompensas juguetonas: una misión más sobre el descubrimiento y las curiosidades que sobre enfrentarse a un mal verdadero.',
                    'theories' => 'Qué fue realmente el "mal" de la isla, y las leyendas que apuntaban a él, se dejan como marco de cuento de hadas más que como lore firme.',
                ],
                'sources' => [
                    ['type' => SourceType::TibiaWiki->value, 'title' => 'TibiaWiki: The Isle of Evil Quest', 'url' => 'https://tibia.fandom.com/wiki/The_Isle_of_Evil_Quest'],
                ],
            ],
        ];
    }
}
