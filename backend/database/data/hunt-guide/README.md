# Hunt guide — ground truth de la comunidad

Guía de spots de caza por vocación, aportada por el usuario (2026-07-16, ampliada
el 2026-07-23). Es lo único parecido a ground truth que tenemos contra qué medir
el Hunt Finder: hasta ahora los pesos de `HuntFinder` se afinaron a ojo.

La segunda entrega trajo **exp/h y loot/h reales** para la mayoría de las filas —
la primera solo traía nivel, zona y recomendación. Eso es lo que convirtió
`tibia:hunt-calibrate --exp` en una medida y no en una impresión, y lo que
destapó dos bugs de fondo: `gold_per_kill` inflado por precios de la wiki mal
leídos, y que publicábamos loot BRUTO contra el profit NETO de la guía.

La entrega del 23 también trae listas de **duo** y **team** (solo nivel y zona,
sin números). No están cargadas: el calibrador corre en modo solo y una fila sin
exp/h ni elemento no aporta nada que podamos medir.

## Formato

Un archivo por vocación, `<vocacion>.txt`, una línea por spot:

    min_level|zona|exp_h|profit_h|recomendacion

- `min_level` — nivel mínimo recomendado **para esa vocación**. No transfiere
  entre vocaciones: Cobra Bastion es 800+ para EK y 500+ para MS.
- `exp_h` / `profit_h` — experiencia y **profit NETO** por hora (supplies ya
  descontados; de ahí los negativos). `-` cuando la fuente no lo trae. La DB
  guarda `gold_per_kill` BRUTO; el `profit_h` que publica el finder ya le resta
  el modelo de supplies (`HuntFinder::zoneSupply`), así que sí es comparable.
- `recomendacion` — lo que la fuente aconseja llevar. El significado cambia por
  vocación (imbuement de arma para EK, munición+imbuement para RP, mastery para
  MS, playstyle de hechizos para ED), así que solo el elemento es comparable
  contra lo que calcula `HuntFinder::bestElements()`.

Los nombres son jerga de la comunidad, no los `place` del bestiario. La guía casi
siempre nombra **al bicho y a la ciudad** ("Edron Rotworm Cave", "Tarantulas Port
Hope"), así que el calibrador casa por esos dos hechos a la vez — residente
dominante Y lugar — además del alias curado y del nombre idéntico. `aliases.php`
queda para lo que ninguna de las tres resuelve; el resto queda sin resolver a
propósito.

## Estado (2026-07-23)

`php artisan tibia:hunt-calibrate --exp` sobre las 1036 filas:

    cobertura 20.2% | recall 24.9% | elemento 72.4%
    exp/h     error mediano 29%, sesgo  -5%
    profit/h  error mediano 73%, sesgo -24%

Contra el arranque del día (cobertura 17.0%, recall 25.4%, elemento 65.0%, y un
profit con sesgo **+39%** que llegaba a +3200% en zonas de nivel bajo).

Lo que movió cada cosa, medido:

- **`gold_per_kill` inflado.** `EtlLootStats::itemWorth()` tomaba el `max()` de
  cualquier número del campo `value` de la wiki. En Worm ese campo dice
  "Backpack of worms: from 800 to 1600", así que cada worm valía 1600 gp: Hyaena
  (suelta ~1 worm por kill, 20 exp) daba 1.608 gp/kill y su tumba era el mejor
  spot del mapa para un knight 20 (1,28M gp/h). Ghoul 259 → 22, Troll → 9.
- **Publicábamos loot BRUTO contra profit NETO.** No había modelo de supplies en
  ningún lado, que es también por qué una hunt que PIERDE plata (Lava Lurkers,
  Corym Black Market) no se podía ni expresar. El sesgo de profit pasó de +39% a
  -24% al agregarlo.
- **La curva de supplies es superlineal, no lineal.** El primer intento
  (gp fijos por nivel) le cobraba ~20k/h a un nivel 8 y mandaba toda la franja
  baja a números negativos: sesgo -123%. Con `100 · nivel^1.45` quedó en -24%.
- **Punta del rango de precios.** Se probó el punto medio en vez del mínimo:
  peor (mediana 80% vs 73%, mismo sesgo). El mínimo se queda.

## Límites conocidos

- El tramo de 800+ (Raubritter, Norcferatu, Bloodfire Gorge, Bulltaur) **no
  existe en canary**: cero luas y cero spawns. No es un bug nuestro y no se
  arregla desde esta fuente, así que esos spots nunca van a resolver.
- La guía asume gear y habilidades de endgame para el nivel; el finder deriva su
  set con `GearRules`. Son supuestos distintos y explican parte del desacuerdo.
- **El loot de endgame nos queda corto y es estructural.** Los peores misses de
  profit son todos de arriba: Warzone 3 -98%, Cobra Bastion -130%, Azzilon
  Catacombs -124%, Summer Court -80%. Ahí la plata no sale de ítems que un NPC
  compre sino del mercado entre jugadores (tokens, materiales de imbuement), y
  `itemWorth()` solo sabe de `npc_value`: lo que no tiene comprador NPC vale 0
  para nosotros. No se arregla afinando pesos, hace falta una fuente de precios
  de mercado.
- **Cobertura ≠ scoring.** De 1036 filas seguimos sin saber nombrar 808. El
  cuello no es el ranking (el exp/h ya coincide) sino que la guía distingue
  spots que nuestro clustering no separa ("Ingol -3" vs nuestro "Ingol",
  "Deeper Banuta -6" vs "-8"). Subir esto es trabajo de granularidad de zonas,
  no de pesos.
