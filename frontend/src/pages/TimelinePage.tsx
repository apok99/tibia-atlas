import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'

// ─── Data ────────────────────────────────────────────────────────────────────

type EventType = 'lore' | 'update' | 'release' | 'world'

interface TimelineEvent {
  id: string
  date: { es: string; en: string }
  dateSort: number   // numeric year for ordering (negative = BCE-like ancient)
  type: EventType
  era: { es: string; en: string }
  title: { es: string; en: string }
  body: { es: string; en: string }
  slug?: string      // link to an entry
}

const EVENTS: TimelineEvent[] = [
  // ── Lore: Cosmogoní­a ─────────────────────────────────────────────────────
  {
    id: 'creation',
    date: { es: 'Edad de la Creación', en: 'Age of Creation' },
    dateSort: -9000,
    type: 'lore',
    era: { es: 'Edad de los Dioses', en: 'Age of the Gods' },
    title: { es: 'Los dioses dan forma al mundo', en: 'The gods shape the world' },
    body: {
      es: 'Uman y Fardos, primeros entre los dioses, dieron forma al mundo de Tibia a partir del caos primordial. De la oscuridad surgió la luz, y de la nada emergieron los continentes, los mares y los cielos. Zathroth, dios de la magia oscura y el caos, sembraba la corrupción al mismo tiempo que la creación avanzaba.',
      en: 'Uman and Fardos, first among the gods, shaped the world of Tibia from primordial chaos. From darkness came light, and from nothing emerged the continents, seas and skies. Zathroth, god of dark magic and chaos, sowed corruption even as creation advanced.',
    },
  },
  {
    id: 'first-demons',
    date: { es: 'Edad Antigua', en: 'Ancient Age' },
    dateSort: -8000,
    type: 'lore',
    era: { es: 'Edad de los Dioses', en: 'Age of the Gods' },
    title: { es: 'Los primeros demonios', en: 'The first demons' },
    body: {
      es: 'Zathroth creó a los demonios como extensión de su voluntad destructora. Estas criaturas del Reino de las Pesadillas irrumpieron en el mundo mortal, desatando guerras que sacudiron los cimientos de la realidad. Los dioses de la luz respondieron con sus propios campeones, iniciando un conflicto cósmico eterno.',
      en: 'Zathroth created demons as an extension of his destructive will. These creatures from the Nightmare Realm broke into the mortal world, unleashing wars that shook the foundations of reality. The gods of light responded with their own champions, beginning an eternal cosmic conflict.',
    },
    slug: 'demon',
  },
  {
    id: 'elves-created',
    date: { es: 'Primera Era', en: 'First Age' },
    dateSort: -6000,
    type: 'lore',
    era: { es: 'Edad de las Razas Antiguas', en: 'Age of the Elder Races' },
    title: { es: 'Los elfos, hijos primogénitos', en: 'The elves, firstborn children' },
    body: {
      es: 'Los elfos fueron los primeros seres sensibles creados por los dioses de la luz para poblar el mundo. Vivían en armonía con la naturaleza y poseían una afinidad innata con la magia. Sus civilizaciones florecieron en los grandes bosques del mundo, dejando una huella que aún puede rastrearse en las ruinas élficas de Tibia.',
      en: 'The elves were the first sentient beings created by the gods of light to inhabit the world. They lived in harmony with nature and possessed an innate affinity for magic. Their civilizations flourished in the great forests of the world, leaving a mark that can still be traced in the elven ruins of Tibia.',
    },
  },
  {
    id: 'dwarves',
    date: { es: 'Primera Era', en: 'First Age' },
    dateSort: -5500,
    type: 'lore',
    era: { es: 'Edad de las Razas Antiguas', en: 'Age of the Elder Races' },
    title: { es: 'Los enanos emergen de la tierra', en: 'The dwarves emerge from the earth' },
    body: {
      es: 'Los enanos surgieron de las profundidades de la tierra, talentosos artesanos y mineros que excavaron vastas ciudades bajo las montañas. Su habilidad forjando metal y piedra superaba a la de cualquier otra raza. Kazordoon, su mayor ciudad, refleja aún hoy la grandeza de su civilización subterránea.',
      en: 'The dwarves arose from the depths of the earth, gifted craftsmen and miners who carved vast cities under the mountains. Their skill working metal and stone surpassed that of any other race. Kazordoon, their greatest city, still reflects the grandeur of their subterranean civilization.',
    },
    slug: 'kazordoon',
  },
  {
    id: 'humans-rise',
    date: { es: '~3,000 años atrás', en: '~3,000 years ago' },
    dateSort: -3000,
    type: 'lore',
    era: { es: 'Edad Humana', en: 'Age of Humans' },
    title: { es: 'El ascenso de los humanos', en: 'The rise of humans' },
    body: {
      es: 'Los humanos aparecieron como la raza más versátil y ambiciosa de Tibia. A pesar de su corta vida y poderes limitados, su adaptabilidad y número los convirtieron en la fuerza dominante del mundo. Comenzaron a fundar asentamientos por todo el continente, expandiéndose con una velocidad que asombraba a las razas antiguas.',
      en: 'Humans appeared as the most versatile and ambitious race in Tibia. Despite their short lives and limited powers, their adaptability and numbers made them the dominant force in the world. They began founding settlements across the continent, expanding at a speed that amazed the elder races.',
    },
  },
  {
    id: 'thais-founded',
    date: { es: '~2,000 años atrás', en: '~2,000 years ago' },
    dateSort: -2000,
    type: 'lore',
    era: { es: 'Edad Humana', en: 'Age of Humans' },
    title: { es: 'Fundación de Thais', en: 'Foundation of Thais' },
    body: {
      es: 'Thais fue fundada como el primer gran reino humano de Tibia. Sus murallas y torres se alzaron en las llanuras centrales del continente, convirtiéndose en el corazón político y cultural de la civilización humana. La dinastía real de Tibianus estableció aquí su sede, y la ciudad creció hasta convertirse en la capital indiscutida del mundo conocido.',
      en: 'Thais was founded as the first great human kingdom of Tibia. Its walls and towers rose on the central plains of the continent, becoming the political and cultural heart of human civilization. The royal Tibianus dynasty established its seat here, and the city grew to become the undisputed capital of the known world.',
    },
    slug: 'thais',
  },
  {
    id: 'orc-wars',
    date: { es: '~1,500 años atrás', en: '~1,500 years ago' },
    dateSort: -1500,
    type: 'lore',
    era: { es: 'Guerras Antiguas', en: 'Ancient Wars' },
    title: { es: 'Las Guerras contra los Orcos', en: 'The Orc Wars' },
    body: {
      es: 'Grandes hordas de orcos irrumpieron desde el este, amenazando los reinos humanos. Las guerras que siguieron fueron brutales y prolongadas, dejando cicatrices en el paisaje de Tibia que aún hoy son visibles. Los humanos, elfos y enanos se unieron ante la amenaza común, forjando alianzas que definirían la política de siglos venideros.',
      en: 'Great orc hordes broke from the east, threatening the human kingdoms. The wars that followed were brutal and prolonged, leaving scars on the landscape of Tibia still visible today. Humans, elves and dwarves united against the common threat, forging alliances that would define the politics of centuries to come.',
    },
  },
  {
    id: 'inquisition',
    date: { es: '~800 años atrás', en: '~800 years ago' },
    dateSort: -800,
    type: 'lore',
    era: { es: 'Edad de la Fe', en: 'Age of Faith' },
    title: { es: 'La Inquisición', en: 'The Inquisition' },
    body: {
      es: 'La Iglesia del Tibia instituyó una gran purga contra los practicantes de magia oscura y las criaturas corruptas. Los Inquisidores recorrieron el continente persiguiendo a nigromantes, demonólogos y aquellos considerados herejes. Aunque sus métodos fueron crueles, también protegieron a las poblaciones de amenazas genuinas. Sus archivos, aún conservados en secreto, contienen los registros más completos de criaturas sobrenaturales de toda la historia.',
      en: 'The Church of Tibia instituted a great purge against practitioners of dark magic and corrupted creatures. Inquisitors traveled the continent hunting necromancers, demonologists and those deemed heretics. Though their methods were cruel, they also protected populations from genuine threats. Their archives, still secretly preserved, contain the most complete records of supernatural creatures in all history.',
    },
    slug: 'inquisition-quest',
  },
  {
    id: 'venore-founded',
    date: { es: '~600 años atrás', en: '~600 years ago' },
    dateSort: -600,
    type: 'lore',
    era: { es: 'Edad de la Expansión', en: 'Age of Expansion' },
    title: { es: 'Fundación de Venore', en: 'Foundation of Venore' },
    body: {
      es: 'Venore surgió como ciudad-estado mercantil independiente, rivalizando con Thais en influencia económica. Sus gremios de comerciantes acumularon riquezas inmensas controlando las rutas marítimas del sur. La tensión entre el poder político de Thais y el poder económico de Venore ha moldeado la diplomacia del continente durante siglos.',
      en: 'Venore arose as an independent merchant city-state, rivaling Thais in economic influence. Its merchant guilds accumulated immense wealth by controlling the southern sea routes. The tension between the political power of Thais and the economic power of Venore has shaped continental diplomacy for centuries.',
    },
    slug: 'venore',
  },
  {
    id: 'ferumbras-first',
    date: { es: '~400 años atrás', en: '~400 years ago' },
    dateSort: -400,
    type: 'lore',
    era: { es: 'Las Edades Oscuras', en: 'The Dark Ages' },
    title: { es: 'El ascenso de Ferumbras', en: 'The rise of Ferumbras' },
    body: {
      es: 'Ferumbras, un poderoso mago que vendió su alma a fuerzas oscuras en busca de poder absoluto, lanzó su primer ataque contra Tibia. Dotado de una inteligencia sin igual y magia devastadora, su sola presencia causó terror en toda la tierra. Fue eventualmente desterrado a la Isla del Mal, pero su oscura influencia nunca desapareció por completo.',
      en: 'Ferumbras, a powerful sorcerer who sold his soul to dark forces in pursuit of absolute power, launched his first assault on Tibia. Blessed with unparalleled intelligence and devastating magic, his very presence caused terror across the land. He was eventually banished to the Isle of Evil, but his dark influence never fully disappeared.',
    },
    slug: 'ferumbras-citadel',
  },
  {
    id: 'carlin-revolt',
    date: { es: '~300 años atrás', en: '~300 years ago' },
    dateSort: -300,
    type: 'lore',
    era: { es: 'Las Edades Oscuras', en: 'The Dark Ages' },
    title: { es: 'La revuelta de Carlin', en: "Carlin's revolt" },
    body: {
      es: 'Las mujeres guerreras del norte se rebelaron contra el dominio de Thais y fundaron Carlin como ciudad-estado independiente. Gobernada por una reina, Carlin desafió la supremacía masculina típica de los reinos humanos de la época. Su ejército de amazonas se convirtió en una fuerza militar formidable que ninguna nación ha osado desafiar abiertamente.',
      en: 'The warrior women of the north rebelled against the dominion of Thais and founded Carlin as an independent city-state. Governed by a queen, Carlin challenged the masculine supremacy typical of human kingdoms of the era. Its amazon army became a formidable military force that no nation has dared openly challenge.',
    },
    slug: 'carlin',
  },
  {
    id: 'ankrahmun-rise',
    date: { es: '~200 años atrás', en: '~200 years ago' },
    dateSort: -200,
    type: 'lore',
    era: { es: 'Edad de los Faraones', en: 'Age of the Pharaohs' },
    title: { es: 'El reino de Ankrahmun', en: 'The kingdom of Ankrahmun' },
    body: {
      es: 'En las áridas tierras de Darama, el reino de Ankrahmun floreció bajo el poder de los faraones muertos-vivientes. La ciudad fue construida sobre antiguas tradiciones de magia de la muerte, y sus gobernantes desafiaron la mortalidad mediante rituales prohibidos. La Pirámide Oscura guarda sus secretos más profundos, celosamente protegidos incluso hoy.',
      en: 'In the arid lands of Darama, the kingdom of Ankrahmun flourished under the power of the undead pharaohs. The city was built on ancient traditions of death magic, and its rulers defied mortality through forbidden rituals. The Dark Pyramid guards its deepest secrets, jealously protected even today.',
    },
    slug: 'ankrahmun',
  },

  // ── Real: Creación del juego ──────────────────────────────────────────────
  {
    id: 'dev-begins',
    date: { es: '1994', en: '1994' },
    dateSort: 1994,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: 'Comienza el desarrollo de Tibia', en: 'Tibia development begins' },
    body: {
      es: 'Tres estudiantes de la Universidad de Ratisbona (Alemania) — Stephan Vogler, Guido Lübke y Ulrich Schlott — comienzan a desarrollar Tibia como proyecto universitario. Inspirados en los juegos de rol de mesa y los MUDs de texto, su visión era crear un mundo persistente en línea accesible a cualquiera.',
      en: 'Three students at the University of Regensburg (Germany) — Stephan Vogler, Guido Lübke and Ulrich Schlott — begin developing Tibia as a university project. Inspired by tabletop role-playing games and text MUDs, their vision was to create an online persistent world accessible to anyone.',
    },
  },
  {
    id: 'first-release',
    date: { es: '2 de enero, 1997', en: 'January 2, 1997' },
    dateSort: 1997,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: 'Primera versión pública de Tibia', en: 'First public release of Tibia' },
    body: {
      es: 'Tibia se lanza públicamente en internet de forma gratuita. El juego cuenta con un mundo pequeño pero funcional: Rookgaard y las primeras versiones de las ciudades principales. Cientos de jugadores pioneros se conectan para explorar este nuevo mundo de fantasía en línea, sentando las bases de una comunidad que crecería durante décadas.',
      en: 'Tibia is publicly released on the internet for free. The game features a small but functional world: Rookgaard and early versions of the main cities. Hundreds of pioneer players connect to explore this new online fantasy world, laying the groundwork for a community that would grow for decades.',
    },
  },
  {
    id: 'cipsoft-founded',
    date: { es: '1998', en: '1998' },
    dateSort: 1998,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: 'Fundación de CipSoft GmbH', en: 'CipSoft GmbH founded' },
    body: {
      es: 'Los creadores de Tibia fundan oficialmente CipSoft GmbH en Ratisbona, Alemania. La empresa se convierte en el hogar corporativo del juego, permitiendo su crecimiento profesional. CipSoft sigue siendo hoy la desarrolladora y publicadora de Tibia, una de las empresas de juegos más longevas de Europa.',
      en: 'The creators of Tibia officially found CipSoft GmbH in Regensburg, Germany. The company becomes the corporate home of the game, allowing for its professional growth. CipSoft remains today the developer and publisher of Tibia, one of the longest-running game companies in Europe.',
    },
  },
  {
    id: 'v70',
    date: { es: 'Diciembre 2001', en: 'December 2001' },
    dateSort: 2001,
    type: 'update',
    era: { es: 'Era de expansión', en: 'Expansion era' },
    title: { es: 'Versión 7.0 — Cuentas Premium', en: 'Version 7.0 — Premium Accounts' },
    body: {
      es: 'La versión 7.0 introduce las cuentas premium, transformando el modelo de negocio de Tibia. Los jugadores free pueden acceder solo a Rookgaard y la isla de Mainland cerca de Thais, mientras que los premium desbloquean el mundo completo. También se añaden nuevas vocaciones avanzadas, sistemas de combate mejorados y las primeras grandes expansiones de territorio.',
      en: 'Version 7.0 introduces premium accounts, transforming the business model of Tibia. Free players can only access Rookgaard and the mainland island near Thais, while premium unlocks the full world. Advanced vocations, improved combat systems and the first major territory expansions are also added.',
    },
  },
  {
    id: 'v74',
    date: { es: 'Diciembre 2003', en: 'December 2003' },
    dateSort: 2003,
    type: 'update',
    era: { es: 'Era de expansión', en: 'Expansion era' },
    title: { es: 'Versión 7.4 — El Mundo Crece', en: 'Version 7.4 — The World Grows' },
    body: {
      es: 'Una de las actualizaciones más grandes hasta la fecha añade vastas regiones al mapa de Tibia: el desierto de Ankrahmun, las tierras de Edron y numerosas nuevas mazmorras. Las vocaciones reciben nuevos hechizos y equipamiento. La base de jugadores supera los 100,000 cuentas activas por primera vez.',
      en: "One of the biggest updates to date adds vast regions to Tibia's map: the Ankrahmun desert, Edron lands and numerous new dungeons. Vocations receive new spells and equipment. The player base surpasses 100,000 active accounts for the first time.",
    },
  },
  {
    id: 'v75',
    date: { es: 'Agosto 2004', en: 'August 2004' },
    dateSort: 2004,
    type: 'update',
    era: { es: 'Era de expansión', en: 'Expansion era' },
    title: { es: 'Versión 7.5 — El Archipiélago Quara', en: 'Version 7.5 — The Quara Archipelago' },
    body: {
      es: 'Las aguas al norte de Carlin esconden un peligro antiguo: los Quara, criaturas del mar profundo, irrumpen en la superficie. Port Hope abre sus puertas en la jungla de Tiquanda, y nuevas quests de alto nivel desafían incluso a los jugadores más veteranos. Se añaden también nuevos tipos de criaturas como los Hydras.',
      en: 'The waters north of Carlin hide an ancient danger: the Quara, creatures of the deep sea, erupt to the surface. Port Hope opens its gates in the Tiquanda jungle, and new high-level quests challenge even the most veteran players. New creature types such as Hydras are also added.',
    },
    slug: 'updates75',
  },
  {
    id: 'v76',
    date: { es: 'Diciembre 2004', en: 'December 2004' },
    dateSort: 2004.5,
    type: 'update',
    era: { es: 'Era de expansión', en: 'Expansion era' },
    title: { es: 'Versión 7.6 — Las Minas Enanas', en: 'Version 7.6 — The Dwarven Mines' },
    body: {
      es: 'Kazordoon y las minas enanas se expanden masivamente. Se introduce la Armadura Enana como uno de los objetos más codiciados del juego. La actualización también trae los primeros tipos de criaturas elementales y mejoras en el sistema de comercio entre jugadores.',
      en: 'Kazordoon and the dwarven mines expand massively. The Dwarven Armor is introduced as one of the most coveted items in the game. The update also brings the first elemental creature types and improvements to the player trading system.',
    },
  },
  {
    id: 'v82',
    date: { es: 'Diciembre 2007', en: 'December 2007' },
    dateSort: 2007,
    type: 'update',
    era: { es: 'Era de crecimiento', en: 'Growth era' },
    title: { es: 'Versión 8.2 — Svargrond y las Islas de Hielo', en: 'Version 8.2 — Svargrond and the Ice Islands' },
    body: {
      es: 'Las regiones polares de Tibia se abren por primera vez. Svargrond, ciudad vikinga enclavada en el Ártico, ofrece nuevas facciones, quests y criaturas del frío. Los Barbarians y sus rituales de arena se convierten en uno de los desafíos más populares del juego. Las nuevas criaturas de hielo redefinen la resistencia de los jugadores mages.',
      en: 'The polar regions of Tibia open for the first time. Svargrond, a Viking city nestled in the Arctic, offers new factions, quests and cold creatures. The Barbarians and their arena rituals become one of the most popular challenges in the game. New ice creatures redefine resistance requirements for mage players.',
    },
  },
  {
    id: 'v10',
    date: { es: 'Diciembre 2013', en: 'December 2013' },
    dateSort: 2013,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Versión 10.0 — El Bestiario', en: 'Version 10.0 — The Bestiary' },
    body: {
      es: 'La versión 10.0 introduce el sistema de Bestiario: los jugadores pueden ahora registrar sus encuentros con criaturas, desbloqueando información, encantamientos de enciclopedia y cargas de encantamiento. Este sistema cambia fundamentalmente cómo los jugadores interactúan con el mundo de Tibia, dando propósito adicional a la caza de cualquier criatura, rara o común.',
      en: 'Version 10.0 introduces the Bestiary system: players can now register their encounters with creatures, unlocking information, encyclopaedia charms and charm charges. This system fundamentally changes how players interact with the world of Tibia, giving additional purpose to hunting any creature, rare or common.',
    },
  },
  {
    id: 'v20-anniversary',
    date: { es: '1997–2017', en: '1997–2017' },
    dateSort: 2017,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: '20 años de Tibia', en: '20 years of Tibia' },
    body: {
      es: 'Tibia celebra su vigésimo aniversario, convirtiéndose en uno de los MMORPGs más longevos de la historia. Con más de dos décadas de historia, el juego mantiene una comunidad activa y apasionada en todo el mundo. CipSoft organiza eventos especiales y lanza retrospectivas de la evolución gráfica y jugable del mundo.',
      en: 'Tibia celebrates its twentieth anniversary, becoming one of the longest-running MMORPGs in history. With more than two decades of history, the game maintains an active and passionate community around the world. CipSoft organizes special events and releases retrospectives of the graphical and gameplay evolution of the world.',
    },
  },
  {
    id: 'v11',
    date: { es: 'Diciembre 2016', en: 'December 2016' },
    dateSort: 2016,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Versión 11.0 — Imbuements y Sistema de Presas', en: 'Version 11.0 — Imbuements and the Prey System' },
    body: {
      es: 'La actualización de invierno de 2016 introduce el sistema de Imbuements, que revoluciona el equipamiento de Tibia: los jugadores pueden mejorar armas y armaduras con efectos adicionales usando materiales recolectados de criaturas. Llega también el Sistema de Presas (Prey), que ofrece bonificaciones temporales contra monstruos elegidos. Juntos añaden una capa estratégica profunda y hacen que el farming de ciertos objetos sea más valioso que nunca.',
      en: 'The Winter Update 2016 introduces the Imbuements system, which revolutionizes Tibia equipment: players can enhance weapons and armor with additional effects using materials collected from creatures. It also brings the Prey System, granting temporary bonuses against chosen monsters. Together they add a deep strategic layer and make farming certain items more valuable than ever.',
    },
  },
  {
    id: 'v12-client',
    date: { es: 'Julio 2019', en: 'July 2019' },
    dateSort: 2019,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: 'Versión 12 — Un nuevo cliente', en: 'Version 12 — A new client' },
    body: {
      es: 'CipSoft lanza la versión 12, una reconstrucción completa del cliente de juego sobre tecnología moderna. El renovado motor gráfico, la interfaz rediseñada y las mejoras de rendimiento preparan a Tibia para la siguiente década, sin sacrificar el estilo clásico que define al juego desde 1997.',
      en: 'CipSoft releases version 12, a complete rebuild of the game client on modern technology. The renewed graphics engine, redesigned interface and performance improvements prepare Tibia for the next decade, without sacrificing the classic style that has defined the game since 1997.',
    },
  },
  {
    id: 'v1230',
    date: { es: 'Diciembre 2019', en: 'December 2019' },
    dateSort: 2019.5,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Versión 12.30 — El Inframundo', en: 'Version 12.30 — The Netherworld' },
    body: {
      es: 'La actualización de invierno de 2019 abre el Inframundo (Netherworld), un reino fronterizo entre el mundo de los vivos y el de los muertos, junto a nuevos cotos de caza submarinos como Barren Drift y los Brain Grounds. Llega también el Rastreador del Bestiario y mejoras al Sistema de Presas, refinando la experiencia de caza para los jugadores veteranos.',
      en: "The Winter Update 2019 opens the Netherworld, a borderland realm between the world of the living and the dead, alongside new underwater hunting grounds such as Barren Drift and the Brain Grounds. It also adds the Bestiary Tracker and improvements to the Prey System, refining the hunting experience for veteran players.",
    },
  },
  {
    id: 'v1280',
    date: { es: 'Noviembre 2021', en: 'November 2021' },
    dateSort: 2021,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Versión 12.80 — La Forja de Exaltación', en: 'Version 12.80 — The Exaltation Forge' },
    body: {
      es: 'Se introduce la Forja de Exaltación y el sistema de Mejora de Equipamiento, que permite a los jugadores fusionar y potenciar sus objetos usando polvo, núcleos y otros materiales. Este sistema da nueva vida al equipamiento de alto nivel y convierte la gestión de recursos en un pilar del juego de fin de partida.',
      en: 'The Exaltation Forge and Equipment Upgrade system are introduced, letting players fuse and empower their items using dust, cores and other materials. The system breathes new life into high-level gear and makes resource management a pillar of the end game.',
    },
  },
  {
    id: 'v25-anniversary',
    date: { es: 'Enero 2022', en: 'January 2022' },
    dateSort: 2022,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: '25 años de Tibia', en: '25 years of Tibia' },
    body: {
      es: 'En enero de 2022, Tibia cumple 25 años desde su primer lanzamiento en 1997. CipSoft celebra el cuarto de siglo con eventos especiales, regalos para la comunidad y contenido conmemorativo, consolidando a Tibia como uno de los MMORPG más longevos y queridos de la historia.',
      en: 'In January 2022, Tibia turns 25 years old since its first release in 1997. CipSoft celebrates the quarter-century with special events, community gifts and commemorative content, cementing Tibia as one of the longest-running and most beloved MMORPGs in history.',
    },
  },
  {
    id: 'v1310',
    date: { es: 'Noviembre 2022', en: 'November 2022' },
    dateSort: 2022.5,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Versión 13.10 — La Rueda del Destino', en: 'Version 13.10 — The Wheel of Destiny' },
    body: {
      es: 'La versión 13 trae la Rueda del Destino (Wheel of Destiny), un profundo sistema de especialización que permite a los personajes desbloquear mejoras al subir de nivel, junto al sistema de Mitigación. La actualización de invierno añade además la isla de Ingol y la legendaria ciudad dorada de Iksupan a través de la saga "La Cuna de los Monstruos".',
      en: 'Version 13 brings the Wheel of Destiny, a deep specialization system that lets characters unlock improvements as they level up, alongside the Mitigation mechanic. The Winter Update also adds the island of Ingol and the legendary golden city of Iksupan through the "Cradle of Monsters" questline.',
    },
  },
  {
    id: 'v13-candia',
    date: { es: 'Julio 2024', en: 'July 2024' },
    dateSort: 2024,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Verano 2024 — Candia, la tierra dulce', en: 'Summer 2024 — Candia, the sweet land' },
    body: {
      es: 'La actualización de verano de 2024 presenta Candia, un insólito entorno de fantasía repleto de dulces, con dos nuevos cotos de caza: las Minas de Chocolate (Chocolate Mines) y las Mazmorras de Postres (Dessert Dungeons). Una de las regiones más extravagantes y coloridas jamás añadidas al mundo de Tibia.',
      en: 'The Summer Update 2024 introduces Candia, an unusual candy-filled fantasy environment with two new hunting grounds: the Chocolate Mines and the Dessert Dungeons. One of the most extravagant and colorful regions ever added to the world of Tibia.',
    },
  },
  {
    id: 'winter-2025',
    date: { es: 'Diciembre 2025', en: 'December 2025' },
    dateSort: 2025,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Actualización de Invierno 2025', en: 'Winter Update 2025' },
    body: {
      es: 'La actualización de invierno de 2025 continúa la tradición semestral de CipSoft con nuevo contenido, regiones y mejoras de calidad de vida. Casi tres décadas después de su nacimiento, el mundo de Tibia sigue expandiéndose para una comunidad fiel de todo el planeta.',
      en: "The Winter Update 2025 continues CipSoft's twice-yearly tradition with new content, regions and quality-of-life improvements. Nearly three decades after its birth, the world of Tibia keeps expanding for a loyal community around the globe.",
    },
  },
  {
    id: 'v1240',
    date: { es: 'Julio 2020', en: 'July 2020' },
    dateSort: 2020,
    type: 'update',
    era: { es: 'Era moderna', en: 'Modern era' },
    title: { es: 'Versión 12.40 — Issavi y Kilmaresh', en: 'Version 12.40 — Issavi and Kilmaresh' },
    body: {
      es: 'La actualización de verano de 2020 abre la isla de Kilmaresh y su gran ciudad, Issavi, de inspiración mediterránea y oriental. Llega la misión Grave Danger —que enfrenta al jugador a cinco jefes antes de un enfrentamiento final—, el Bastión de las Cobras (Cobra Bastion) y nuevas criaturas y monturas, ampliando notablemente el sur del mundo de Tibia.',
      en: 'The Summer Update 2020 opens the island of Kilmaresh and its great city, Issavi, with a Mediterranean and Eastern flavor. It brings the Grave Danger quest — pitting players against five bosses before a final showdown — the Cobra Bastion, and new creatures and mounts, significantly expanding the southern reaches of the world of Tibia.',
    },
  },
  {
    id: 'tibia-atlas-created',
    date: { es: 'Junio 2026', en: 'June 2026' },
    dateSort: 2026,
    type: 'release',
    era: { es: 'El juego real', en: 'Real-world history' },
    title: { es: 'Nace Tibia Atlas', en: 'Tibia Atlas is born' },
    body: {
      es: 'Tibia Atlas se lanza como el primer atlas de lore bilingüe (ES/EN) dedicado al universo de Tibia. Con entradas sobre criaturas, personajes, ciudades, misiones, eventos y libros del juego, el proyecto aspira a convertirse en la referencia definitiva del lore tibiano para la comunidad hispanohablante y más allá.',
      en: 'Tibia Atlas launches as the first bilingual (ES/EN) lore atlas dedicated to the Tibia universe. With entries covering creatures, characters, cities, quests, events and in-game books, the project aims to become the definitive reference for Tibian lore for the Spanish-speaking community and beyond.',
    },
  },

  // ── Lore: Eventos recientes (en el mundo) ────────────────────────────────
  {
    id: 'drefia-fall',
    date: { es: 'Hace siglos', en: 'Centuries ago' },
    dateSort: -100,
    type: 'lore',
    era: { es: 'Las Edades Oscuras', en: 'The Dark Ages' },
    title: { es: 'La caída de Drefia', en: 'The fall of Drefia' },
    body: {
      es: 'Drefia, una antigua ciudad mágica en las tierras de Darama, cayó ante la corrupción de la nigromancia. Sus habitantes, en busca de inmortalidad, abrieron puertas a planos oscuros que no debían existir. La ciudad quedó infestada de muertos vivientes y fue abandonada por los vivos. Hoy es uno de los lugares más peligrosos y misteriosamente irresistibles para los aventureros de Tibia.',
      en: 'Drefia, an ancient magical city in the lands of Darama, fell to the corruption of necromancy. Its inhabitants, seeking immortality, opened gates to dark planes that should never have existed. The city became infested with undead and was abandoned by the living. Today it is one of the most dangerous and mysteriously irresistible places for adventurers in Tibia.',
    },
    slug: 'drefia',
  },
  {
    id: 'yalahar-collapse',
    date: { es: 'Hace décadas', en: 'Decades ago' },
    dateSort: -10,
    type: 'lore',
    era: { es: 'Era Moderna', en: 'Modern Era' },
    title: { es: 'El colapso de Yalahar', en: 'The collapse of Yalahar' },
    body: {
      es: 'Yalahar, la ciudad de los Altos Elfos, sufrió una catástrofe sin precedentes cuando sus experimentos con magia de transmutación se descontrolaron. Razas diversas que cohabitaban en perfecta armonía fueron corrompidas o destruidas. La ciudad, que alguna vez fue un faro de progreso, se convirtió en un laberinto de secciones peligrosas controladas por facciones enemigas. Solo los aventureros más experimentados se atreven a explorar sus profundidades.',
      en: 'Yalahar, the city of the High Elves, suffered an unprecedented catastrophe when their experiments with transmutation magic spiraled out of control. Diverse races that cohabited in perfect harmony were corrupted or destroyed. The city, once a beacon of progress, became a maze of dangerous sections controlled by enemy factions. Only the most experienced adventurers dare explore its depths.',
    },
  },
  {
    id: 'soul-war',
    date: { es: 'Presente', en: 'Present' },
    dateSort: 2025,
    type: 'world',
    era: { es: 'Era Moderna', en: 'Modern Era' },
    title: { es: 'La Guerra de las Almas', en: 'The Soul War' },
    body: {
      es: 'Los planos extradimensionales donde descansan las almas de los difuntos han sido perturbados. Criaturas de pesadilla atraviesan el velo entre mundos, amenazando tanto a los vivos como a los muertos. Heroes de todo el continente se unen para investigar el origen de esta amenaza, que parece conectada con los poderes más oscuros de Zathroth y sus secuaces.',
      en: 'The extradimensional planes where the souls of the dead rest have been disturbed. Nightmare creatures pierce the veil between worlds, threatening both the living and the dead. Heroes from across the continent unite to investigate the origin of this threat, which appears connected to the darkest powers of Zathroth and his minions.',
    },
    slug: 'soul-war',
  },
]

