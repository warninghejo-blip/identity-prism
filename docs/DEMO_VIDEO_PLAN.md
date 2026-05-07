# Identity Prism Demo Video Plan

Дата подготовки: 2026-05-07

Источник анализа:
- локальный код и `docs/PROJECT_REFERENCE.md`;
- Colosseum Copilot: поиск похожих Solana hackathon projects, winner-pattern compare, archive search;
- текущая неплатежная проверка проекта: платежи сознательно оставлены на финальный отдельный pass.

## 1. Главный вывод

Identity Prism не стоит подавать как "еще один wallet scorer". По Copilot рядом уже есть Solana Passport, Solana Reputation Scorer, ASSAP, Proof of Togetherness и Solana ID. Они закрывают отдельные куски: ZK humanity, mintable reputation score, attestation, social credibility или digital identity.

Наш лучший угол для демо: **живой on-chain reputation passport, который не только оценивает кошелек, но и дает пользователю путь доказать человечность действием**.

Цикл:

1. Кошелек сканируется.
2. Пользователь получает понятную identity card: score, tier, trust grade, badges.
3. Даже слабый или новый кошелек не получает пожизненный приговор: он может играть, выполнять quests, проходить recovery actions и накапливать human/engagement proof.
4. Пользователи сами находят сибиллов через Sybil Hunt, а база сигналов постоянно пополняется.
5. Trust и on-chain активность влияют на gameplay stats.
6. Игры, quests, Sybil Hunt, Arena и tournaments дают XP/coins.
7. Coins тратятся в Shop на cosmetics/modules, а loadout меняет stats и влияет на игры.

Это надо показывать как одну систему, а не как набор вкладок.

## 2. Copilot Landscape

Данные ниже взяты из Colosseum Copilot.

### Ближайшие похожие проекты

| Project | Hackathon | Что делает | Чем отличается Identity Prism |
| --- | --- | --- | --- |
| Solana Passport | Radar | ZK-powered identity verification через Reclaim stamps | У нас не только proof-of-humanity, а score + card + sybil verdict + utility loop |
| Solana Reputation Scorer | Breakout | AI/on-chain score, который можно mint/share | У нас score становится игровыми stats, gating, rewards, shop и tournament logic |
| ASSAP | Breakout | Human-verified anti-sybil attestations | У нас anti-sybil не отдельный protocol primitive, а user-facing hunt + verdict + reward flow |
| Proof of Togetherness | Radar | Credibility через social graph, attendance, interaction data | У нас social - только часть общей identity модели, рядом есть on-chain, trust, games, engagement |
| Solana ID | Renaissance | Digital footprints linked to wallets for personalized rewards | У нас акцент не на ads/perks, а на public reputation passport and productized Solana identity |

### Что важно из winner-pattern compare

Copilot сравнил 293 winners против 5428 проектов.

Сигналы:
- Winners заметно чаще выглядят как **data / monitoring / infra**, а не просто consumer skin.
- Winners over-index на Rust, Anchor, TypeScript. У нас TypeScript/React/Web3 stack есть, но в демо важно показать backend authority: server-validated rewards, tournament entry, sybil verdict, caps, spend validation.
- Consumer/gaming сами по себе переполнены. Значит games надо показывать не как "мы сделали аркадки", а как **retention and proof loop** внутри identity продукта.
- Decentralized identity и on-chain reputation есть в поле, но прямой плотности немного. Дифференциация должна быть в понятном UX и в том, что score реально используется.

## 3. Что подчеркивать

### Самые сильные пункты

1. **Immediate wallet identity**
   Пользователь вставляет адрес и сразу видит понятную карточку: общий score, tier, trust grade, badges, rank.

2. **Unified score instead of metric soup**
   Объяснять не Raw Trust / Sybil Risk / Risk Meter, а одну понятную историю: identity score + trust grade + category breakdown.

3. **Sybil Hunt как productized anti-sybil layer**
   Не просто "мы считаем риск", а: suggested targets, scan under 10 seconds, verdict, confidence, evidence, reward, false flag feedback, growing scan history.

