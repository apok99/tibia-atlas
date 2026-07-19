<?php

/**
 * Jerga de la guía → nombre de zona que produce el Hunt Finder.
 *
 * La guía nombra los spots como los llama la comunidad ("Girtablilus", "Feru DT
 * seal"); el finder los nombra con el `place` del bestiario ("Ruins of Nuur").
 * Muchas veces la guía nombra al BICHO y nosotros al SITIO, así que el alias es
 * la traducción entre ambos vocabularios.
 *
 * Reglas:
 * - clave: nombre de la guía en minúsculas, tal cual aparece en los .txt.
 * - valor string: el nombre de zona nuestro con el que debe casar.
 * - valor null: sin equivalente a propósito — lo cuenta como "no mapeable" en
 *   vez de "no encontrado", que es un fallo distinto y no queremos confundirlos.
 *
 * Lo que NO está acá cae al match normalizado por nombre (ver HuntCalibrate).
 */
return [
    // --- La guía nombra al bicho, nosotros al sitio ---
    'girtablilus' => 'Ruins of Nuur',
    'girtablilu' => 'Ruins of Nuur',
    'bashmu' => 'Salt Caves',
    'carnisylvans' => 'Forest of Life',
    'nagas' => 'Temple of the Moon Goddess',
    'marapur naga' => 'Temple of the Moon Goddess',
    'marapur nagas' => 'Temple of the Moon Goddess',
    'diremaw task area' => 'Dwelling of the Forgotten',
    'werelions' => 'Lion Sanctum',
    'werelions -1' => 'Lion Sanctum',
    'werelions -2' => 'Lion Sanctum',
    'candia nibblemaws' => 'Chocolate Mines',
    'bulltaurs' => 'Bulltaurs Lair',
    'bulltaur lair' => 'Bulltaurs Lair',
    'bulltaurs -2' => 'Bulltaurs Lair',
    'marapur turtles and foam stalkers' => 'Great Pearl Fan Reef',
    'marapur turtles' => 'Great Pearl Fan Reef',
    'oskayaat werecrocodiles' => 'Murky Caverns',
    'oskayaat weretigers' => 'Murky Caverns',
    'oskayaat weretigers -2' => 'Murky Caverns',
    'werecrocodiles -1' => 'Murky Caverns',
    'weretigers -1' => 'Murky Caverns',
    'weretigers -2' => 'Murky Caverns',

    // --- Mismo sitio, otro nombre ---
    'winter court' => 'Court of Winter',
    'summer court' => 'Court of Summer',
    'azzilon catacombs' => 'Azzilon Castle Catacombs',
    'medusa tower' => 'Tiquanda Medusa Tower',

    // --- Sin equivalente posible: contenido que canary no implementa ---
    // Cero luas y cero spawns en el clone (verificado 2026-07-16). No es un
    // fallo del finder que no los encuentre: la data no existe.
    'bloodfire gorge' => null,
    'raubritters castle' => null,
    'raubritters ada outskirts' => null,
    'raubritters bloodfire gorge' => null,
    'norcferatu dungeons east' => null,
    'norcferatu dungeons west' => null,
    'norcferatu fortress' => null,
];
