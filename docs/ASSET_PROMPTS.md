# Промпты для генерации картинок

Стиль: космическая аркада, тёмный/прозрачный фон, неон (голубой/фиолетовый/золотой), без текста на изображении.

---

# Часть 1. Одна картинка на игру (4 шт.)

Использование: обложка/баннер при выборе игры в Prism League (сейчас там только emoji). Формат: **горизонтальный баннер или квадрат 1024×512 px** (или 512×512), PNG. Путь: `public/games/` (папку создать). В коде потом можно подставить `mode.image` вместо `mode.icon` (см. GAME_MODES в PrismLeague.tsx).

| # | Файл | Игра | Промпт |
|---|------|------|--------|
| 1 | **orbit_cover.png** | Orbit Survival | `Game cover art, orbit survival, spaceship orbiting around asteroid belt, dodging rocks, deep space background, neon cyan and purple glow, arcade style, no text, 1024x512 or square.` |
| 2 | **gravity_cover.png** | Gravity Runner | `Game cover art, gravity runner, spaceship or character flying upward between abstract column obstacles, crystals floating, gravity flip theme, neon teal and gold, arcade style, no text, 1024x512 or square.` |
| 3 | **mining_cover.png** | Asteroid Mining | `Game cover art, asteroid mining, spaceship with mining laser drilling asteroids, ore and coins, pirate drone in distance, space belt, neon amber and blue, arcade style, no text, 1024x512 or square.` |
| 4 | **territory_cover.png** | Territory Control | `Game cover art, territory control, spaceship capturing hex zones on orbital map, flags and zones, strategic space theme, neon green and purple, arcade style, no text, 1024x512 or square.` |
| 5 | **wars_cover.png** | Gravity Wars | `Game cover art, gravity wars, impulse wave pushing asteroids away from orbiting ship, shockwave ripple, neon cyan and orange, arcade style, no text, 1024x512 or square.` |
| 6 | **destroyer_cover.png** | Cosmic Defender | `Game cover art, cosmic defender, spaceship shooting enemies and bosses in four sectors, powerups, space shooter, neon red and cyan, arcade style, no text, 1024x512 or square.` |

Итого **6 обложек** (по одной на каждую игру в Prism League). Сохранять в `public/games/`.

---

# Часть 2. Иконки достижений — по одной группе (картинка) на игру

Вариант «одна картинка на игру» для достижений: **один спрайт-шит на игру** — все 9 иконок в одной картинке 1536×512 (сетка 3×3 по 512 px) или 1024×1024 (сетка 2×2 по 512 + 5 в ряд). Тогда в коде нужно будет вырезать регионы (CSS background-position или отдельные файлы нарезкой). Ниже — промпты на **одну общую картинку по игре** (все 9 достижений в одном изображении).

| Игра | Файл | Промпт (одна картинка = все 9 достижений) |
|------|------|------------------------------------------|
| **Gravity Rush** | **grav_achievements_sheet.png** | `Sprite sheet, 3x3 grid, 9 small achievement icons in one image: (1) wing rising (2) ship between columns (3) gravity path walker (4) crystal (5) veteran shield (6) crown on columns (7) marathon hourglass (8) galaxy legend (9) ace star. Sci-fi arcade style, neon cyan purple gold, transparent or dark background, each cell 512x512, no text.` |
| **Mining** | **mine_achievements_sheet.png** | `Sprite sheet, 3x3 grid, 9 small achievement icons: (1) ore pickaxe (2) magnifying glass prospector (3) gold coins (4) survivor shield (5) dark matter orb (6) efficient diamond (7) pirate slayer swords (8) tycoon crown (9) deep space miner. Sci-fi arcade, neon amber blue gold, transparent or dark background, each cell 512x512, no text.` |
| **Territory** | **terr_achievements_sheet.png** | `Sprite sheet, 3x3 grid, 9 small achievement icons: (1) single flag (2) map explorer (3) three zones holder (4) survivor 60 (5) defender shield (6) crown dominator (7) veteran medal (8) legend star (9) supreme trophy. Sci-fi arcade, neon green purple gold, transparent or dark background, each cell 512x512, no text.` |
| **Gravity Wars** | **wars_achievements_sheet.png** | `Sprite sheet, 3x3 grid, 9 small achievement icons: (1) one wave ripple (2) wave rider (3) war survivor shield (4) battle hardened (5) deflector wave (6) war veteran medal (7) chain reaction (8) war legend crown (9) grandmaster trophy. Sci-fi arcade, neon cyan orange gold, transparent or dark background, each cell 512x512, no text.` |

