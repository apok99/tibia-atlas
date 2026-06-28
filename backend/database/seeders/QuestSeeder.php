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
                'image' => 'Feaster_of_Souls.gif',
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
        ];
    }
}
