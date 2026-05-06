# Identity Prism — Missing Assets & Emoji Audit

Аудит проведён: 2026-05-01.
Найдено ~115 emoji-вхождений в 14 файлах.

## Стилистика бренда (для всех промптов)

- Космос, неон, киберпанк, glow-эффекты
- Тёмный фон (`#05070a`)
- Cyan / Purple / Magenta accents
- 3D rendered look, не flat
- Premium / sci-fi / mystical
- Существующие референсы: `public/phav.png`, `public/textures/ranks/`, frames/auras/ships в `forgeItems`

---

## 🚨 Quick Win — 9 hub-иконок: фикс без рисования

В `public/hub/` уже лежат готовые PNG, но в `src/pages/HomePage.tsx:37–65` используются emoji вместо `<img>`. Просто заменить:

| Emoji в коде | Файл (готов) |
|---|---|
| 🔬 | `/hub/scanner.png` |
| 🎮 | `/hub/league.png` |
| 🕳️ | `/hub/blackhole.png` |
| 💎 | `/hub/vault.png` |
| 🛒 | `/hub/shop.png` |
| 🏆 | `/hub/leaderboard.png` |
| 📜 | `/hub/quests.png` |
| ⚔️ | `/hub/arena.png` |
| 🌌 | `/hub/constellation.png` |

**Действие:** правка `HomePage.tsx`, ~5 минут. Не требует генерации картинок.

---

## Существующие assets (для справки)

### Подключены и используются:
- `/textures/ranks/rank_*.png` — 5 rank images (cadet/pilot/captain/ace/legend)
- `/textures/tiers/*.png` — 10 planet tiers
- `/textures/ships/ship_*.png` — 19 ship skins
- `/textures/modules/mod_*.png` — 12 module images
- `/textures/enemies/enemy_*.png` — 12 enemy sprites
- `/textures/powerups/powerup_*.png` — 8 powerup sprites
- `/achievements/*.png` — ~35 achievement images
- `/badges/*.png` — 29 profile badges
- `/games/*_cover.png` — 5 game covers

### Готовы, но НЕ подключены (см. Quick Win выше):
- `/hub/*.png` — 9 hub icons

---

# 📋 Missing Assets — Список для генерации

Всего: **32 картинки** (по приоритетам ниже).

Общий suffix для всех промптов:
```
, dark cosmic background, glow effect, premium AAA game asset, 3D rendered style, transparent PNG, no text
```

---

## CRITICAL (12 шт.) — видны на главных экранах

### 1. Forge Category Icons (4 шт.) — `lib/forgeItems.ts:730-733`
Размер: 32×32 PNG transparent (или SVG)
Расположение: фильтры табов в Shop/StellarForge

| # | Файл | Текущий emoji | Промпт |
|---|------|---|---|
| 1.1 | `forge_frame.png` | 🖼️ | Glowing sci-fi holographic card frame icon, cyan neon border, minimal design |
| 1.2 | `forge_aura.png` | ✨ | Sci-fi energy aura orb icon, purple/magenta particle glow ring |
| 1.3 | `forge_ship.png` | 🚀 | Sleek futuristic spaceship silhouette icon, cyan/teal neon glow, top-down view |
| 1.4 | `forge_title.png` | 🏷️ | Sci-fi rank badge icon, holographic nameplate with glow, purple/gold |

### 2. Ship Stat Icons (4 шт.) — `pages/PrismLeague.tsx:3418-3427`
Размер: 20×20 SVG/PNG transparent (минималистичные иконки рядом со значениями)
Расположение: показ stats корабля в League

| # | Файл | Текущий emoji | Промпт |
|---|------|---|---|
| 2.1 | `stat_speed.svg` | ⚡ | Cyan lightning bolt stat icon, sci-fi minimal, neon glow, 20×20 |
| 2.2 | `stat_shield.svg` | 🛡️ | Hexagonal sci-fi shield stat icon, blue glow, minimal, 20×20 |
| 2.3 | `stat_firepower.svg` | 🔥 | Neon fire/plasma stat icon, orange/red, sci-fi minimal, 20×20 |
| 2.4 | `stat_luck.svg` | 🍀 | Cosmic luck stat icon, purple four-pointed crystal star, sci-fi minimal, 20×20 |