Если используете спрайт-шиты: итого **4 картинки** (по одной на игру), размер полотна 1536×1536 (3×3 по 512). В коде потом загрузка одного изображения и `background-position` по индексу достижения.

---

# Часть 3. Иконки достижений — по одной иконке (36 шт.)

Если нужны **отдельные файлы** для каждого достижения (как сейчас в коде), используйте промпты ниже. Формат: **512×512 px**, PNG, прозрачный фон. Путь: `public/achievements/`.

## Группа: Gravity Rush (9 иконок)

| Файл | Промпт |
|------|--------|
| grav_first_flight.png | `Game achievement icon, first flight, small spaceship or wing rising through gravity field, neon cyan and purple glow, dark transparent background, minimalist, 512x512, no text.` |
| grav_smooth_pilot.png | `Game achievement icon, smooth pilot, spaceship weaving between column shapes, motion lines, neon blue and white, dark transparent background, minimalist, 512x512, no text.` |
| grav_gravity_walker.png | `Game achievement icon, gravity walker, figure or ship on curved gravity path, wave symbol, neon teal and purple, dark transparent background, minimalist, 512x512, no text.` |
| grav_crystal_hunter.png | `Game achievement icon, crystal hunter, glowing crystal or gem, cyan and diamond sparkles, dark transparent background, minimalist, 512x512, no text.` |
| grav_gravity_veteran.png | `Game achievement icon, gravity veteran, shield or badge with gravity wave, gold and silver accent, dark transparent background, minimalist, 512x512, no text.` |
| grav_column_king.png | `Game achievement icon, column king, crown above abstract columns, neon gold and purple, dark transparent background, minimalist, 512x512, no text.` |
| grav_marathon.png | `Game achievement icon, marathon flyer, hourglass or clock with wings, long trail, neon blue and white, dark transparent background, minimalist, 512x512, no text.` |
| grav_gravity_legend.png | `Game achievement icon, gravity legend, galaxy spiral or star burst with gravity curve, gold and purple glow, dark transparent background, minimalist, 512x512, no text.` |
| grav_ace.png | `Game achievement icon, gravity ace, ace spade or star with wings, diamond tier gold and cyan, dark transparent background, minimalist, 512x512, no text.` |

## Группа: Mining (9 иконок)

| Файл | Промпт |
|------|--------|
| mine_first_ore.png | `Game achievement icon, first ore, asteroid chunk or ore with pickaxe, bronze glow, dark space transparent, minimalist, 512x512, no text.` |
| mine_prospector.png | `Game achievement icon, prospector, magnifying glass over asteroid or gem, neon amber and blue, dark transparent background, minimalist, 512x512, no text.` |
| mine_gold_rush.png | `Game achievement icon, gold rush, golden asteroid or coin pile with sparkles, silver tier, dark transparent background, minimalist, 512x512, no text.` |
| mine_survivor.png | `Game achievement icon, mining survivor, shield or timer with drill, neon green and blue, dark transparent background, minimalist, 512x512, no text.` |
| mine_dark_matter.png | `Game achievement icon, dark matter collector, dark swirling orb or vial with stars, gold tier, dark transparent background, minimalist, 512x512, no text.` |
| mine_efficient.png | `Game achievement icon, efficient miner, diamond or gear with upward arrow, neon cyan and gold, dark transparent background, minimalist, 512x512, no text.` |
| mine_pirate_slayer.png | `Game achievement icon, pirate slayer, crossed swords or skull with mining laser, red and gold accent, dark transparent background, minimalist, 512x512, no text.` |
| mine_tycoon.png | `Game achievement icon, mining tycoon, crown on pile of gems or coins, diamond tier gold glow, dark transparent background, minimalist, 512x512, no text.` |
| mine_deep_space.png | `Game achievement icon, deep space miner, ship in deep nebula, galaxy and purple glow, dark transparent background, minimalist, 512x512, no text.` |

