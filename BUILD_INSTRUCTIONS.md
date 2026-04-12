# Руководство по сборке Android APK (Identity Prism)

Для превращения веб-приложения (Vite/React) в Android-приложение мы будем использовать **Capacitor**.

## 1. Подготовка окружения
Убедитесь, что у вас установлены:
- **Node.js** (вы уже используете его).
- **Android Studio** (для сборки финального APK).

## 2. Установка Capacitor
Выполните команды в терминале проекта:

```bash
# Установка ядра Capacitor и CLI
npm install @capacitor/core @capacitor/cli

# Инициализация Capacitor (Имя: Identity Prism, ID: com.identityprism.app)
npx cap init "Identity Prism" com.identityprism.app --web-dir dist
```

## 3. Установка Android-платформы

```bash
# Установка пакета Android
npm install @capacitor/android

# Добавление платформы Android
npx cap add android
```

## 4. Настройка иконки приложения
У вас есть файл `phav.png`. Чтобы он стал иконкой приложения:

1. Установите инструмент для генерации ресурсов:
   ```bash
   npm install @capacitor/assets --save-dev
   ```

2. Создайте папку `assets` в корне проекта и положите туда `phav.png`:
   - Скопируйте `phav.png` в `assets/icon.png` (переименуйте в icon.png).
   - Если хотите сплэш-скрин (экран загрузки), положите ту же или другую картинку как `assets/splash.png`.

3. Сгенерируйте иконки для Android:
   ```bash
   npx capacitor-assets generate --android
   ```

*Альтернативно (вручную):*
Замените иконки в папке `android/app/src/main/res/mipmap-*` на ваши версии `phav.png`.

## 5. Сборка приложения

1. **Соберите нужную веб-версию:**
    ```bash
    # staging APK (подключается к staging.identityprism.xyz)
    npm run build:staging

    # production APK
    npm run build
    ```
    (`npm run build:staging` читает `.env.staging` и собирает staging-frontend в `dist`).

2. **Синхронизируйте с Android:**
    ```bash
    npx cap sync android
    ```
    (Это копирует актуальный `dist` в `android/app/src/main/assets/public`. Если пропустить sync, APK может собраться со старым фронтендом.)

3. **Откройте проект в Android Studio:**
   ```bash
   npx cap open android
   ```

## 6. Создание APK (в Android Studio)

1. Дождитесь индексации проекта (Gradle Sync).
2. Откройте окно **Build Variants** и выберите нужный build type:
   - **`staging`** — staging APK (`com.identityprism.app.staging`), безопасный вариант для тестов и VPS staging;
   - **`debug`** — быстрый локальный staging APK для разработки;
   - **`release`** — production APK (`com.identityprism.app`).
3. В меню выберите **Build** -> **Generate Signed Bundle / APK**.
4. Выберите **APK**.
5. Создайте новый ключ (KeyStore), если его нет (запомните пароли!).
6. Для staging выберите build type **`staging`**. Для production — **`release`**.
7. Нажмите **Create/Finish**.

Готовые файлы будут в папке `android/app/build/outputs/apk/<buildType>/`.

## 7. Проверка на Solana Phone (Mobile Wallet Adapter)
Mobile Wallet Adapter уже подключён в приложении. Проверьте так:
1. Убедитесь, что на телефоне установлен **Solana Mobile Wallet** (Seed Vault / Solana Wallet).
2. Установите APK на устройство.
3. Откройте приложение и нажмите **Connect Wallet**.
4. Должно открыться нативное приложение кошелька → подтвердите подключение.
5. Проверьте, что адрес отображается и можно выполнить минт/подпись.

⚠️ Примечание: в обычном Android браузере MWA может блокироваться, но в Android-приложении (Capacitor) работает корректно.

## 8. Signed APK из CLI (без Android Studio)
Чтобы релизный APK можно было ставить на телефон, его нужно подписать.

### 8.1. Создать keystore (один раз)
```bash
keytool -genkeypair -v -keystore identityprism.keystore -alias identityprism -keyalg RSA -keysize 2048 -validity 10000
```
Сохраните пароль и путь к файлу.

### 8.2. Подключить keystore в Gradle (рекомендуется через `gradle.properties`)
Добавьте в `android/gradle.properties`:
```
RELEASE_STORE_FILE=C:\\path\\to\\identityprism.keystore
RELEASE_STORE_PASSWORD=your_password
RELEASE_KEY_ALIAS=identityprism
RELEASE_KEY_PASSWORD=your_password
```

### 8.3. Подписанный APK
```bash
cd android
.\gradlew.bat :app:assembleStaging
```
Итоговый staging APK: `android/app/build/outputs/apk/staging/app-staging.apk`

Если нужен production APK, используйте:
```bash
cd android
.\gradlew.bat :app:assembleRelease
```
Итоговый production APK: `android/app/build/outputs/apk/release/app-release.apk`

## 9. Переменные окружения для минта

### 9.1 Клиент (Vite `.env`)
```env
# staging build (`npm run build:staging`)
VITE_HELIUS_PROXY_URL=https://staging.identityprism.xyz
VITE_APP_BASE_URL=https://staging.identityprism.xyz

# common public metadata / mint config
VITE_METADATA_BASE_URL=https://identityprism.xyz
VITE_METADATA_IMAGE_URL=https://identityprism.xyz/assets/identity-prism.png
VITE_COLLECTION_MINT=COLLECTION_MINT_ADDRESS
VITE_UPDATE_AUTHORITY=UPDATE_AUTHORITY_PUBKEY
VITE_COLLECTION_VERIFY_URL=https://identityprism.xyz
VITE_CNFT_MINT_URL=https://identityprism.xyz
```

### 9.2 Сервер (backend env)
```env
PUBLIC_BASE_URL=https://identityprism.xyz
HELIUS_API_KEYS=your_helius_key
TREASURY_ADDRESS=2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN
MINT_PRICE_SOL=0.01
COLLECTION_AUTHORITY_SECRET=[...]
CNFT_MERKLE_TREE=MERKLE_TREE_PUBKEY
CNFT_TREE_AUTHORITY_SECRET=[...]
```

`COLLECTION_AUTHORITY_SECRET` и `CNFT_TREE_AUTHORITY_SECRET` — это приватные ключи (JSON array или base64 JSON). Хранить только на сервере.

## Полезные команды для обновления
Каждый раз, когда вы меняете код сайта (React), делайте:
```bash
# staging APK
npm run build:staging
npx cap sync android
```

Для production APK:
```bash
npm run build
npx cap sync android
```
Затем снова запускайте сборку в Android Studio.
