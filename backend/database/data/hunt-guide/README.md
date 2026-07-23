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

## Límites conocidos

- El tramo de 800+ (Raubritter, Norcferatu, Bloodfire Gorge, Bulltaur) **no
  existe en canary**: cero luas y cero spawns. No es un bug nuestro y no se
  arregla desde esta fuente, así que esos spots nunca van a resolver.
- La guía asume gear y habilidades de endgame para el nivel; el finder deriva su
  set con `GearRules`. Son supuestos distintos y explican parte del desacuerdo.
