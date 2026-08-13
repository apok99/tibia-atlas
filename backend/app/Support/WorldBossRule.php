<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Which bosses belong on the MAP's Boss Watch rail — the ones with a real
 * server-side respawn, i.e. "world bosses and raid bosses".
 *
 * `BossRule` answers "is this a boss at all?" (glossary + kill-stats dashboard).
 * This answers the narrower question the map asks: **does a respawn heat reading
 * mean anything for it?** For a lever/instanced quest boss it does not — the boss
 * is permanently available and the cooldown is per PLAYER (`setBossCooldown`,
 * "You have faced this boss in the last 10 hours"), so "probablemente viva" is
 * noise. Only open-world bosses have a respawn the heat can model.
 *
 * Why this isn't one clean column: neither available field is sufficient alone.
 *   - TibiaWiki `meta.spawn_type` is missing on 121 of 377 tracked bosses, and not
 *     on obscure ones — Ghazbaran, Yakchal, Kerberos and Leviathan all lack it.
 *   - `meta.ot.quest_area` (from tibia:etl-monster-combat) is the best signal but
 *     over-fires: it tags `killing_in_the_name_of`, which is a TASK list, not an
 *     instance — those 30 bosses live in the open world.
 * So the rule is: drop anything the OT scripts gate behind a per-player cooldown
 * ({@see INSTANCED}), drop anything inside an instanced quest area, and keep
 * everything else.
 */
class WorldBossRule
{
    /**
     * `meta.ot.quest_area` values that mean "lever or instanced encounter".
     * Access is quest-gated and the boss is always up, so there is no respawn.
     * Curated against the 35 values actually present on disk.
     */
    public const INSTANCED_QUESTS = [
        'a_pirates_tail_quest',
        'adventures_of_galthen',
        'ancient_feud',          // the four Snake God scale bosses, per-player cooldown
        'ancient_tombs',
        'bigfoots_burden',       // Warzone 1/2/3 — Deathstrike, Gnomevil, Abyssador
        'cults_of_tibia',
        'dangerous_depth',
        'feaster_of_souls',
        'ferumbras_ascension',
        'forgotten_knowledge',
        'grave_danger',
        'heart_of_destruction',
        'hero_of_rathleton',
        'in_service_of_yalahar',
        'isle_of_evil',
        'kilmaresh',
        'liquid_black',
        'marapur',
        'mysterious_ornate_chest',
        'no_rest_for_the_wicked',
        'pits_of_inferno',
        'primal_ordeal_quest',
        'rotten_blood',
        'soul_war',
        'svargrond_arena',
        'the_dream_courts',
        'the_elemental_spheres',
        'the_inquisition',
        'the_new_frontier',
        'the_order_of_lion',
        'the_secret_library',
        'wrath_of_the_emperor',
    ];

    /**
     * Quest areas deliberately NOT in the list above, recorded so nobody "tidies"
     * them in later: these tag open-world bosses that merely happen to be quest or
     * task targets, and they DO respawn on a server timer.
     *
     *   killing_in_the_name_of  30  a task list — Kerberos, Leviathan, Shardhead,
     *                               Demodras, The Old Widow, Bretzecutioner…
     *   roshamuul                4  prison bosses on open respawn timers
     *   dark_trails              3  tremor worm, Death Priest Shargon, The Ravager
     *
     * `the_curse_spreads` used to sit here too, on the assumption that the Grimvale
     * werebeasts roam their lairs. They don't: `actions_portal_minis_grimvale.lua`
     * teleports you into a sealed room, spawns the boss with `Game.createMonster`
     * and sets a 10-hour PER-PLAYER cooldown. All five are in {@see INSTANCED}.
     */
    public const OPEN_WORLD_QUESTS = ['killing_in_the_name_of', 'roshamuul', 'dark_trails'];

    /**
     * Bosses the OT server hands out through a lever or a portal with a PER-PLAYER
     * cooldown (`setBossCooldown`) — generated from the script layer by
     * `tools/gen-instanced-bosses.mjs`, matched on the killstats race name.
     *
     * This exists because {@see INSTANCED_QUESTS} reads `meta.ot.quest_area`, which
     * is just the monster lua's folder under `monster/quests/` — and a lever boss
     * whose lua sits in `monster/bosses/` reports no quest area at all. That is how
     * the whole Rotten Blood set (Bakragore, Ichgahal, Murcion, Chagorz, Vemiath)
     * plus Ahau, Kroazur, Mitmah Vanguard, The Brainstealer and The Monster stayed
     * on the rail: nothing about the folder says "lever", the script does.
     *
     * Names, not slugs, deliberately: the roster is keyed by killstats race name,
     * which the OT scripts give us verbatim, and it survives slug disambiguation
     * (`pythius-the-rotten-creature`). Compared lowercased.
     *
     * Regenerate after pulling the OT clone:
     *   node tools/gen-instanced-bosses.mjs
     */
    public const INSTANCED = [
        'ahau', 'amenef the burning', 'anomaly',
        'arbaziloth', 'ascending ferumbras', 'bakragore',
        'black vixen', 'bloodback', 'brain head',
        'brokul', 'chagorz', 'count vlarkorth',
        'darkfang', 'duke krule', 'earl osam',
        'eradicator', 'faceless bane', 'foreshock',
        'gelidrazah the frozen', 'ghulosh', 'gorzindel',
        'goshnar\'s cruelty', 'goshnar\'s greed', 'goshnar\'s hatred',
        'goshnar\'s malice', 'goshnar\'s megalomania purple', 'goshnar\'s spite',
        'grand master oberon', 'ichgahal', 'irgix the flimsy',
        'kalyassa', 'katex blood tongue', 'king zelos',
        'kroazur', 'lady tenebris', 'lloyd',
        'lokathmor', 'lord azaram', 'magma bubble',
        'mazoran', 'mazzinor', 'megasylvan yselda',
        'mitmah vanguard', 'murcion', 'neferi the spy',
        'outburst', 'plagirath', 'ragiaz',
        'ratmiral blackwhiskers', 'razzagorn', 'rupture',
        'scarlett etzel', 'shadowpelt', 'sharpclaw',
        'shulgrax', 'sir nictros', 'sister hetai',
        'soul of dragonking zyrtarch', 'spirit of fertility', 'srezz yellow eyes',
        'tarbaz', 'tazhadur', 'tentugly\'s head',
        'the brainstealer', 'the dread maiden', 'the enraged thorn knight',
        'the fear feaster', 'the last lore keeper', 'the lord of the lice',
        'the monster', 'the nightmare beast', 'the pale worm',
        'the primal menace', 'the scourge of oblivion', 'the shatterer',
        'the time guardian', 'the unwelcome', 'timira the many-headed',
        'unaz the mean', 'urmahlullu the immaculate', 'utua stone sting',
        'vemiath', 'vok the freakish', 'yirkas blue scales',
        'zamulosh', 'zorvorax',
    ];