// ─── Types metadata ──────────────────────────────────────────────────────────

const TYPE_META: Record<EventType, { colorClass: string; bgClass: string; dotClass: string }> = {
  lore:    { colorClass: 'text-gold',    bgClass: 'bg-gold/10 border-gold/30',    dotClass: 'bg-gold' },
  update:  { colorClass: 'text-green-400', bgClass: 'bg-green-900/20 border-green-700/40', dotClass: 'bg-green-400' },
  release: { colorClass: 'text-accent',  bgClass: 'bg-accent/10 border-accent/30', dotClass: 'bg-accent' },
  world:   { colorClass: 'text-blue-400', bgClass: 'bg-blue-900/20 border-blue-700/40', dotClass: 'bg-blue-400' },
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TimelinePage() {
  const { i18n } = useTranslation()
  const lang = i18n.language.startsWith('es') ? 'es' : 'en'
  const [filter, setFilter] = useState<EventType | 'all'>('all')

  const sorted = [...EVENTS]
    .sort((a, b) => a.dateSort - b.dateSort)
    .filter(e => filter === 'all' || e.type === filter)

  const filterButtons: { key: EventType | 'all'; labelEs: string; labelEn: string }[] = [
    { key: 'all',     labelEs: 'Todo',         labelEn: 'All' },
    { key: 'lore',    labelEs: 'Lore',         labelEn: 'Lore' },
    { key: 'release', labelEs: 'Historia real', labelEn: 'Real history' },
    { key: 'update',  labelEs: 'Actualizaciones', labelEn: 'Updates' },
    { key: 'world',   labelEs: 'Eventos globales', labelEn: 'World events' },
  ]

  const typeLabelEs: Record<EventType, string> = {
    lore:    'Lore',
    update:  'Actualización',
    release: 'Historia real',
    world:   'Evento global',
  }
  const typeLabelEn: Record<EventType, string> = {
    lore:    'Lore',
    update:  'Update',
    release: 'Real history',
    world:   'World event',
  }

  return (
    <div>
      <Seo
        title={lang === 'es' ? 'Cronología de Tibia' : 'Timeline of Tibia'}
        description={
          lang === 'es'
            ? 'Desde la creación del mundo por los dioses hasta los eventos más recientes — la historia completa del universo de Tibia.'
            : 'From the creation of the world by the gods to the most recent events — the complete history of the Tibia universe.'
        }
        path="/timeline"
      />
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-accent">
          {lang === 'es' ? 'El mundo y su historia' : 'The world and its history'}
        </p>
        <h1 className="font-serif text-4xl font-black text-fg">
          {lang === 'es' ? 'Cronología de Tibia' : 'Timeline of Tibia'}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-fg-mute">
          {lang === 'es'
            ? 'Desde la creación del mundo por los dioses hasta los eventos más recientes del juego — la historia completa del universo de Tibia y del propio juego.'
            : 'From the creation of the world by the gods to the most recent in-game events — the complete history of the Tibia universe and the game itself.'}
        </p>
      </div>

      {/* Filter */}
      <div className="mb-10 flex flex-wrap justify-center gap-2">
        {filterButtons.map(fb => (
          <button
            key={fb.key}
            onClick={() => setFilter(fb.key)}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
              filter === fb.key
                ? 'border-accent bg-accent text-white'
                : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
            }`}
          >
            {lang === 'es' ? fb.labelEs : fb.labelEn}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="relative mx-auto max-w-4xl">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-line" />

        <div className="space-y-0">
          {sorted.map((ev, idx) => {
            const meta = TYPE_META[ev.type]
            const isLeft = idx % 2 === 0
            const title = ev.title[lang]
            const body  = ev.body[lang]
            const date  = ev.date[lang]
            const era   = ev.era[lang]
            const typeLabel = lang === 'es' ? typeLabelEs[ev.type] : typeLabelEn[ev.type]

            return (
              <div key={ev.id} className="relative flex items-start gap-0 pb-10">
                {/* Left card */}
                <div className={`w-[calc(50%-2rem)] ${isLeft ? '' : 'invisible'}`}>
                  {isLeft && (
                    <div className={`rounded-lg border p-5 text-right shadow-sm ${meta.bgClass}`}>
                      <span className={`mb-1.5 block text-[10px] font-bold uppercase tracking-widest ${meta.colorClass}`}>
                        {typeLabel}
                      </span>
                      <p className="mb-0.5 text-[11px] font-semibold text-fg-mute">{era}</p>
                      <p className={`mb-2 text-sm font-bold ${meta.colorClass}`}>{date}</p>
                      <h3 className="mb-2 font-serif text-base font-bold text-fg">{title}</h3>
                      <p className="text-xs leading-relaxed text-fg-mute">{body}</p>
                      {ev.slug && (
                        <Link
                          to={`/entry/${ev.slug}`}
                          className={`mt-3 inline-block text-[11px] font-bold ${meta.colorClass} hover:underline`}
                        >
                          {lang === 'es' ? 'Ver ficha →' : 'View entry →'}
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                {/* Center dot */}
                <div className="relative flex w-16 shrink-0 flex-col items-center">
                  <div className={`mt-5 h-3.5 w-3.5 rounded-full border-2 border-bg shadow-md ${meta.dotClass}`} />
                </div>

                {/* Right card */}
                <div className={`w-[calc(50%-2rem)] ${!isLeft ? '' : 'invisible'}`}>
                  {!isLeft && (
                    <div className={`rounded-lg border p-5 shadow-sm ${meta.bgClass}`}>
                      <span className={`mb-1.5 block text-[10px] font-bold uppercase tracking-widest ${meta.colorClass}`}>
                        {typeLabel}
                      </span>
                      <p className="mb-0.5 text-[11px] font-semibold text-fg-mute">{era}</p>
                      <p className={`mb-2 text-sm font-bold ${meta.colorClass}`}>{date}</p>
                      <h3 className="mb-2 font-serif text-base font-bold text-fg">{title}</h3>
                      <p className="text-xs leading-relaxed text-fg-mute">{body}</p>
                      {ev.slug && (
                        <Link
                          to={`/entry/${ev.slug}`}
                          className={`mt-3 inline-block text-[11px] font-bold ${meta.colorClass} hover:underline`}
                        >
                          {lang === 'es' ? 'Ver ficha →' : 'View entry →'}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* End cap */}
        <div className="flex justify-center pb-4">
          <div className="h-4 w-4 rounded-full border-2 border-accent bg-accent/30" />
        </div>
      </div>

      <p className="mt-8 text-center text-[11px] text-fg-dim">
        {lang === 'es'
          ? 'Las fechas del lore son aproximadas. Fan project — no afiliado con CipSoft.'
          : 'Lore dates are approximate. Fan project — not affiliated with CipSoft.'}
      </p>
    </div>
  )
}
