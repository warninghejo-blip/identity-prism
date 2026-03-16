# Аудит изображений проекта Identity Prism

## Что уже есть в проекте

### Корень / public
- **phav.png** — логотип/фавикон приложения (landing, Verify, Index, og:image, favicon)
- **placeholder.svg** — плейсхолдер

### public/assets
- **godray.png** — эффект лучей
- **icon.png** — иконка
- **identity-prism.png** — логотип Identity Prism

### public/badges (12 шт.)
Используются в CelestialCard по маппингу trait → файл.
- binary_sun, blue_chip, collector, defi_king, diamond_hands, early_adopter, meme_lord, og_member, seeker_of_truth, solana_maxi, tx_titan, visionary, whale

### public/achievements (18 шт. есть)
- **Defender (Cosmic Defender):** def_outer_rim, def_nebula_front, def_dark_sector, def_final_stand, def_recruit, def_veteran, def_exterminator, achive_trophy, achive_diamond_ship
- **Orbit (Orbit Survival):** first_orbit, space_cadet, orbit_walker, cosmic_veteran, asteroid_dancer, orbit_legend, persistent_pilot, dedicated_captain, marathon_runner

### public/textures
- **ships:** ship.png + ship_default, ship_stealth, ship_chrome, ship_neon, ship_phantom, ship_prism, ship_golden
- **enemies:** enemy_scout, fighter, tank, swarm, bomber, cloaker, shielder, elite, boss1–boss4
- **powerups:** powerup_shield, powerup_slowmo, powerup_phase, powerup_coin, powerup_photon_burst, powerup_quantum_core, powerup_nebula_bomb, powerup_nova_rockets
- **planets:** mercury_map, venus_map, venus_atmosphere, earth_daymap, earth_normal, earth_specular, earth_clouds, mars_map, mars_normal, jupiter_map, saturn_map, saturn_ring, uranus_map, neptune_map, sun_map
- **asteroids:** rock_ground_*, rock_boulder_dry_*, brown_mud_rocks_01_*, rock_face_* (diff + nor_gl)
- **Solana.png** — водяной знак на карточке

---

## Чего не хватает (нужно добавить)

Все пути относительно `public/achievements/`. Формат: квадратная иконка достижения, космический/игровой стиль, PNG с прозрачностью, 256×256 или 512×512.

### 1. Gravity Rush (9 иконок)
Файлы: `grav_first_flight.png` … `grav_ace.png`

| Файл | Название | Описание |
|------|----------|----------|
| grav_first_flight.png | First Flight | Выжить 15 сек |
| grav_smooth_pilot.png | Smooth Pilot | Пройти 30 колонн за забег |
| grav_gravity_walker.png | Gravity Walker | Выжить 60 сек |
| grav_crystal_hunter.png | Crystal Hunter | Собрать 100 кристаллов всего |
| grav_gravity_veteran.png | Gravity Veteran | Выжить 120 сек |
| grav_column_king.png | Column King | Пройти 200 колонн всего |
| grav_marathon.png | Marathon Flyer | 30 минут общего времени в игре |
| grav_gravity_legend.png | Gravity Legend | Выжить 300 сек |
| grav_ace.png | Gravity Ace | 2000+ очков за забег |

### 2. Mining (Asteroid Mining) (9 иконок)
Файлы: `mine_first_ore.png` … `mine_deep_space.png`

| Файл | Название | Описание |
|------|----------|----------|
| mine_first_ore.png | First Ore | Добыть 1 астероид |
| mine_prospector.png | Prospector | Добыть 50 астероидов всего |
| mine_gold_rush.png | Gold Rush | 10 золотых астероидов за сессию / 200 монет |
| mine_survivor.png | Mining Survivor | Выжить 120 сек |
| mine_dark_matter.png | Dark Matter Collector | Добыть 5 тёмной материи |
| mine_efficient.png | Efficient Miner | 500+ монет за сессию |
| mine_pirate_slayer.png | Pirate Slayer | Уничтожить 30 пиратских дронов |
| mine_tycoon.png | Mining Tycoon | 1000+ монет за сессию |
| mine_deep_space.png | Deep Space Miner | Выжить 300 сек |

### 3. Territory Control (9 иконок)
Файлы: `terr_first_capture.png` … `terr_supreme.png`

| Файл | Название | Описание |
|------|----------|----------|
| terr_first_capture.png | First Claim | Захватить 1 зону |
| terr_explorer.png | Territory Explorer | Захватить 5 зон всего |
| terr_holder_30.png | Zone Holder | Удерживать 3 зоны одновременно |
| terr_survivor_60.png | Territory Survivor | Выжить 60 сек |
| terr_defender.png | Zone Defender | Защитить 20 зон от астероидов |
| terr_dominator.png | Dominator | Удерживать все зоны одновременно |
| terr_survivor_120.png | Territory Veteran | Выжить 120 сек |
| terr_survivor_300.png | Territory Legend | Выжить 300 сек |
| terr_supreme.png | Supreme Commander | 3000+ очков |

