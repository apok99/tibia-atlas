<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Allowed ranking metrics
    |--------------------------------------------------------------------------
    |
    | Whitelist of metric → column suffix names. Keeps raw client input out of
    | the SQL when ordering the deadliest-races ranking.
    |
    */
    'metrics' => ['players_killed', 'killed'],

    /*
    |--------------------------------------------------------------------------
    | Raid-boss reach threshold
    |--------------------------------------------------------------------------
    |
    | A boss present in at most this many worlds is treated as a raid/world boss.
    | Quest bosses are killed in ~all 93 worlds every day; raid bosses only show
    | up in a handful, so this cutoff separates the two for the Raid Boss Watch.
    |
    */
    'raid_max_worlds' => 60,

    /*
    |--------------------------------------------------------------------------
    | Iconic raid/world bosses
    |--------------------------------------------------------------------------
    |
    | Lowercased names of the famous Tibia world bosses, pinned to the front of
    | the Raid Boss Watch so they always surface despite their rare, low
    | activity. Order defines their fame rank.
    |
    */
    'iconic_raid_bosses' => [
        'orshabaal', 'morgaroth', 'ghazbaran', 'ferumbras', 'zugurosh', 'massacre',
        'the old widow', 'the evil eye', 'the imperor', 'the plasmother',
        'countess sorrow', 'dracola', 'dharalion', 'fernfang', 'yeti', 'gorzindel',
        'mr. punish', 'hand of cursed fate', 'the voice of ruin', 'zarabustor',
        'the pale count', 'the noxious spawn', 'bibby bloodbath', 'rotworm queen',
        'demodras', 'the big bad one', 'grorlam', 'man in the cave', 'burster',
        'grand mother foulscale', 'barbaria', 'diblis the fair', 'the abomination',
    ],

];