### 3. Game Mode Tab Icons (4 шт.) — `pages/PrismLeague.tsx:63-91`
Размер: 48×48 PNG transparent
Расположение: вкладки выбора игры в League. Cover-картинки уже есть, нужны small icons.

| # | Файл | Текущий emoji | Промпт |
|---|------|---|---|
| 3.1 | `mode_orbit.png` | 🛸 | Glowing UFO spacecraft icon orbiting planet rings, cyan neon |
| 3.2 | `mode_defender.png` | 💥 | Space turret cannon shooting neon laser beams icon, purple/cyan |
| 3.3 | `mode_gravity.png` | 🔄 | Sci-fi spacecraft flying through glowing asteroid columns, cyan motion trail |
| 3.4 | `mode_text.png` | 📖 | Glowing holographic data-pad book icon, sci-fi text interface, purple/cyan glow |

---

## NICE-TO-HAVE (17 шт.) — вторичные экраны

### 4. Quest Category Icons (6 шт.) — `lib/prismQuests.ts`
Размер: 48×48 PNG transparent
Расположение: список квестов на странице Quests. 16 квестов, но для всех хватит 6 icon'ов по категориям.

| # | Файл | Категория (примеры emoji) | Промпт |
|---|------|---|---|
| 4.1 | `quest_identity.png` | 🔬 (Daily Scan, First Contact, Solar Ascension) | Sci-fi identity scanner beam icon, cyan holographic scan lines |
| 4.2 | `quest_game.png` | 🎮 (Daily Player, Champion, Marathon Runner) | Futuristic holographic game controller icon, neon cyan |
| 4.3 | `quest_burn.png` | 🔥🕳️ (Dust Collector, Purge Week, Black Hole Master) | Miniature black hole with fire ring icon, dark matter swirl, magenta/orange glow |
| 4.4 | `quest_explore.png` | 🎯 (Sybil Hunter, Story Explorer, Collector) | Sci-fi targeting reticle with blockchain node network icon, cyan/purple |
| 4.5 | `quest_shop.png` | 🛒 (Shop Haul) | Futuristic cosmic marketplace icon with holographic shelves, cyan/gold |
| 4.6 | `quest_arena.png` | ⚔️ (Arena Fighter) | Sci-fi crossed plasma swords arena icon, neon purple/red glow |

### 5. Vault Staking Tier Badges (3 шт.) — `pages/PrismVault.tsx:395-417`
Размер: 48×48 PNG transparent
Расположение: badges рядом со staking lock tiers (1w/1m/3m/6m mapping → bronze/silver/gold)

| # | Файл | Текущий emoji | Промпт |
|---|------|---|---|
| 5.1 | `tier_bronze.png` | 🥉 | Bronze cosmic vault badge, metallic bronze sci-fi medallion with dark space glow |
| 5.2 | `tier_silver.png` | 🥈 | Silver metallic sci-fi vault badge medallion, cold chrome glow |
| 5.3 | `tier_gold.png` | 🥇 | Gold cosmic vault badge, gleaming golden sci-fi medallion with star glow |

### 6. Sybil Hunt Rank Badges (5 шт.) — `pages/PrismScanner.tsx:781-785`
Размер: 32×32 PNG transparent
Расположение: иконка рядом с прогрессом охоты

| # | Файл | Ранг (текущий emoji) | Промпт |
|---|------|---|---|
| 6.1 | `hunt_recruit.png` | Recruit (🔰) | Basic hexagon rank badge, grey metallic, sci-fi rookie insignia |
| 6.2 | `hunt_tracker.png` | Tracker (🎯) | Green sci-fi targeting crosshair rank badge, neon green glow |
| 6.3 | `hunt_specialist.png` | Specialist (⚡) | Blue lightning bolt rank badge with circuit pattern, neon blue |
| 6.4 | `hunt_veteran.png` | Veteran (🔥) | Purple flame rank badge, plasma fire, premium sci-fi |
| 6.5 | `hunt_apex.png` | Apex Hunter (💀) | Golden skull rank badge, apex predator insignia, gold glow, sci-fi cosmic |

