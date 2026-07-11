<?php

namespace App\Support;

/**
 * Named places on the world map, mirrored from the frontend's
 * `frontend/src/lib/zones.ts` (LANDMARKS + REGIONS). Used to label a spawn
 * cluster with the hunting area / city nearest to it ("Drefia", "Edron").
 *
 * Coordinates are Tibia world coordinates (surface anchor). Underground areas
 * are anchored at their surface entrance, so a cluster on a lower floor still
 * resolves to the right name. Keep this in sync with zones.ts if regions move.
 */
final class HuntZones
{
    /** Cities / prominent landmarks. */
    public const LANDMARKS = [
        ["Ab'Dendriel", 32665, 31652], ['Ankrahmun', 33146, 32816], ['Carlin', 32343, 31792],
        ['Cormaya', 33307, 31999], ['Darashia', 33213, 32453], ['Edron', 33211, 31830],
        ['Farmine', 33030, 31500], ['Kazordoon', 32614, 31923], ['Krailos', 33580, 31584],
        ['Liberty Bay', 32309, 32794], ['Port Hope', 32629, 32769], ['Rathleton', 33607, 31955],
        ['Rookgaard', 32097, 32219], ['Roshamuul', 33524, 32477], ['Svargrond', 32278, 31146],
        ['Thais', 32365, 32224], ['Venore', 32963, 32087], ['Yalahar', 32805, 31234],
    ];

    /** Hunting regions / dungeons / islands. */
    public const REGIONS = [
        ['Mount Sternum', 32494, 32072], ['Femor Hills', 32569, 31803], ['Fibula', 32261, 32385],
        ['Plains of Havoc', 32735, 32297], ['Demona', 32479, 31663], ['Outlaw Camp', 32643, 32222],
        ['Maze of Lost Souls', 32490, 31697], ['Dark Cathedral', 32664, 32344], ['Folda', 32020, 31572],
        ['Ramoa', 31931, 32567], ['Goroma', 32095, 32583], ['Treasure Island', 32156, 32948],
        ['Laguna Islands', 32466, 32939], ['Elvenbane', 32590, 31645], ['Mistrock', 32567, 31442],
        ['Orc Fortress', 32930, 31774], ['Vengoth', 32916, 31516], ['Cyclopolis', 33251, 31698],
        ['Hero Cave', 33164, 31638], ['Stonehome', 33303, 31773], ['Grimvale', 33333, 31690],
        ['Oramond', 33479, 31986], ['Shadowthorn', 33075, 32170], ['Drefia', 33018, 32443],
        ['Forbidden Lands', 32973, 32549], ["Mal'ouquah", 33041, 32627], ['Chor', 32952, 32855],
        ['Tiquanda', 32812, 32699], ['Banuta', 32807, 32542], ['Trapwood', 32688, 32911],
        ['Hellgate', 32675, 31647], ['Nibelor', 32353, 31053], ['Helheim', 32478, 31179],
        ['Okolnir', 32230, 31412], ['Formorgar Glacier', 32102, 31144], ['Chyllfroest', 32060, 31034],
        ['Tyrsung', 32464, 31173], ['Grimlund', 32021, 31294], ['Inukaya', 32367, 31058],
        ['Senja', 32020, 31692], ['Vega', 31974, 31901], ['Isle of the Kings', 32126, 31665],
        ['Ghostlands', 32220, 31770], ['Fields of Glory', 32440, 31960], ['Mintwallin', 32540, 32200],
        ['Green Claw Swamp', 32820, 32020], ['Amazon Camp', 32839, 31920], ['Gnomebase Alpha', 33001, 31900],
        ['Meriana', 32132, 32912], ['Marapur', 33842, 32852], ['Murmuring Wilderness', 33690, 32780],
        ['Gnomprona', 33600, 32880], ['Zao', 33350, 31370], ['Razachai', 33074, 31100],
        ['Zzaion', 33262, 31100], ['Issavi', 33946, 31516], ['Warzones 4-6', 33800, 32170],
        ['Roshamuul Prison', 33520, 32600], ['Guzzlemaw Valley', 33645, 32390], ['Feyrist', 33540, 32208],
        ['Candia', 33370, 32155], ['Mountain Tomb (Dipthrah)', 33133, 32568], ['Oasis Tomb (Rahemos)', 33133, 32640],
        ['Ancient Ruins Tomb (Vashresamun)', 33208, 32591], ['Tarpit Tomb (Morguthis)', 33233, 32704],
        ['Stone Tomb (Thalas)', 33282, 32743], ['Shadow Tomb (Mahrdis)', 33255, 32833],
        ['Library Tomb (Ashmunrah)', 33142, 32838], ['Horestis Tomb', 33026, 32710], ['Peninsula Tomb', 33027, 32869],
        ['Cobra Bastion', 33398, 32655], ['Asura Palace', 32948, 32689], ['The Hive', 33560, 31255],
        ['Hive Outpost', 33467, 31322], ['Gray Island', 33191, 31985], ['Orcsoberfest', 33779, 31054],
        ['Ruins of Nuur', 33848, 31685], ['Island of Destiny', 32094, 32004], ['Targuna', 33514, 32720],
        ['Winter Court', 33697, 32127], ['Summer Court', 33691, 32213], ['Talahu', 31953, 32660],
        ['Kharos', 32121, 32686], ['Malada', 32016, 32713],
    ];

    /**
     * Name the place nearest to (x, y) within `$radius` tiles, preferring a
     * region (specific hunting ground) over the broader city it sits near.
     * Returns null when nothing is close enough — the caller falls back to raw
     * coordinates.
     */
    public static function nearest(int $x, int $y, int $radius = 260): ?string
    {
        $best = null;
        $bestD = $radius * $radius;
        // Regions first (more specific); a city only wins if no region is closer.
        foreach ([self::REGIONS, self::LANDMARKS] as $tier) {
            foreach ($tier as [$name, $px, $py]) {
                $d = ($px - $x) ** 2 + ($py - $y) ** 2;
                if ($d <= $bestD) {
                    $bestD = $d;
                    $best = $name;
                }
            }
            if ($best !== null) {
                return $best;
            }
        }

        return $best;
    }
}