### 4. Gravity Wars (9 иконок)
Файлы: `wars_first_wave.png` … `wars_grandmaster.png`

| Файл | Название | Описание |
|------|----------|----------|
| wars_first_wave.png | First Wave | Использовать импульсную волну 1 раз |
| wars_wave_rider.png | Wave Rider | 50 импульсных волн всего |
| wars_survivor_30.png | War Survivor | Выжить 30 сек |
| wars_survivor_60.png | Battle Hardened | Выжить 60 сек |
| wars_deflector.png | Deflector | Оттолкнуть 100 астероидов всего |
| wars_survivor_120.png | War Veteran | Выжить 120 сек |
| wars_chain_master.png | Chain Reaction | Оттолкнуть 5 астероидов одной волной |
| wars_survivor_300.png | War Legend | Выжить 300 сек |
| wars_grandmaster.png | Grandmaster | 3000+ очков |

---

**Итого недостаёт: 36 иконок достижений** (4 игры × 9 достижений).

Рекомендация: единый визуальный стиль — космическая тема, тёмный фон или прозрачный, металлические/неоновые акценты (золото/серебро/бронза/алмаз по тиру), размер 256×256 или 512×512 px, PNG.

---

## Где ещё могут понадобиться картинки

### Prism League (выбор игры)
- **Сейчас:** только emoji в `GAME_MODES` (🛸 💥 🔄 ⚡ 🏴 ⛏️).
- **Опционально:** по одной обложке на игру (6 картинок) — баннер/карточка при выборе режима. Путь: `public/games/` (orbit_cover.png, gravity_cover.png, mining_cover.png, territory_cover.png, wars_cover.png, destroyer_cover.png). Промпты в `docs/ASSET_PROMPTS.md` (Часть 1).

### Магазин (Stellar Forge)
- **Armory (Shop):** отдельные картинки для товаров **не нужны**. Frame и Aura рендерятся через CSS (градиенты, тени). Ship skin — один спрайт `/textures/ship.png` + CSS-фильтры (tint) для каждого скина; реальные файлы скинов уже есть в `/textures/ships/` и используются в играх. Title — текст в превью.
- **Bazaar (Creator Market):** превью товаров — это **previewImage** из API; картинку загружает создатель при создании листинга. Своих статичных картинок для маркета не требуется.
- **Модельки/3D:** в магазине нет 3D превью; везде плоские превью (CSS + один ship.png). Добавлять 3D модельки не обязательно.

### Другие страницы
- **Quests:** иконки табов и квестов — emoji (☀️ 📅 ⭐ и т.д.), отдельные картинки не заданы.
- **Leaderboard:** иконки табов — Lucide (Trophy, Orbit, Crosshair и т.д.), не картинки.
- **Prism Scanner / Compare / Arena:** нет ссылок на статичные изображения, кроме общих phav.png и карточки кошелька.
- **Black Hole:** изображения токенов приходят из API (NFT/metadata), не из `/public`.

**Итог:** в магазине и в остальных местах отдельные «модельки» или превью-картинки для товаров не обязательны; опционально — только 6 обложек игр для Prism League.

---

## Серверный рендер карточки (cardGenerator)

**Путь:** `server/assets/` (или корневая папка `assets/`, если есть — сервер подхватывает её первой).

Используется для генерации изображений карточки (оборот, превью по тиру, бейджи). В текущем репозитории **всё уже есть**:

- **card-back-template.png** — шаблон оборота карты
- **badges/** — og.png, whale.png, collector.png, binary.png, early.png, titan.png, maxi.png, seeker.png, visionary.png, defi_king.png, diamond_hands.png, meme_lord.png, degen.png (имена для сервера короче, чем в public/badges)
- **previews/** — mercury.png … sun.png, binary_sun.png (превью по тирам); back.png, back-stats.png, back-badges.png; back-layout.json
- **textures/** — карты планет (как в public/textures)
- **fonts/font.ttf**

Дополнительные картинки для сервера **не нужны**.

---

## Публикация в магазин приложений (Publishing / dapp-store)

**Манифест:** `publishing/.asset-manifest.json` ссылается на папку **`../dapp-store/media/`** (относительно publishing или корня).

Для публикации в сторе (например, Solana dApp Store) используются:

| Файл | Назначение |
|------|------------|
| app_icon.png | Иконка приложения |
| release_icon.png | Иконка релиза |
| banner.png | Баннер листинга |
| screenshot_1_landing.png | Скриншот: лендинг |
| screenshot_2_front.png | Скриншот: карточка (фронт) |
| screenshot_3_stats.png | Скриншот: статистика |
| screenshot_4_badges.png | Скриншот: бейджи |

Эти файлы лежат **вне** основного репозитория (в `dapp-store/media/` или аналоге). Если папки нет или файлы не подготовлены — их нужно добавить при подготовке к публикации в store. Для работы самого веб-приложения они **не требуются**.
