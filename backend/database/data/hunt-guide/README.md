# Hunt guide — ground truth de la comunidad

Guía de spots de caza por vocación, aportada por el usuario (2026-07-16). Es lo
único parecido a ground truth que tenemos contra qué medir el Hunt Finder: hasta
ahora los pesos de `HuntFinder` se afinaron a ojo.

## Formato

Un archivo por vocación, `<vocacion>.txt`, una línea por spot:

    min_level|zona|exp_h|profit_h|recomendacion

- `min_level` — nivel mínimo recomendado **para esa vocación**. No transfiere
  entre vocaciones: Cobra Bastion es 800+ para EK y 500+ para MS.
- `exp_h` / `profit_h` — experiencia y **profit NETO** por hora (supplies ya
  descontados; de ahí los negativos). `-` cuando la fuente no lo trae. Ojo: la
  DB guarda `gold_per_kill` BRUTO, así que no son comparables de una.
- `recomendacion` — lo que la fuente aconseja llevar. El significado cambia por
  vocación (imbuement de arma para EK, munición+imbuement para RP, mastery para
  MS, playstyle de hechizos para ED), así que solo el elemento es comparable
  contra lo que calcula `HuntFinder::bestElements()`.

Los nombres son jerga de la comunidad, no los `place` del bestiario. `aliases.php`
mapea los que se pueden mapear; el resto queda sin resolver a propósito.

## Límites conocidos

- El tramo de 800+ (Raubritter, Norcferatu, Bloodfire Gorge, Bulltaur) **no
  existe en canary**: cero luas y cero spawns. No es un bug nuestro y no se
  arregla desde esta fuente, así que esos spots nunca van a resolver.
- La guía asume gear y habilidades de endgame para el nivel; el finder deriva su
  set con `GearRules`. Son supuestos distintos y explican parte del desacuerdo.