    /**
     * Never on the rail regardless of any other signal: encounter phases, alternate
     * forms and summoned adds. They carry TibiaWiki's isboss flag (so `BossRule`
     * admits them) but they are not independently spawnable, so there is nothing to
     * respawn. Kill-stats does count them, which is exactly why they leaked in.
     *
     * Bosses with no `meta.ot` at all (42 of them) bypass the quest-area test, so
     * the instanced ones among them — the six Goshnar's and Boreth — are listed
     * here by slug instead.
     */
    public const NEVER = [
        // Phases / alternate forms of one encounter
        'a-shielded-astral-glyph',
        'ascending-ferumbras',
        'channeling-earl-osam',
        'charged-anomaly',
        'charging-outburst',
        'dazed-leaf-golem',
        'destabilized-ferumbras',
        'energized-raging-mage',
        'the-astral-source',
        'weakened-demon',
        'fallen-moohtah-master-ghar',
        'ferumbras-soul-splinter',
        'ghulosh-deathgaze',
        // The two halves Izcandar the Banished splits into in the Dream Scar; they
        // share his encounter timer (`IzcandarTimer`) and have no spawn of their own.
        'izcandar-champion-of-summer',
        'izcandar-champion-of-winter',
        'melting-frozen-horror',
        'reflection-of-obujos',
        'shard-of-corruption',
        'thawing-dragon-lord',
        'the-armored-voidborn',
        'the-fire-empowered-duke',
        'the-unarmored-voidborn',
        'the-weakened-count',
        // Summoned adds inside a fight
        'adventurer-group',
        'brain-head',
        'damage-resonance',
        'glooth-bomb',   // "glooth bombs" — killstats' lowercase-plural add signature
        // Soul War + Inquisition — instanced, but carry no meta.ot to be caught above
        'boreth',
        'goshnars-cruelty',
        'goshnars-greed',
        'goshnars-hatred',
        'goshnars-malice',
        'goshnars-megalomania',
        'goshnars-spite',
    ];

    /**
     * SQL predicate for the map rail, to AND with {@see BossRule::sql()}.
     *
     * Being in an instanced quest area is an ABSOLUTE exclusion — deliberately not
     * overridable by a Raid/Unique spawntype. That override was tried and removed:
     * `Unique` is common on lever bosses (the whole Svargrond Arena carries
     * `["Unique","Triggered"]`), so it rescued 18 encounters that have no respawn
     * at all — Abyssador, Versperoth, Ungreez, Zugurosh, Brokul, The Handmaiden.
     * Rare open-world spawns don't need the rescue anyway: the quests that tag
     * them sit in {@see OPEN_WORLD_QUESTS} and were never excluded to begin with.
     *
     * A boss with no `meta.ot` at all passes (COALESCE → ''), which is what keeps
     * Ghazbaran and Gaz'haragoth on the rail; the instanced ones among those are
     * caught by name in {@see INSTANCED} or by slug in {@see NEVER}.
     */
    public static function sql(string $alias = 'e'): string
    {
        $quests = collect(self::INSTANCED_QUESTS)->map(fn ($q) => DB::getPdo()->quote($q))->implode(',');
        $never = collect(self::NEVER)->map(fn ($s) => DB::getPdo()->quote($s))->implode(',');
        $instanced = collect(self::INSTANCED)->map(fn ($n) => DB::getPdo()->quote($n))->implode(',');

        return "COALESCE({$alias}.meta->'ot'->>'quest_area', '') NOT IN ({$quests})"
            ." AND {$alias}.slug NOT IN ({$never})"
            // Lever/portal bosses on a per-player cooldown, keyed by race name
            // because that is what the OT scripts hand us ({@see INSTANCED}).
            ." AND NOT EXISTS (SELECT 1 FROM tibia_races tr2 WHERE tr2.entry_id = {$alias}.id"
            ." AND lower(tr2.name) IN ({$instanced}))"
            // Must be trackable at all: an entry with no tibia_races link can never
            // receive a kill-stats reading, so on the rail it would say "no recent
            // spawn data" forever by construction. This is what keeps the long tail
            // of encounter phases and NPC-collision slugs out (feroxa-werewolf,
            // enraged-morshabaal, chayenne-creature, wine-cask-creature) without
            // curating them one by one — none of them is a race killstats reports.
            // Redundant inside BossWatchQuery, which joins tibia_races anyway; it
            // earns its keep on the glossary side, which doesn't.
            ." AND EXISTS (SELECT 1 FROM tibia_races tr WHERE tr.entry_id = {$alias}.id)";
    }
}