4. **Bad wallet is not a dead end**
   Если кошелек выглядит слабым или рискованным, пользователь может доказывать человечность действиями: играть, проходить quests, улучшать trust recovery, накапливать engagement proof.

5. **Score affects product behavior**
   On-chain / trust / games / social / engagement превращаются в speed, shield, firepower, luck.

6. **Economy loop**
   Gameplay and quests earn coins. Shop spends coins. Items/modules change stats. Tournaments and arena create sinks and competition.

7. **Mobile-first Solana app**
   Capacitor + Solana Mobile Wallet Adapter + mobile UI. Для демо лучше показывать в phone frame.

8. **Server-authoritative parts**
   Rewards, spend, tournaments, sybil verdicts, caps and challenge settlement are not just local UI toys.

## 4. Что не растягивать

- Не тратить много времени на token / Prism token logo. Токен пока скипнут.
- Платежи показать только как существующий Vault flow, без реального исполнения.
- Не объяснять каждую формулу XP/caps в голосе. В видео достаточно показать, что rewards/caps есть и серверно контролируются.
- Не уходить в "AI" как главный тезис. AI/social agent можно упомянуть в конце как expansion, если останется время.
- Не показывать все 16 text quests. Достаточно одного кадра, что есть branching quests.

## 5. Рекомендуемый формат видео

Master format: **16:9, 1920x1080, 30fps**.

Композиция:
- В центре или справа - мобильный capture приложения в phone frame.
- Слева короткие callouts на 3-5 слов.
- Озвучка ведет историю, callouts не дублируют весь текст.

Почему не чисто vertical:
- Для hackathon / demo review удобнее 16:9.
- Приложение mobile-first, поэтому phone frame внутри 16:9 выглядит логично.
- Потом можно сделать vertical cut, просто кропнув phone frame и captions.

Target duration: **2:55**.

Расчет:
- Неспешная русская озвучка: примерно 120-130 слов в минуту.
- Скрипт ниже рассчитан примерно на 350-370 слов.
- Финальный ролик должен быть **не длиннее 3:00**, поэтому Vault/Black Hole/Quests/Arena идут коротким montage, а главный экран, Sybil Hunt и League получают больше времени.

## 6. Перед записью

### Подготовить state

1. Один кошелек с minted ID / holder state.
2. Баланс coins достаточный для shop/tournament демонстрации.
3. Один явно clean wallet и один suspicious/probable sybil target для Sybil Hunt.
4. В League должны быть видны:
   - free mode;
   - tournament tab;
   - entry fee;
   - leaderboard/reward rows.
5. В Shop должны быть видны:
   - доступный item;
   - locked rank item;
   - equipped item;
   - stats delta / modules.
6. В Inbox должны быть видны rewards/notifications, включая tournament/arena if seeded.
7. Vault payments не исполнять. Только открыть screen/status/buttons.

### Capture checklist

- Viewport: 390x844 или 430x932.
- Start URL: `/app?address=<demo-wallet>`.
- Запись делать без реального ввода секретов.
- Вырезать долгие loading states, но оставить короткие 0.5-1.0s transitions, чтобы продукт не выглядел смонтированным из скринов.
- Все clicks должны попадать в таймкоды ниже.
- Не показывать dev wallet strip, если он появляется.

## 7. Storyboard And Click Plan

| Time | Scene | App action | Visual goal |
| --- | --- | --- | --- |
| 0:00-0:13 | Hook | Open `/app?address=...`; card/hub entrance | Wallet becomes identity, not dashboard |
| 0:13-0:34 | Passport | Show card, score, tier, trust grade, badges | One compact identity artifact |
| 0:34-0:57 | Score and recovery | Expand score categories / trust area | One score, plus path to improve |
| 0:57-1:33 | Sybil Hunt | Open Sybil Hunt, scan target, show verdict/evidence/reward | Community anti-sybil database grows |
| 1:33-2:05 | League | Open League, show stats and one mode | Reputation becomes gameplay stats |
| 2:05-2:24 | Tournaments + Shop | Show tournament entry/pool, then equipped item/stats delta | Coins, sinks, upgrades |
| 2:24-2:43 | Arena/Quests/Vault | Fast montage, no payment execution | Retention and economy surface |
| 2:43-2:55 | Close | Return hub/card | Identity layer for Solana apps |