## Группа: Territory Control (9 иконок)

| Файл | Промпт |
|------|--------|
| terr_first_capture.png | `Game achievement icon, first claim, single flag or territory marker on hex zone, bronze tier, neon green and blue, dark transparent background, minimalist, 512x512, no text.` |
| terr_explorer.png | `Game achievement icon, territory explorer, map or compass with zone dots, neon cyan, dark transparent background, minimalist, 512x512, no text.` |
| terr_holder_30.png | `Game achievement icon, zone holder, three connected hexagons, castle theme, silver tier, dark transparent background, minimalist, 512x512, no text.` |
| terr_survivor_60.png | `Game achievement icon, territory survivor, shield with clock, neon blue, dark transparent background, minimalist, 512x512, no text.` |
| terr_defender.png | `Game achievement icon, zone defender, shield deflecting asteroid from zone, gold accent, dark transparent background, minimalist, 512x512, no text.` |
| terr_dominator.png | `Game achievement icon, dominator, crown over five zones or full map, neon purple and gold, dark transparent background, minimalist, 512x512, no text.` |
| terr_survivor_120.png | `Game achievement icon, territory veteran, medal with zone and star, gold glow, dark transparent background, minimalist, 512x512, no text.` |
| terr_survivor_300.png | `Game achievement icon, territory legend, star burst over territory map, diamond blue and gold, dark transparent background, minimalist, 512x512, no text.` |
| terr_supreme.png | `Game achievement icon, supreme commander, trophy or general insignia, gold and white glow, dark transparent background, minimalist, 512x512, no text.` |

## Группа: Gravity Wars (9 иконок)

| Файл | Промпт |
|------|--------|
| wars_first_wave.png | `Game achievement icon, first wave, single expanding circular wave or ripple, neon cyan, dark transparent background, minimalist, 512x512, no text.` |
| wars_wave_rider.png | `Game achievement icon, wave rider, surfer or ship on wave, neon blue and white, dark transparent background, minimalist, 512x512, no text.` |
| wars_survivor_30.png | `Game achievement icon, war survivor, crossed swords with shield, silver tier, dark transparent background, minimalist, 512x512, no text.` |
| wars_survivor_60.png | `Game achievement icon, battle hardened, shield with armor, neon blue, dark transparent background, minimalist, 512x512, no text.` |
| wars_deflector.png | `Game achievement icon, deflector, wave pushing away asteroids, gold accent, dark transparent background, minimalist, 512x512, no text.` |
| wars_survivor_120.png | `Game achievement icon, war veteran, medal with wave symbol, gold tier, dark transparent background, minimalist, 512x512, no text.` |
| wars_chain_master.png | `Game achievement icon, chain reaction, single wave hitting five asteroids, link symbol, gold glow, dark transparent background, minimalist, 512x512, no text.` |
| wars_survivor_300.png | `Game achievement icon, war legend, crown with wave and stars, diamond tier, dark transparent background, minimalist, 512x512, no text.` |
| wars_grandmaster.png | `Game achievement icon, grandmaster, trophy or grandmaster emblem, gold and cyan glow, dark transparent background, minimalist, 512x512, no text.` |

---

## Универсальный системный промпт

Добавлять к любому промпту при необходимости:

`Style: sci-fi arcade game badge, flat design with subtle glow, transparent background, no words or numbers on the icon, consistent with space shooter and identity card aesthetic.`
