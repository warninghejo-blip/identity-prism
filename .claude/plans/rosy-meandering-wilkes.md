# НОВАЯ ЗАДАЧА: Магазин (layout) + Ауры (рефакт) + Корабли (stats по рарности)

## Что делаем

### A. Fix layout карточек в магазине
- Карточки разной высоты из-за описаний и условий разблокировки
- Решение: flex-col + mt-auto на кнопках → цены/кнопки выровнены по низу

### B. Ауры → Ship Auras с % бонусами
- Сейчас: glow на карточке + мизерные flat +3/+4
- Станет: % множители к статам корабля (10-15%), цены x2-3
- `applyBonuses()` → ауры применяются мультипликативно ПОСЛЕ flat бонусов

### C. Корабли — статы по рарности (бюджет на тир)
- Common: 10 total, Rare: 16, Epic: 22, Legendary: 32
- Балансировка существующих SKIN_BONUSES под эти бюджеты

## Файлы
- `src/pages/StellarForge.tsx` — ItemCard layout
- `src/lib/forgeItems.ts` — цены/описания аур
- `src/lib/shipStats.ts` — AURA_BONUSES (%), SKIN_BONUSES (баланс), applyBonuses()