## 8. On-screen Callouts

Use short callouts only:

- Wallets are anonymous. Prism makes them legible.
- One score. Five signals. One path to improve.
- Trust grade, not metric soup.
- Bad wallet is not a dead end.
- Users hunt sybils. The database grows.
- Reputation becomes ship stats.
- Coins are earned, spent, and capped server-side.
- Tournaments create competition and sinks.
- A passport that other Solana apps can use.

## 9. Voiceover Script

Pace: calm, not rushed. Read with short pauses at every timecode boundary. Target: 2:50-2:58.

### 0:00-0:13

Большинство Solana-кошельков снаружи выглядят одинаково: адрес, баланс и история транзакций. Identity Prism превращает это в живой reputation passport.

### 0:13-0:34

Я открываю кошелек, и Prism собирает карточку: общий score, tier, trust grade, badges, rank и краткое досье. За несколько секунд понятно, это живой участник экосистемы, новый пользователь или подозрительный адрес.

### 0:34-0:57

Важно: это не односторонний приговор по ончейну. Даже если кошелек слабый или выглядит рискованно, пользователь может доказывать человечность делом: играть, проходить quests, улучшать trust recovery и накапливать engagement proof.

### 0:57-1:33

Sybil Hunt делает проверку коллективной. Пользователи сканируют подозрительные адреса, видят verdict, confidence, evidence и могут получить bounty, если сигнал достаточно сильный. Так база не стоит на месте: каждый hunt пополняет историю, помогает находить новые связи и улучшает качество будущих решений.

### 1:33-2:05

Дальше reputation начинает работать внутри продукта. В Prism League identity превращается в ship stats: speed, shield, firepower и luck. Это влияет на игры, rewards, XP, achievements и progression. Карточка не просто красивая - она меняет то, как пользователь проходит продукт.

### 2:05-2:24

Coins замыкают loop. Их можно заработать активностью, потратить в Shop на frames, auras, skins, titles и modules, а tournaments создают competition, entry fees, prize pools и reward sinks.

### 2:24-2:43

Вокруг этого есть Arena challenges, quests, leaderboard, notifications, Vault и Black Hole. Платежи в этом демо не исполняются, но видно, как экономика и utility слои собираются вокруг одного identity.

### 2:43-2:55

Identity Prism reads a wallet, explains it, challenges it, and gives users a way to build a better reputation over time. Это on-chain identity layer, который ощущается как продукт, а не как отчет.

## 10. Timing Notes For Final Video Assembly

- If the generated voiceover is shorter than 2:45, extend scene holds at:
  - card front/back;
  - sybil verdict;
  - shop stats delta.
- If the voiceover is longer than 3:00, cut:
  - Vault/Black Hole entirely;
  - Arena/Quests to one 6-second montage;
  - one sentence from League.
- Scene transitions should happen on sentence endings, not mid-sentence.
- Important UI moments should stay visible for at least 2.0 seconds.
- Do not cover small mobile UI with large captions. Captions go outside the phone frame in 16:9.

## 11. Final Demo Claims To Keep Honest

Safe claims:
- "on-chain reputation and identity scoring";
- "sybil verdict and hunt workflow";
- "coins, XP, ranks, shop, modules, tournaments";
- "server-authoritative reward/spend paths";
- "mobile-first Solana app".

Avoid unless freshly verified before final recording:
- exact live user counts;
- exact transaction volume;
- real payment completion;
- final token launch claims;
- "fully decentralized identity protocol" if we are showing mostly app/backend behavior.

## 12. Final Pre-Recording QA

Before recording final video:

1. Run `npx tsc --noEmit`.
2. Run `npm test`.
3. Run `npm run build`.
4. Open the demo wallet in mobile viewport.
5. Click through every scene in the storyboard.
6. Confirm Sybil Hunt returns within 10 seconds.
7. Confirm no dev wallet strip is visible.
8. Confirm no UI overlap on card, score breakdown, daily limits, shop cards, tournament rows.
9. Confirm payments are not executed during recording.
10. Confirm final voiceover duration, then retime scene holds.