### 7. Quest Page Tab Icons (3 шт.) — `pages/QuestsPage.tsx:38-40`
Размер: 24×24 SVG/PNG transparent
Расположение: маленькие иконки в табах Daily/Weekly/Milestones

| # | Файл | Текущий emoji | Промпт |
|---|------|---|---|
| 7.1 | `quest_tab_daily.svg` | ☀️ | Neon star sun daily quest tab icon, cyan/gold minimal, sci-fi |
| 7.2 | `quest_tab_weekly.svg` | 📅 | Holographic calendar weekly quest icon, cyan grid, sci-fi minimal |
| 7.3 | `quest_tab_milestones.svg` | ⭐ | Glowing milestone star icon, purple/gold sci-fi achievement |

---

## OPTIONAL (3 шт.) — onboarding (показывается 1 раз)

### 8. Onboarding Step Illustrations — `components/OnboardingModal.tsx:8-18`
Размер: 512×512 PNG transparent
Расположение: иллюстрации над текстом в каждом из 3 шагов первичного онбординга

| # | Файл | Шаг (текущий emoji) | Промпт |
|---|------|---|---|
| 8.1 | `onboard_welcome.png` | Welcome (🌟) | Glowing cosmic identity card floating in space, prism light refraction, cyan/purple, premium illustration |
| 8.2 | `onboard_score.png` | Identity Score (📊) | Holographic data dashboard with blockchain score pillars, sci-fi analytics interface, cyan/purple neon |
| 8.3 | `onboard_earn.png` | Earn & Play (🚀) | Futuristic spaceship launching through portal with coins/stars, reward explosion, neon cyan/magenta |

---

# 📊 Summary

| Категория | Шт. | Приоритет | Время на ассет |
|---|---|---|---|
| Hub icons (уже есть, фикс кода) | 9 | 🚨 Critical | ~5 мин на ВСЕ |
| Forge category icons | 4 | 🚨 Critical | 1×4 |
| Ship stat icons | 4 | 🚨 Critical | 1×4 |
| Game mode tab icons | 4 | 🚨 Critical | 1×4 |
| Quest category icons | 6 | ⚠️ Nice | 1×6 |
| Vault staking tier badges | 3 | ⚠️ Nice | 1×3 |
| Sybil Hunt rank badges | 5 | ⚠️ Nice | 1×5 |
| Quest page tab icons | 3 | ⚠️ Nice | 1×3 |
| Onboarding illustrations | 3 | 🟢 Optional | 1×3 |
| **TOTAL для генерации** | **32** | | |

---

# 🎯 Recommended next steps

1. **Hub fix** — заменить emoji на `<img>` в `HomePage.tsx` (5 минут, без AI)
2. **Batch CRITICAL** — сгенерить 12 картинок (forge categories + ship stats + game modes) через DALL-E/Flux/Midjourney одним батчем по промптам выше
3. **Подключить в коде** — заменить emoji на `<img src="/icons/...png">` в соответствующих файлах
4. **Тест на устройстве** — APK rebuild + install + screenshot
5. **NICE-TO-HAVE batch** — 17 картинок второй волной
6. **OPTIONAL onboarding** — последним

---

# 🛠️ Папки для размещения сгенерированных PNG

```
public/
├── hub/             ← (уже есть, 9 файлов)
├── icons/
│   ├── forge/       ← Forge category icons (4)
│   ├── stats/       ← Ship stat icons (4)
│   ├── modes/       ← Game mode tab icons (4)
│   ├── quests/      ← Quest category icons (6)
│   ├── tiers/       ← Vault staking badges (3) [не путать с /textures/tiers/]
│   ├── hunt/        ← Sybil Hunt rank badges (5)
│   └── tabs/        ← Quest tab icons (3)
└── onboarding/      ← Onboarding illustrations (3)
```

(Структура — рекомендация. Можно положить плоско в `public/icons/` если предпочитаешь.)
