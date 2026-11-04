# Naurok AI Extension — технічний аудит (read-only)

> **Історичний документ.** Аудит виконано до перейменування продукту на **TestCraft AI**; назва «Naurok AI» у тексті відображає стан на момент аналізу.

**Дата аналізу:** поточний стан робочої копії
**Корінь проєкту:** `D:\Downloads\naurok-ai-extension`
**Режим:** тільки читання. Жоден файл проєкту не змінено, не створено і не видалено (єдиний створений файл — цей звіт, `AUDIT-REPORT.md`).
**Версія розширення за манифестом:** `1.2.0` (`manifest.json:4`)

Позначення доказовості:
- **[ФАКТ]** — підтверджено кодом/запуском;
- **[ПРИПУЩЕННЯ]** — випливає з коду, але не перевірено в середовищі Chrome/Naurok;
- **[РУЧНА ПЕРЕВІРКА]** — потребує запуску розширення в браузері.

---

## 1. Короткий підсумок

**Що це за проєкт.** Chrome-розширення (Manifest V3) «Naurok AI — Генератор питань» (`manifest.json:2-5`), яке додає в popup чат-інтерфейс для генерації тестових питань через зовнішні AI-API (OpenAI / Gemini / Manus / Mistral) і автоматичної вставки цих питань у конструктор тестів НаУрок через Angular-scope сторінки.

**Що вже реалізовано (підтверджено кодом).**

- Popup з 4 сторінками: Чат, Історія, Питання, AI-провайдер (`popup.html:44-76`, `popup.js:349-365`).
- Читання матеріалів: `.txt` (`readTextFile`), `.pdf` (`readPdfFile`, через `lib/pdf.min.js`), зображення `.png/.jpg/.jpeg/.webp` (`readImageFileAsSource` + `compressLoadedImage`).
- 4 AI-провайдери з реальними HTTP-викликами (`background.js:539-557` → `callOpenAI`/`callGemini`/`callManus`/`callMistral`).
- Генерація питань зі структурованою схемою (JSON Schema у `background.js:32-83`), нормалізацією (`normalizeQuestion`, `background.js:1628-1700`) і валідацією індексів правильних відповідей (`normalizeCorrectIndexes`).
- Генерація навчальних ілюстрацій через **SVG**: геометрія, кути, графіки, рівняння, таблиці з пропусками, схеми з підписами (`lib/educational-images.js:314-507`, `583-636`).
- Пошук реальних фото у Wikimedia Commons і Openverse з оцінкою релевантності (`lib/educational-images.js:712-846`).
- Вставка питань у конструктор Naurok через Angular scope + events (`content.js` ↔ `injected.js`) з можливістю скасування вставки.
- Історія чатів, набори тестів (question sets), редагування наявних питань через AI-запит («заміни/перепиши/онови»).

**Поточний стан.** Це робоча, але «сира» і частково зламана збірка:

1. **.docx не працює** — `popup.html:19` підключає `lib/jszip.min.js`, якого в репозиторії **немає** (у `lib/` лише `educational-images.js`, `pdf.min.js`, `pdf.worker.min.js`). **[ФАКТ]**
2. **Зовнішні фото з Wikimedia/Openverse фактично не можуть бути прикріплені** — у service worker немає `FileReader`, який використовує `blobToDataUrl` (`background.js:1036-1050`). **[ФАКТ за кодом; відтворено в ізольованому harness]**
3. Генерація через Gemini залежить від застарілого формату `response_format` в Interactions API (див. §5). **[ПРИПУЩЕННЯ, потрібна перевірка живим ключем]**
4. У проєкті лежать мертві копії та дублікати (`popup.js.broken.bak`, `popup.html.broken.bak`, папка `naurok-ai-extension/` з порожнім `background.js`). **[ФАКТ]**
5. Автоматичні тести існують лише для модуля ілюстрацій; усе, що стосується Naurok-вставки, AI-API і зображень у запиті, не покрито. **[ФАКТ]**

**Головний висновок по скарзі «червона книга замість трикутника»:** у **поточному** коді цей конкретний сценарій не відтворюється (див. §6.4) — для трикутника викликається генерація SVG, а не пошук фото. Скарга, найімовірніше, стосується **попередньої збірки**, ніж та, що зараз у робочій копії. Водночас у поточному коді є **реальна, доведена причина**, чому зовнішні фото взагалі не потрапляють у питання (п. 2 вище), і **низка слабких місць дизайну**, які здатні дати нерелевантне зображення після їх виправлення.

---

## 2. Структура проєкту

### 2.1 Активні файли (використовуються зараз)

| Файл | Розмір | Призначення | Підтвердження |
|---|---|---|---|
| `manifest.json` | 1 577 B | MV3-манифест, права, content script, web-accessible resource | `manifest.json:1-65` |
| `popup.html` | 8 551 B | UI popup (4 сторінки, форми, підключення скриптів) | `popup.html:18-19, 386` |
| `popup.js` | 49 122 B (1 971 рядок) | Вся логіка popup: стан, читання файлів, чат, історія, набори питань, запит до background, вставка в Naurok | `popup.js:1-1971` |
| `popup.css` | 13 986 B (941 рядок) | Стилі | `popup.css:1-941` |
| `background.js` | 46 625 B (1 861 рядок) | Service worker: маршрутизація провайдерів, prompt, парсинг/нормалізація, image pipeline | `background.js:1-1861` |
| `lib/educational-images.js` | 29 676 B (895 рядків) | Чистий модуль: мова, токенізація, SVG-рендер, пошук і скоринг зображень | `lib/educational-images.js:1-895` |
| `lib/pdf.min.js`, `lib/pdf.worker.min.js` | 287 KB / 1.07 MB | PDF.js 2.16.105 | підключено в `popup.html:18`, worker у `popup.js:6-9` |
| `content.js` | 4 894 B | Content script-міст popup ↔ сторінка Naurok | `content.js:1-256` |
| `injected.js` | 35 069 B (1 923 рядки) | Скрипт у контексті сторінки: робота з Angular scope конструктора | `injected.js:1-1923` |
| `icons/*.png` | — | Іконки 16/48/128 | `manifest.json:30-34, 50-54` |
| `tests/educational-images.test.js` | 8 548 B | 13 unit-тестів для `lib/educational-images.js` | `tests/educational-images.test.js:1-303` |
| `package.json` | 352 B | npm-скрипт тесту, залежність `pdfjs-dist` | `package.json:9-18` |
| `README.md` | 7 865 B | Документація (частково розходиться з кодом) | `README.md:1-131` |

### 2.2 Мертві / дублюючі файли

| Об'єкт | Статус | Доказ |
|---|---|---|
| `popup.js.broken.bak` (49 006 B) | **Не використовується.** Старіша версія `popup.js` без підтримки Mistral (перевірено порівнянням: у бекапі немає `mistral`, у поточному `popup.js` — є). | немає жодного посилання на `*.bak` у `manifest.json`, `popup.html`, коді |
| `popup.html.broken.bak` (4 818 B) | **Не використовується.** Ідентичний за SHA-256 до `naurok-ai-extension/popup.html` (обидва `8CF568478A…`), без `contextChips`, без фільтра місяців, без Mistral. | хеші збігаються |
| `naurok-ai-extension/` (вкладена папка) | **Не використовується і небезпечна.** `background.js` = **0 байт**; `popup.js` (49 001 B) — інша (старіша) копія без Mistral; `manifest.json` у ній відсутній. | `Get-ChildItem -Recurse`, хеші |
| `node_modules/` | **Відсутній**, хоча `package.json:17` оголошує `pdfjs-dist ^2.16.105`. На роботу розширення не впливає, бо PDF.js покладено в `lib/`. | `Test-Path node_modules` → `False` |
| `.vscode/settings.json` | Порожній об'єкт `{}` (4 байти) | вміст файлу |

**Ризик конфлікту.** Якщо хтось завантажить у Chrome папку `naurok-ai-extension/naurok-ai-extension` замість кореня, розширення встановиться **без манифеста** або з порожнім service worker. README (`README.md:19`) прямо вказує «Виберіть папку `naurok-ai-extension`», що в контексті вкладеної папки з такою ж назвою є двозначним.

### 2.3 Дублювання в `popup.css`

Блок правил `.context-chips … .question-set-actions button:hover` присутній **двічі**: рядки `627-737` і `815-926`. Перевірено посимвольно: фрагменти `626-682` і `814-870` **ідентичні**. Також `.composer` визначено тричі (`287`, `739`, `939`), `.attach-btn` — двічі (`298`, `928`), `.attach-menu` — двічі (`743`, `934`). **[ФАКТ]** Функціонально не ламає (останнє правило перемагає), але це ознака неконтрольованого редагування файлу «вручну».

### 2.4 Стилістична ознака пошкодженого редагування

`popup.js` містить блоки, де з рядків зникли провідні пробіли (`popup.js:111-133`), а також ламається форматування:

```js
 els.attachBtn?.addEventListener("click", (event) => {   // popup.js:111 — без відступу
```

Це не синтаксична помилка (`node --check popup.js` → exit 0), але вказує, що файл правився автоматизовано/частково.

---

## 3. Архітектура та потік даних

### 3.1 Компоненти

```
┌──────────────────────────┐        chrome.runtime.sendMessage        ┌───────────────────────────────┐
│  popup.html + popup.js   │ ───────────────────────────────────────► │  background.js (service worker)│
│  (UI, читання файлів,    │ ◄─────────────────────────────────────── │  • normalizeProviderConfig     │
│   стан у chrome.storage) │        { title, questions[] }            │  • buildPrompt                 │
└───────────┬──────────────┘                                          │  • callOpenAI/Gemini/Manus/    │
            │                                                          │    Mistral                     │
            │ chrome.tabs.sendMessage(tabId, {insertQuestions})        │  • resolveQuestionImages ──┐   │
            ▼                                                          └────────────────────────────┼───┘
┌──────────────────────────┐    CustomEvent "naurok-ai-insert"                                     │
│  content.js (naurok.com.ua/test/builder/*)  │ ──────────────────────────────┐                    │
│  • injectScript() → injected.js             │                               ▼                    ▼
│  • runPageOperation(...) з timeout          │                    ┌────────────────────────────────────────┐
└───────────▲─────────────────────────────────┘                    │ lib/educational-images.js (importScripts)│
            │ CustomEvent "naurok-ai-insert-result"                │ • inferImageKind, SVG-рендер            │
            │                                                      │ • findRelevantPhoto (Wikimedia/Openverse)│
┌───────────┴─────────────────────────────────┐                    └────────────────────────────────────────┘
│  injected.js (контекст сторінки)            │
│  • getBuilderContext() → Angular scope      │
│  • builder.newQuestion() / createQuestion() │
│  • rollbackInsertion() (скасування)         │
└──────────────────────────────────────────────┘
```

Ключові факти:
- `content.js` інжектує `injected.js` через `<script src=chrome.runtime.getURL("injected.js")>` (`content.js:15-56`) — це дозволено лише тому, що `injected.js` оголошено у `web_accessible_resources` (`manifest.json:55-64`). **[ФАКТ]**
- Обмін popup ↔ background: `chrome.runtime.sendMessage` з `return true` у listener'ах (`background.js:102-138`) і обробкою в `popup.js:1381-1391` (генерація) та `popup.js:460-463` (тест провайдера). **[ФАКТ]**
- Обмін popup ↔ сторінка: `chrome.tabs.sendMessage` (`popup.js:1619-1646`) → `content.js:58-149` → `CustomEvent` → `injected.js:25-235`. **[ФАКТ]**
- `background.js` **не** має `chrome.tabs.*` і не спілкується зі сторінкою напряму — уся інтеграція з Naurok ізольована у `content.js`+`injected.js`. **[ФАКТ]**

### 3.2 Потік генерації питання (фактичний)

1. Користувач додає файли (`popup.js:972-1036`) → `extractContentFromFile` (`popup.js:1038-1054`) → текст у `item.text`, зображення у `item.images`.
2. Користувач пише запит і тисне «Надіслати» (`popup.js:146` → `handleSend`, `popup.js:1235`).
3. `handleSend` формує `material` з `chat.files[].text` (`popup.js:1327-1332`), `currentQuestions` з прикріплених наборів (`popup.js:1334-1344`), визначає `questionCount` регулярками (`detectQuestionCount`, `popup.js:1834-1861`), `sourceImages` (`collectSourceImages`, `popup.js:1781-1801`) і `useImageInputs` (евристика по словах «фото/картин/схем…», `popup.js:1803-1822`).
4. Виклик `generateQuestions` у background (`background.js:201-302`): нормалізація конфігу, обрізання матеріалу до 24 000 символів (`background.js:236-242`), `buildPrompt` (`background.js:398-522`), `callProvider`.
5. Відповідь AI → `parseJsonObject` (`background.js:1574-1612`) → `resolveQuestionImages` (`background.js:806-928`) → `normalizeQuestions` (`background.js:1614-1626`).
6. Popup зберігає набір питань у `chrome.storage.local` (`popup.js:335-340`) і показує його на сторінці «Питання» (`popup.js:762-911`).
7. «Вставити в НаУрок» (`insertCurrentQuestions`, `popup.js:1470-1554`) → `content.js` → `injected.js` → Angular builder.

**Тайм-аути.** Popup не має тайм-ауту на `sendMessage` генерації — очікування триває, поки background не відповість (`popup.js:1381`). Для вставки тайм-аут є: `max(60 с, N*15 с + 30 с)` (`content.js:89-98`), тобто 30 питань → 8 хвилин. **[ФАКТ]** Обмеження: MV3 service worker і popup можуть бути вивантажені значно раніше; на 30 питань це ризиковано. **[ПРИПУЩЕННЯ]**

---

## 4. Реалізовані функції

| Функція | Статус | Файли / функції | Доказ | Примітки |
|---|---|---|---|---|
| Чат-UI з історією | Реалізовано | `popup.js:494-530, 661-751` | код | Історія в `chrome.storage.local`, фільтр за місяцем |
| Набори тестів (question sets) | Реалізовано | `popup.js:291-333, 762-931` | код | Міграція зі старого формату `chat.questions` (`popup.js:225-234`) |
| Читання `.txt` | Реалізовано | `readTextFile`, `popup.js:1080-1094` | код | |
| Читання `.pdf` (текст) | Реалізовано | `readPdfFile`, `popup.js:1096-1119` | код | Тільки текст; **зображення з PDF не витягуються** |
| Читання `.docx` | **Зламано** | `readDocxFile`, `popup.js:1121-1137` | `popup.html:19` вантажить відсутній `lib/jszip.min.js` | У `lib/` файлу немає → `typeof JSZip === "undefined"` → помилка |
| Читання `.doc` | Не підтримується (задекларовано) | `popup.js:1071-1075` | код | Кидає зрозумілу помилку |
| Читання зображень-файлів | Реалізовано | `readImageFileAsSource`, `compressLoadedImage`, `popup.js:1164-1233` | код | Стиснення до 900 px, JPEG q=0.82 |
| Витяг зображень із PDF/DOCX | **Відсутньо** | — | немає викликів `render`/`getOperatorList` у PDF-шляху | README (`README.md:38`) обіцяє «зображення з матеріалів» |
| Виклик OpenAI | Реалізовано | `callOpenAI`, `background.js:579-645` | код | `response_format: json_object` |
| Виклик Gemini | Реалізовано, з ризиком | `callGemini`, `background.js:712-804` | код + офіційна документація | Формат `response_format` застарів (див. §5) |
| Виклик Manus | Реалізовано | `callManus`, `createManusTask`, `pollManusResult`, `background.js:1052-1302` | код | Асинхронний polling 180 с |
| Виклик Mistral | Реалізовано | `callMistral`, `background.js:647-710` | код | Лише в актуальному `popup.js` |
| Тест провайдера | Реалізовано | `testProvider`, `background.js:166-199`; `testProviderSettings`, `popup.js:449-473` | код | |
| Визначення мови питань | Реалізовано (груба евристика) | `detectQuestionLanguage`, `lib/educational-images.js:115-121` | код + тест | Співвідношення літер кирилиця/латиниця |
| SVG-ілюстрації: трикутники/кути/графіки/рівняння | Реалізовано | `renderGeometrySvg`, `renderGraphSvg`, `renderEquationSvg`, `lib/educational-images.js:314-446` | код + 3 тести | |
| SVG-таблиці з пропусками | Реалізовано | `renderTableSvg`, `lib/educational-images.js:448-483` | код + тест | Порожні клітинки `""`, `___`, `…` |
| SVG-схеми з підписами (labeling) | Реалізовано | `renderLabelingSvg`, `lib/educational-images.js:485-507` | код + тест | **Малює завжди одну й ту саму заглушку-еліпс** (див. §6.5) |
| Растеризація SVG → PNG | Реалізовано з fallback | `rasterizeIllustration`, `background.js:930-973` | код | Fallback віддає сам SVG data-URL |
| Пошук фото у Wikimedia Commons | Реалізовано | `searchWikimediaCommons`, `lib/educational-images.js:712-777` | код + mock-тест | `srnamespace=6`, `iiurlwidth=1200` |
| Пошук фото в Openverse | Реалізовано | `searchOpenverse`, `lib/educational-images.js:779-807` | код + mock-тест | `page_size=8`, `mature=false` |
| Скоринг релевантності фото | Реалізовано | `scoreCandidateRelevance`, `isRelevantCandidate`, `lib/educational-images.js:638-690` | код + 3 тести | Поріг `MIN_RELEVANCE_SCORE = 0.34` |
| Завантаження фото в питання | **Зламано у SW** | `downloadExternalImage` + `blobToDataUrl`, `background.js:975-1050` | відтворено в harness | `FileReader` недоступний у service worker |
| Вставка питань у Naurok | Реалізовано | `insertCurrentQuestions` → `content.js:73-112` → `injected.js:25-149`, `createQuestion`, `injected.js:237-476` | код | Залежить від Angular-scope |
| Скасування вставки (undo) | Реалізовано | `rollbackInsertion`, `injected.js:1050-1203`; `cancelLastInsertion`, `popup.js:1556-1617` | код | Крихкий пошук кнопок видалення |
| Один / кілька правильних | Реалізовано | `injected.js:399-441`; `normalizeQuestion`, `background.js:1651-1659` | код | multiquiz → `option.correct = 1` |
| Редагування питань через AI | Реалізовано | `buildPrompt` «Правила редагування», `background.js:434-442`; `shouldReplaceAttachedSet`, `popup.js:1730-1756` | код | Ключові слова («заміни», «перепиши»…) |
| Перевірка правильності фактів/відповідностей предмету | **Відсутньо** | — | у коді немає жодної перевірки змісту відповідей | Див. §8 |
| Витяг зображень із завантажених PDF | **Відсутньо** | `readPdfFile` читає лише `getTextContent()` | `popup.js:1109-1116` | |
| Вибір типу питань у UI | **Відсутньо** | `questionTypes: "all"` жорстко зашито | `popup.js:1387` | README (`README.md:8`) обіцяє вибір типів |
| Вибір класу/предмету структуровано | **Відсутньо** | клас/предмет передаються лише як вільний текст prompt | `background.js:484-491` | |

---

## 5. AI-провайдери

Дані з `background.js:8-25` (дефолти), `popup.js:18-35` (ті самі дефолти, дубльовані) та функцій виклику.

| Провайдер | Endpoint | Авторизація | Модель за замовчуванням | Формат запиту | Формат відповіді | Зображення на вхід | Обробка помилок |
|---|---|---|---|---|---|---|---|
| **OpenAI** | `POST {baseUrl}/v1/chat/completions` (`makeChatCompletionsUrl`, `background.js:559-577`) | `Authorization: Bearer <key>` (`background.js:613`) | `gpt-4o-mini` | `messages[system,user]`, `temperature 0.2`, `max_tokens 6000`, `response_format: json_object` (`background.js:617-634`) | `choices[0].message.content` → `parseJsonObject` | Так, `image_url` з data-URL, `detail: "low"` (`background.js:591-608`) | `readJson` → текст помилки провайдера (`background.js:1541-1572`) |
| **Gemini** | `POST https://generativelanguage.googleapis.com/v1beta/interactions` (`background.js:755-757`) | заголовок `x-goog-api-key` (`background.js:760`) | `gemini-3.6-flash` | `model`, `input` (рядок або масив text/image), `store:false`, `generation_config.max_output_tokens:6000`, `response_format:{type:"text",mime_type:"application/json",schema}` (`background.js:764-776`) | `steps[type=="model_output"].content[type=="text"].text` (`background.js:782-792`) | Так, `{type:"image", mime_type, data:base64}` (`background.js:748-752`) | Повідомлення включає HTTP-статус (`readJson(..., true)`) |
| **Manus** | `POST {baseUrl}/v2/task.create`, `GET {baseUrl}/v2/task.listMessages` (`background.js:1115, 1244-1247`) | заголовок `x-manus-api-key` (`background.js:1120, 1253`) | `manus-1.6-lite` (як `agent_profile`, `background.js:1103`) | `title`, `agent_profile`, `message.content`, `structured_output_schema` | Пошук `structured_output_result` → fallback на JSON у тексті асистента (`background.js:1379-1427`) | Так, через `POST /v2/file.upload` + `PUT upload_url` (`background.js:1161-1234`) | Розширений парсинг помилок, grace-період «task not found» 60 с (`background.js:1266-1271`) |
| **Mistral** | `POST {baseUrl}/v1/chat/completions` | `Authorization: Bearer <key>` (`background.js:678`) | `mistral-small-latest` | ті самі параметри, що в OpenAI | `choices[0].message.content` | Так, `image_url` (без `detail`) (`background.js:669-672`) | `readJson` |

### 5.1 Що перевірено зовнішніми джерелами

- Endpoint `POST https://generativelanguage.googleapis.com/v1beta/interactions` — **існує і є рекомендованим** для Gemini: [Gemini Interactions API](https://ai.google.dev/api/interactions-api). **[ФАКТ, зовнішнє джерело]**
- Форма відповіді `steps[].content[]` з `type: "model_output"` — **відповідає** офіційній документації (новий steps-схема з травня 2026). Отже `callGemini` парсить правильно. **[ФАКТ, зовнішнє джерело]**
- Модель `gemini-3.6-flash` — **присутня** в офіційному списку `ModelOption` (описана як «попереднє покоління Flash»); актуальніша на сьогодні — `gemini-3.8-flash`. **[ФАКТ, зовнішнє джерело]**
- **Ризик:** офіційний [гайд міграції (травень 2026)](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026) прямо вказує, що новий поліморфний `response_format` **замінює всі контролі формату й видаляє `response_mime_type`**. Код надсилає `response_format: { type: "text", mime_type: "application/json", schema }`. Якщо поле `mime_type` всередині об'єкта прибрали або перейменували, Gemini повертатиме 400 і всі запити до Gemini падатимуть. **[ПРИПУЩЕННЯ — обов'язково перевірити живим ключем; у доступній мені специфікації `ResponseFormat` не розкрито]**
- Легасі-схему (`outputs`) буде видалено 8 червня 2026; код **не** використовує `outputs` — це плюс.

### 5.2 Обробка помилок, rate limits, недоступні моделі

- **[ФАКТ]** HTTP-помилки провайдерів перетворюються на людські повідомлення у `readJson` (`background.js:1552-1565`) і повертаються в popup як `{error}`.
- **[ФАКТ]** Rate limit (429) спеціально не обробляється: немає retry, немає backoff, немає розпізнавання 429. Користувач побачить текст помилки API і має повторити вручну.
- **[ФАКТ]** Недоступна/перейменована модель дає ту саму загальну помилку провайдера; окремої підказки «модель недоступна» немає.
- **[ФАКТ]** Timeout на `fetch` **відсутній** у всіх провайдерів. Єдиний ліміт часу — 180 с polling у Manus (`background.js:1238`).
- **[ФАКТ]** Валідації, що AI повернув коректну структуру, є (`background.js:275-291`), але перевірки **змістовної правильності** немає.

### 5.3 Зберігання конфігу та ризики витоку секретів

- **[ФАКТ]** Ключ зберігається у `chrome.storage.local` під `providerConfig.apiKey` (`popup.js:431-447`, `background.js:87-100`).
- **[ФАКТ]** `chrome.storage.local` **не шифрується**; будь-який процес з доступом до профілю Chrome або інше розширення з правом `storage` (за певних умов) може його прочитати. Це не «локально і безпечно» у сильному сенсі, як формулює README (`README.md:113`).
- **[ФАКТ]** Ключ **не** потрапляє в `content.js`/`injected.js`: перевірено `grep` по `apiKey|api_key|Authorization|Bearer|sk-` у `content.js` та `injected.js` — **збігів немає**. Це добра архітектурна властивість.
- **[ФАКТ]** Ключ не логується: `console.error` виводить лише `Error`-об'єкти, не конфіг. Виняток — `console.log("[Manus] create response without task_id:", parsed.data)` (`background.js:1149`), який виводить **тіло відповіді Manus**; ключа там бути не повинно, але це логування сирих даних у консоль service worker.
- **[ФАКТ]** `host_permissions` включають `https://*.amazonaws.com/*`, `https://*.storage.googleapis.com/*`, `https://api.mistral.ai/*` (`manifest.json:12-27`). Перші два — надширокі (будь-який S3-бакет), хоча фактичний завантажувач зображень обмежений вузьким allowlist'ом (`allowedImageUrl`, `lib/educational-images.js:692-710`: лише `upload.wikimedia.org`, `*.wikimedia.org`, `api.openverse.org`, `*.staticflickr.com`) і використовує `https:`. Це **надлишкові дозволи**, які варто звузити. **[ФАКТ]**
- **[ФАКТ]** Ключів/токенів у репозиторії не знайдено (перевірено `grep` по всіх `.js/.json/.html/.bak`). Секретів немає.

### 5.4 Дублювання логіки провайдерів

- Дефолти провайдерів оголошені **двічі**: `popup.js:18-35` і `background.js:8-25`. При зміні одного місця друге розсинхронізується. **[ФАКТ]**
- `makeFallbackTestTitle` (`popup.js:1863-1882`) і `normalizeGeneratedTitle` (`background.js:1825-1855`) — практично однаковий код формування заголовка. **[ФАКТ]**
- Формування URL для OpenAI і Mistral — спільна функція `makeChatCompletionsUrl`, а от тіла запитів продубльовані майже повністю (`background.js:579-645` vs `647-710`). **[ФАКТ]**

---

## 6. Аналіз системи зображень

### 6.1 Повний pipeline (12 кроків з ТЗ)

| # | Крок | Де реалізовано | Стан |
|---|---|---|---|
| 1 | AI вирішує, чи потрібне зображення | prompt `Правила зображень` (`background.js:458-469`), поля `needsImage`, `imageKind` у схемі (`background.js:44-45`); локальний перегляд — `Images.inferImageKind` (`lib/educational-images.js:212-247`) | **[ФАКТ]** Працює, але останнє слово за локальною евристикою, а не за AI |
| 2 | Генерація пошукового запиту | AI → `imageSearchQuery` (мова питання) + `imageSearchQueryEn` (англійська); локально `buildSearchQueries` (`lib/educational-images.js:178-204`) | **[ФАКТ]** |
| 3 | Джерела | Wikimedia Commons (`commons.wikimedia.org/w/api.php`) і Openverse (`api.openverse.org/v1/images/`) | **[ФАКТ]** Flickr/S3/Google Storage — лише в дозволах, у коді не використовуються як джерела |
| 4 | Вибір результату | `findRelevantPhoto`: обидва джерела разом → `scoreCandidateRelevance` → фільтр `isRelevantCandidate` → сортування за score → `allowedImageUrl` (`lib/educational-images.js:809-846`) | **[ФАКТ]** |
| 5 | Перевірка відповідності змісту | Лише **лексичний збіг токенів** заголовка/опису/тегів кандидата із запитом; поріг 0.34; чорний список `REJECT_HINTS` (logo, flag, poster…) | **[ФАКТ]** Жодної семантичної/візуальної перевірки (немає vision-verify кроку) |
| 6 | Завантаження/конвертація/збереження | `downloadExternalImage` (`background.js:975-1034`) → `blobToDataUrl` (`background.js:1036-1050`) → data-URL у пам'яті, далі в `chrome.storage.local` разом із питанням | **ЗЛАМАНО**: `FileReader` відсутній у service worker → виняток → `catch` у `resolveQuestionImages` (`background.js:918-921`) обнуляє `imageSourceId` |
| 7 | Прив'язка до питання | `imageSourceId` → пошук у пулі `resolvedImages` → `normalizeQuestion` кладе `image` (data-URL) і `imageMeta` (`background.js:1661-1699`) | **[ФАКТ]** |
| 8 | Передача в Naurok | `question.image` (рядок data-URL) → `popup.js:1512-1515` → `content.js` → `injected.js:302-313` присвоює `builderQuestion.image = question.image` | **[ФАКТ для передачі]**, **[РУЧНА ПЕРЕВІРКА]** чи Naurok здатен зберегти такий data-URL на сервері |
| 9 | Якщо не знайдено / URL недоступний / формат не підтримано | `imageSourceId = ""`, `needsImage` лишається зі схеми; у `popup.js:884-889` питання просто рендериться без картинки | **[ФАКТ]** Помилка ковтається, користувач не отримує жодного повідомлення, що зображення не додано |
| 10 | Обмеження | `MAX_EXTERNAL_IMAGES = 5`, `MAX_GENERATED_IMAGES = 8`, `MAX_EXTERNAL_IMAGE_BYTES = 8 MB`, `MAX_SOURCE_IMAGES = 8` (`background.js:27-30`); MIME з `Content-Type`, обов'язково `image/*` (`background.js:1000-1009`); `answers.slice(0, 8)` (`background.js:1667`) | **[ФАКТ]** |
| 11 | Debug-режим / тестові запити / примусове додавання | **Не знайдено під час аналізу.** Немає ні прапорців, ні окремої кнопки «додати зображення примусово» | **Відсутнє** |
| 12 | Чи можуть тестові налаштування вплинути на звичайну генерацію | Ні — тестових налаштувань не існує. Але є протилежний ризик: евристика `shouldUseImages` (`popup.js:1803-1822`) активується будь-яким словом «схем/карта/фото» у prompt, зокрема випадковим | **[ФАКТ]** |

### 6.2 Додаткові деталі pipeline

- **[ФАКТ]** Каталог вихідних зображень матеріалу передається AI лише як список `id + назва файлу + сторінка` (`background.js:412-422`). AI не бачить змісту картинки, якщо `useImageInputs = false`.
- **[ФАКТ]** `useImageInputs` визначає, чи підуть зображення у модель (`popup.js:1390`, `background.js:265-267`). Якщо користувач не написав слово зі списку — зображення не підуть, навіть якщо додані.
- **[ФАКТ]** `collectSourceImages` (`popup.js:1781-1801`) обмежує 8 зображеннями, але `readImageFileAsSource` (`popup.js:1178-1186`) завжди дає `id = "<fileId>_image_1"`, тому з одного файлу — максимум одне зображення (для користувацьких картинок це коректно, 1 файл = 1 картинка).
- **[ФАКТ]** `rasterizeIllustration` повертає `{dataUrl, mimeType}` навіть у fallback (`background.js:935-939`), але в гілці `catch` — `{dataUrl: illustration.dataUrl, mimeType: illustration.mimeType}` (`background.js:965-972`); обидві гілки коректні за формою.
- **[ФАКТ]** Якщо растеризація не вдалася, `normalizeQuestion` віддає в popup і в Naurok сирий `data:image/svg+xml;charset=utf-8,...`. `injected.js` присвоює це `builderQuestion.image`. Чи прийме Naurok SVG data-URL — **[РУЧНА ПЕРЕВІРКА]**.

### 6.3 Чому система може додати нерелевантне зображення (аналіз механізму)

Це **не** «пошук за текстовим запитом без перевірки» — перевірка є, але вона лексична. Конкретні механізми ризику:

1. **`needsImage: true` сам по собі перетворює питання на фото-запит.** У `inferImageKind` остання умова: `if (containsAny(text, PHOTO_HINTS) || question?.needsImage) return "photo";` (`lib/educational-images.js:242-244`). Тобто якщо AI поставив `needsImage: true`, але `imageKind: "none"` (що промпт дозволяє формально лише разом із конкретним kind, але модель може порушити), система **однаково піде шукати фото**. Перевірено запуском: `inferImageKind({imageKind:"none", needsImage:true, question:"…трикутнику…"})` → `"geometry"` (врятувала геометрія), але для не-геометричної теми це гарантований фото-пошук.
2. **AI може виставити `imageKind: "photo"` для геометрії.** Явно заданий `imageKind` перевіряється першим (`lib/educational-images.js:213-217`), і промпт-застереження «Геометрія… НЕ шукай фотографії фігур» (`background.js:461`) — це лише інструкція моделі, не код-гарантія. Перевірено запуском: при `imageKind:"photo"` + `imageSearchQueryEn:"isosceles triangle"` система **пішла в мережевий пошук** замість SVG.
3. **Переклад запиту часто не перекладає нічого.** `translateEducationalQuery` (`lib/educational-images.js:147-176`) має словник лише з ~45 слів (біологія/геометрія/історія). Для трикутника: перевірено запуском — `buildSearchQueries` для «У рівнобедреному трикутнику кути при основі 50°» дає `english: ["рівнобедреному трикутнику кути при основі"]` — тобто **український текст як англійський запит**. Якщо AI не заповнив `imageSearchQueryEn`, у Wikimedia/Openverse піде кириличний запит із непередбачуваним результатом.
4. **Поріг 0.34 — низький, скоринг лояльний до часткових збігів.** `matches` у `scoreCandidateRelevance` (`lib/educational-images.js:654`) вважає збігом і входження підрядка в обидві сторони (`item.includes(token) || token.includes(item)`). Спільне коротке слово-стовбур (напр. «книг» у «Червона книга») дає бали.
5. **Мова запиту vs мова питання.** `buildSearchQueries` формує `english` з `providedEn`, перекладу `provided` і (лише якщо мова питання англійська) `provided` (`lib/educational-images.js:186-190`). Для українського питання без `imageSearchQueryEn` англійський кошик фактично порожній і заповнюється українським текстом.
6. **Немає візуальної верифікації.** Жодного кроку «надіслати кандидата у vision-модель і спитати, чи це те, що потрібно». Це головна функціональна прогалина для якості зображень.

**Тест на «червону книгу» (виконано):** для запиту «У рівнобедреному трикутнику кути при основі 50°» з `imageKind:"photo"` та `imageSearchQueryEn:"isosceles triangle"` скоринг дав:
- `File:Isosceles triangle.svg` → **0.583, relevant = true**
- `File:Red Data Book of Ukraine.jpg` → **0.000, relevant = false**
- `File:Рослини Червоної книги України.jpg` → **0.000, relevant = false**

Тобто **наявний фільтр релевантності відсікає «червону книгу» для цього запиту**. Це важливий факт: поточна версія захищена від конкретного наведеного прикладу, але лише тому, що в запиті є слово «isosceles/triangle».

### 6.4 Розбір сценарію «трикутник → червона книга»

**Що реально відбувається у поточному коді** (відтворено запуском harness'а на `background.js` з підстановкою `importScripts`/`self`/`fetch`):

- Питання: `{ question: "У рівнобедреному трикутнику кути при основі дорівнюють 50°…", imageKind: "geometry", needsImage: true }`
- `resolveQuestionImages` → `inferImageKind` → `"geometry"` → гілка `Images.GENERATED_KINDS` (`background.js:837-872`) → `renderQuestionIllustration` → SVG → `rasterizeIllustration`.
- Результат: `imageSourceId: "generated_image_…"`, `imageSource: "generated://geometry"`, `image` = `data:image/svg+xml;charset=utf-8,%3C%3Fx…` (у середовищі без `OffscreenCanvas`), `imageMeta.alt = "Рівнобедрений трикутник із кутами при основі 50°"`.
- **Мережевий пошук фото не виконується взагалі.** Жодного звернення до Wikimedia/Openverse у цьому сценарії немає.

**Тобто в поточному коді цей баг не відтворюється.** Код не дає змоги довести, що «червона книга» була додана саме цією версією. Найімовірніші пояснення (усі — гіпотези, не встановлені факти):

- **[ГІПОТЕЗА A]** Баг походить із **попередньої збірки**, у якій або не було SVG-гілки, або не було `scoreCandidateRelevance/isRelevantCandidate`. У робочій копії лежать саме старіші копії popup (`popup.js.broken.bak`, `naurok-ai-extension/popup.js`), що підтверджує історію переробок, але **не** зберігає проміжних версій із фото-пошуком — довести неможливо.
- **[ГІПОТЕЗА B]** AI виставив `imageKind: "photo"` (порушивши інструкцію), а `imageSearchQueryEn` виявився семантично не пов'язаним із трикутником — тоді лексичний фільтр міг пропустити сторонній кандидат.
- **[ГІПОТЕЗА C]** Запит пішов у Wikimedia кирилицею (див. §6.3, п. 3) і серед кандидатів опинились сторінки зі словом-стовбуром, які пройшли поріг 0.34.
- **[ГІПОТЕЗА D]** Текст «Зображення до питання» у скарзі відповідає рядку `image.alt = question.imageAlt || "Зображення до питання"` (`popup.js:887`). У старішій копії `popup.js.broken.bak:883` цей alt був **жорстко зашитий**: `image.alt = "Зображення до питання";`. Це прямий збіг із формулюванням скарги і вказує, що **спостереження робилося на старішій збірці**. **[ФАКТ як збіг, не як доведення причини]**

**Що потрібно перевірити вручну, щоб закрити питання:**
1. Відтворити сценарій у Chrome на **поточній** збірці з ключем OpenAI або Gemini і подивитися консоль service worker на `[Naurok AI] image search error`.
2. Увімкнути логування фактичних `imageKind`, `imageSearchQuery`, `imageSearchQueryEn`, які повертає AI для цього питання (зараз такого логу немає).
3. Перевірити, чи в старій збірці, на якій спостерігалась проблема, викликався пошук фото (потрібен той самий архів/`.crx`).

**Які логи вже існують для діагностики (у поточному коді):**
- `console.error("[Naurok AI] generation error:", error)` — `background.js:109`
- `console.warn("[Naurok AI] image search error:", error)` — `background.js:919` (**єдиний слід проблеми з фото**)
- `console.warn("[Naurok AI] SVG rasterize fallback:", error)` — `background.js:966`
- `console.log("[Manus] create response without task_id:", parsed.data)` — `background.js:1149`
- `console.log("[Naurok AI] injected.js loaded")` — `content.js:39`
- `console.log("[Naurok AI] Created i/N: <текст питання>")` — `injected.js:472-475`

**Чого в логах бракує:** немає жодного логу з вибраним `imageKind`, сформованими пошуковими запитами, списком кандидатів і їх скорами, а також причини відмови від кандидата. Без цього діагностика неможлива.

**Чи можна для геометрії робити SVG, а для решти — фото?** Так, і архітектурно це **вже передбачено**: `GENERATED_KINDS = {geometry, equation, diagram, table, labeling}` (`lib/educational-images.js:23-29`) і `isRelevantCandidate` **явно забороняє** фото для kind `geometry`/`equation` (`lib/educational-images.js:676-680`). Потрібно лише посилити гарантії (див. §11, P0-2).

### 6.5 Обмеження генерації SVG (окремо)

- **[ФАКТ]** `renderLabelingSvg` малює **фіксовану заглушку** — еліпс + коло (`lib/educational-images.js:489-492`) — незалежно від предмета. Для питання «підпишіть частини рослинної клітини» це не клітина, а абстрактний овал зі стрілками. Це **некоректна навчальна ілюстрація**.
- **[ФАКТ]** `renderGeometrySvg` малює загальний трикутник за `points`/дефолтними координатами. Він **не враховує фактичних кутів** задачі: `angleLabels` просто малюються як текст біля вершини (`lib/educational-images.js:380-388`), а `inferGeometrySpec` витягує з тексту лише **перше** число з `°` і закріплює його за вершиною `A` (`lib/educational-images.js:529-534`).
- **[ФАКТ]** Для задачі про рівнобедрений трикутник із кутами при основі 50° і кутом при вершині 80° **схема не буде геометрично точною**: кут при вершині буде виглядати як дефолтний, а підпис «50°» прив'яжеться до вершини A. Питання залишиться коректним текстово, але ілюстрація буде оманливою.
- **[ФАКТ]** `equation`-режим рендерить рівняння як звичайний текст `<text>` без математичної типографіки (`lib/educational-images.js:441-446`).
- **[ФАКТ]** `renderGraphSvg` підтримує лише прямі `y = ax + b` (`lib/educational-images.js:424-436`); параболи, гіперболи, тригонометрія — відсутні.
- **[ФАКТ]** `renderTableSvg` не має підтримки об'єднаних комірок, вирівнювання по центру чи заголовків колонок окремо від рядка.

---

## 7. Інтеграція з Naurok

### 7.1 Як відбувається вставлення

1. `popup.js:1495-1501` — пошук активної вкладки `naurok.com.ua/test/builder*` (`getNaurokActiveTab`, `popup.js:1648-1662`).
2. `popup.js:1512-1515` — `chrome.tabs.sendMessage(tab.id, {action:"insertQuestions", questions})`.
3. `content.js:73-112` — `runPageOperation` з `requestId`, `CustomEvent("naurok-ai-insert")`, очікування `"naurok-ai-insert-result"`, тайм-аут, `cleanup()`.
4. `injected.js:25-149` — валідація, `captureQuestionSnapshot()`, потім для кожного питання `createQuestion(...)`.
5. `createQuestion` (`injected.js:237-476`): клік `[ng-click="builder.newQuestion()"]` → очікування 1200 мс → `getBuilderContext()` (пошук `scope.builder`, `injected.js:665-754`) → заповнення `builderQuestion.type/content/image/options` → `builder.correctRadio(i)` для `quiz` або `option.correct = 1` для `multiquiz` → `builder.createQuestion()` → `waitForQuestionSave(...)`.
6. Після всіх питань — `returnToQuestionListSafe()`, `captureQuestionSnapshot()`, `createUndoToken(...)` (`injected.js:916-1048`) → `sessionStorage.setItem("__naurok_ai_last_insertion_v7", …)`.
7. `popup.js:1523-1529` зберігає `lastInsertion` у наборі питань; кнопка стає «Вже вставлено», з'являється «Скасувати».
8. Скасування: `rollbackInsertion` (`injected.js:1050-1203`) — пошук питань за id/fingerprint/текстом, `deleteQuestionWithAngular`, fallback на UI-кнопки та `confirmDeleteDialog`.

### 7.2 DOM-селектори та організація

- **[ФАКТ]** Усі селектори **захардкоджені в тілі функцій**, окремого модуля селекторів немає.
- Основні: `[ng-click="builder.newQuestion()"]` (`injected.js:253-255`), `[ng-click="builder.createQuestion()"]` (`injected.js:619-621`), набір `[ng-click*="cancelQuestion"|"closeQuestion"|"backToQuestions"|"showQuestions"]` та `data-ng-click*`-варіанти (`injected.js:516-529`), кнопки видалення `[ng-click*='deleteQuestion']`, `.fa-trash`, `.glyphicon-trash`, `.icon-trash` (`injected.js:1440-1451`), модалки `.modal`, `[role='dialog']`, `.swal2-confirm`, `.bootbox-accept` (`injected.js:1481-1492`).
- **[ФАКТ]** Є текстові евристики українською для кнопок «назад» (`injected.js:549-556`) із чорним списком «видалити/зберегти/опублікувати/вийти» (`injected.js:558-563`) — розумний захист, але крихкий.

### 7.3 Залежність від структури сторінки та що буде при зміні DOM

- **[ФАКТ]** Робота повністю залежить від `window.angular` і наявності `scope.builder` (`injected.js:681-697`). Якщо Naurok перейде на Angular 2+/React/Vue — уся вставка перестане працювати.
- **[ФАКТ]** Якщо Naurok змінить атрибути `ng-click`, `getBuilderContext()` (`injected.js:666-679`) поверне `null`, і користувач побачить «Не вдалося отримати Angular scope конструктора» (`injected.js:271-273`). Це **єдина** діагностика такої поломки.
- **[ФАКТ]** Функції `builder.createQuestion`, `builder.correctRadio`, `builder.cancelQuestion` перевіряються на `typeof === "function"` — тобто код деградує м'яко (fallback на клік кнопки або пряме проставляння `option.correct`), це добре.
- **[ФАКТ]** **Найкрихкіше місце** — `findBestQuestionsArray` (`injected.js:1525-1631`): він рекурсивно обходить об'єкти Angular-scope до глибини 4 і шукає будь-який масив, чий ключ схожий на `questions|questionlist|testquestions` або чиї елементи «схожі на питання». Це може випадково знайти **не той** масив (наприклад, банк питань користувача) і тоді undo видалить не ті питання. **[ФАКТ як ризик]**
- **[ФАКТ]** `confirmDeleteDialog` (`injected.js:1479-1523`) шукає кнопку з текстом «видалити/так/ок/delete/yes/confirm» серед `.modal button` і подібних. Якщо такого діалогу немає або текст інший — питання не видалиться, і `rollbackInsertion` кине «Не знайдено вставлені питання для видалення…» (`injected.js:1195-1200`).

### 7.4 Перевірки успішності вставлення

- **[ФАКТ]** `waitForQuestionSave` (`injected.js:876-914`) порівнює текст у `builder.data.question.content` із вставленим; якщо за 10 с не змінився — просто виходить після `sleep(1000)` **без повідомлення про помилку**. Тобто «питання могло не зберегтися» не діагностується.
- **[ФАКТ]** `createdCount` у `injected.js:79-94` інкрементується після `await createQuestion(...)` безумовно — навіть якщо фактичного збереження не відбулося. Користувач побачить «Вставлено N питань», навіть якщо частина не створилась.
- **[ФАКТ]** Popup перевіряє наявність `undoToken` (`popup.js:1517-1521`), інакше кидає помилку — це непряма перевірка успіху.
- **[ФАКТ]** Повідомлення про помилки вставки відображаються у `status` (`popup.js:1543-1544`).

### 7.5 Передача зображень у Naurok

- **[ФАКТ]** `builderQuestion.image = question.image` де `question.image` — `data:image/...` рядок (`injected.js:302-313`).
- **[РУЧНА ПЕРЕВІРКА]** Невідомо, чи Naurok приймає data-URL у полі `image` і чи зберігає його на сервері (типово такі конструктори очікують URL із власного CDN або `{id, src}`-об'єкт). Якщо ні — зображення не з'явиться або зламає збереження питання.
- **[ФАКТ]** Для варіантів-відповідей (`answer.image`) код підтримує object-варіант (`injected.js:369-384`), але `background.js` ніколи не повертає об'єктні відповіді — `normalizeQuestion` робить усі відповіді рядками (`background.js:1635-1639`). Тобто заявлена README можливість «картинки-відповіді» (`README.md:65`) **не реалізована** в pipeline генерації. **[ФАКТ]**

---

## 8. Безпека, стабільність і якість коду

### 8.1 Секрети та приватність

| Питання | Висновок | Доказ |
|---|---|---|
| Чи є секрети у репозиторії | **Ні** | пошук по всіх файлах не дав ключів/токенів |
| Де зберігається ключ | `chrome.storage.local` без шифрування | `popup.js:442-444` |
| Чи потрапляє ключ у content script | **Ні** (добре) | `grep` по `content.js`, `injected.js` |
| Чи логуються секрети | Прямо — ні; але логуються сирі відповіді Manus | `background.js:1149` |
| Чи надсилається ключ третім сторонам | Лише цільовому провайдеру через HTTPS | `background.js:610-616, 675-681, 755-763, 1115-1123` |

### 8.2 Валідація зовнішніх даних

- **[ФАКТ, добре]** `normalizeSourceImages` перевіряє `dataUrl.startsWith("data:image/")` (`background.js:367-372`).
- **[ФАКТ, добре]** `allowedImageUrl` обмежує хости завантаження (`lib/educational-images.js:692-710`) і вимагає `https:`.
- **[ФАКТ, добре]** `downloadExternalImage` повторно перевіряє `response.url` після редіректів (`background.js:996-998`) — захист від SSRF-подібного редіректу.
- **[ФАКТ, добре]** `escapeHtml` використовується при формуванні HTML для Naurok (`injected.js:1872-1882`), `escapeXml` — для SVG (`lib/educational-images.js:266-272`).
- **[РИЗИК]** Немає обмеження на **кількість** питань/розмір JSON, який AI може повернути; `parseJsonObject` (`background.js:1574-1612`) робить `JSON.parse` сирого тексту моделі без обмеження розміру.
- **[РИЗИК]** `question.image` не перевіряється за розміром при вставці; 5 зовнішніх зображень × 8 МБ × 1.37 (base64) ≈ 55 МБ даних, які проходять через `chrome.tabs.sendMessage`. Ліміт повідомлення Chrome (≈10 МБ, не розширюється) буде перевищено. **[ПРИПУЩЕННЯ, але дуже ймовірне]**
- **[РИЗИК]** Питання з data-URL картинками зберігаються в `chrome.storage.local` разом із чатами (`saveChats`, `popup.js:335-340`). Квота `storage.local` за замовчуванням ≈10 МБ, а `unlimitedStorage` у манифесті **не** запитано (`manifest.json:6-11`). Кілька генерацій із зображеннями → `QUOTA_BYTES`-помилка. Обробки цієї помилки в коді немає. **[ФАКТ за кодом, ПРИПУЩЕННЯ за порогом]**

### 8.3 Обробка помилок та асинхронність

- **[ФАКТ]** У background усі виклики в listener'ах обгорнуті `.catch` (`background.js:104-117, 119-135`).
- **[ФАКТ]** У popup — `try/catch/finally` навколо генерації (`popup.js:1380-1467`) і вставки (`popup.js:1509-1553`).
- **[РИЗИК]** `saveChats`, `attachQuestionSetToPrompt` (`popup.js:1711`), `detachQuestionSetFromPrompt` (`popup.js:1726`) викликаються **без `await`** — необроблений rejected promise при помилці сховища. **[ФАКТ]**
- **[РИЗИК]** `initialize`/`renderAll` викликаються з асинхронних обробників без захисту від гонок: швидкі кліки по наборах тестів можуть дати неузгоджений стан. **[ПРИПУЩЕННЯ]**
- **[РИЗИК]** Немає `AbortController`/timeout для `fetch` ні в одному провайдері — зависання запиту блокує popup назавжди (`state.isProcessing` не скинеться).
- **[РИЗИК]** `waitForQuestionSave` і `sleep` у `injected.js` створюють довгі ланцюги очікування (30 питань × ~2 с ≈ 60+ с), протягом яких користувач не бачить прогресу — `dispatchProgress` (`injected.js:1780-1795`) відправляє `"naurok-ai-progress"`, але **ніхто його не слухає** (у `content.js` та `popup.js` немає `addEventListener` на цю подію). **[ФАКТ]** Тобто UI progress bar не отримує реального прогресу вставки.

### 8.4 Надмірні дозволи

- `permissions`: `storage`, `activeTab`, `tabs`, `scripting` (`manifest.json:6-11`). `activeTab` і `tabs` частково дублюють одне одного; `scripting` **не використовується** в коді (немає `chrome.scripting.*`) — надлишковий дозвіл. **[ФАКТ]**
- `host_permissions`: `https://*.amazonaws.com/*` і `https://*.storage.googleapis.com/*` — надширокі й у коді незадіяні. **[ФАКТ]**
- `web_accessible_resources` для `injected.js` обмежено `naurok.com.ua/*` (`manifest.json:61-63`) — коректно. **[ФАКТ]**

### 8.5 Продуктивність і пам'ять

- **[ФАКТ]** Весь PDF читається в `ArrayBuffer` і текст збирається в один рядок (`popup.js:1101-1118`); для 50-МБ PDF це пікове навантаження на пам'ять popup-процесу.
- **[ФАКТ]** Матеріал обрізається до 24 000 символів **у background** (`background.js:236-242`), при цьому README стверджує ~12 000 (`README.md:107`). Розходження документації та коду.
- **[ФАКТ]** `chat.files` зберігає повний текст матеріалів у `chrome.storage.local` (`popup.js:1279-1282`) — для 2×PDF це ще десятки-сотні КБ тексту в сховищі на кожен чат.
- **[ФАКТ]** `findDeleteButtonForQuestion` (`injected.js:1391-1425`) робить `querySelectorAll` по `h1,h2,h3,h4,p,span,div,td` на всій сторінці для кожного питання при скасуванні — O(N×DOM). На великих тестах це помітно повільно.
- **[ФАКТ]** `collectQuestionArrays` рекурсивно обходить scope з `WeakSet` (захист від циклів є), але без обмеження на ширину обходу.

### 8.6 Повідомлення користувачу

- **[ФАКТ]** Позитивне: помилки провайдерів, файлів, вставки формулюються українською й виводяться у `status` (`popup.js:1939-1946`).
- **[РИЗИК]** Помилка пошуку зображення **не повідомляється** користувачу взагалі — питання виглядає як таке, що не потребувало картинки.
- **[РИЗИК]** Кнопки історії підписані англійською: `Rename`, `Delete` (`popup.js:714, 726`) при тому, що весь інший UI українською.
- **[РИЗИК]** У `prompt()` для перейменування (`popup.js:715`) використовується нативний браузерний діалог — у popup Chrome він може блокуватися/поводитись непередбачувано.
- **[РИЗИК]** `alert()` для попередження про скасування (`popup.js:817`) — так само.

---

## 9. Тести

### 9.1 Що існує

`tests/educational-images.test.js` — **13 unit-тестів**, усі для `lib/educational-images.js`:

| Тест | Що перевіряє |
|---|---|
| `detects Ukrainian and English` | `detectQuestionLanguage` |
| `translates Ukrainian biology queries to English` | `translateEducationalQuery` |
| `keeps English search queries unchanged` | `translateEducationalQuery` для EN |
| `infers geometry instead of photo for triangles and angles` | `inferImageKind` |
| `infers photo for biology and history topics` | `inferImageKind` |
| `renders a right triangle SVG with matching labels` | `renderQuestionIllustration` (geometry) |
| `renders English equation as text, not a photo search` | `renderQuestionIllustration` (equation) |
| `labeling diagrams leave blanks instead of answers` | `renderQuestionIllustration` (labeling) — **не** перевіряє змістовність малюнка |
| `English table blanks stay empty` | `renderTableSvg` |
| `rejects unrelated Wikimedia titles` | `scoreCandidateRelevance` + `isRelevantCandidate` |
| `does not treat geometry questions as photo candidates` | `isRelevantCandidate` |
| `selects a relevant Openverse/Wikimedia candidate via mocked fetch` | `findRelevantPhoto` з mock-fetch |
| `returns no photo when candidates are irrelevant` | `findRelevantPhoto` з mock-fetch |

### 9.2 Що було реально запущено

| Команда | Результат |
|---|---|
| `node --test tests/educational-images.test.js` | **[exit 1]** `Error: spawn EPERM` — sandbox забороняє `node --test` спавнити дочірній процес. **Це не помилка тестів.** |
| `node tests/educational-images.test.js` (той самий файл, у процесі) | **[exit 0]** `tests 13 / pass 13 / fail 0`, тривалість ≈9.8 мс |
| `node --check background.js` | **[exit 0]** синтаксис OK |
| `node --check popup.js` | **[exit 0]** |
| `node --check content.js` | **[exit 0]** |
| `node --check injected.js` | **[exit 0]** |
| `node --check lib/educational-images.js` | **[exit 0]** |
| `node --check popup.js.broken.bak` | не виконувався — Node відмовляє за розширенням `.bak` (`ERR_UNKNOWN_FILE_EXTENSION`) |
| Ізольований harness `background.js` (тимчасовий файл у `%TEMP%`, видалено) | **[exit 0]** — відтворено шлях `resolveQuestionImages` для сценарію з трикутником; підтверджено помилку `FileReader is not defined` у гілці фото |

**Жодного разу не запускалося розширення в Chrome і не виконувалась вставка в реальний конструктор Naurok.** Твердження про працездатність інтеграції з Naurok у цьому звіті відсутні.

### 9.3 Що можна безпечно запускати надалі

- `node tests/educational-images.test.js` — безпечно, нічого не змінює.
- `node --check <файл>` — безпечно.
- `npm test` — **у цьому середовищі не спрацює** (`node --test` падає на `spawn EPERM`), потрібне інше середовище.

### 9.4 Важливі непокриті сценарії

1. **Нуль тестів** на `background.js`: `generateQuestions`, `buildPrompt`, `parseJsonObject`, `normalizeQuestion`, `normalizeCorrectIndexes`, `resolveQuestionImages`.
2. **Нуль тестів** на виклики провайдерів (немає mock-fetch для OpenAI/Gemini/Manus/Mistral).
3. **Нуль тестів** на `injected.js` і `content.js` — тобто на найризикованішу частину (DOM/Angular Naurok).
4. **Нуль тестів** на `popup.js` (читання файлів, стан, набори питань, undo-стан).
5. Не покрито: поведінка при недоступному URL зображення, перевищенні 8 МБ, не-`image/*` Content-Type, редіректі на недозволений хост.
6. Не покрито: кейс `needsImage:true` + `imageKind:"none"` (саме той, що веде до зайвого фото-пошуку).
7. Не покрито: точність геометрії SVG (кути/підписи відповідають умові задачі).
8. Не покрито: квота `chrome.storage.local`, обмеження розміру повідомлення, скасування при зміненому DOM.

---

## 10. Що вже зроблено / що не зроблено

### 10.1 Реалізовано та, за кодом, працює

- Popup-UI з 4 сторінками, історія чатів, набори тестів, фільтр за місяцем.
- Читання `.txt` і `.pdf` (текст) та файлів-зображень зі стисненням.
- 4 AI-провайдери з реальними API-викликами, structured output, нормалізація та валідація відповідей.
- Оцінка релевантності кандидатів-фото (лексична) + чорний список.
- SVG-генерація: геометрія, кути, графіки (прямі), рівняння, таблиці з пропусками, схеми з підписами.
- Вставка питань у конструктор Naurok із підтримкою quiz/multiquiz і скасуванням вставки.
- Редагування наявних питань через AI-інструкцію.
- 13 unit-тестів для модуля ілюстрацій — **усі проходять**.

### 10.2 Частково реалізовано

- **Зображення в питаннях:** пайплайн є, але зовнішні фото фактично не прикріплюються через `FileReader` у service worker. Працюють лише (а) рисунки, згенеровані як SVG, і (б) зображення, які користувач сам завантажив файлом.
- **Мультимодальність:** передача `sourceImages` у модель реалізована, але лише за наявності ключового слова в запиті (`shouldUseImages`).
- **Витяг матеріалів:** PDF — тільки текст; DOCX — зламано (немає JSZip); зображення з PDF/DOCX не витягуються.
- **Скасування вставки:** працює за умови стабільного Angular-scope і стандартного діалогу підтвердження.
- **Шаблони «схема з підписами»:** генерується заглушка-еліпс, не предметна ілюстрація.
- **Геометрія:** фігура малюється, але **не відповідає числовим умовам** задачі.
- **Мова:** визначається грубо (співвідношення кирилиці/латиниці), не передається як явний параметр користувача.
- **Типи питань:** `questionTypes` жорстко `"all"`, UI-вибору немає.

### 10.3 Відсутнє (не знайдено під час аналізу)

- Вибір класу, предмету, кількості та типів питань у UI (усе — вільний текст prompt).
- Перевірка фактичної правильності питань і відповідей; перевірка відповідності предмету/класу.
- Візуальна (vision) верифікація відповідності знайденого зображення змісту питання.
- Витяг зображень із PDF і DOCX.
- Debug-режим, тестові запити, примусове додавання зображень.
- Retry/backoff для rate limit, тайм-аути для `fetch`, обробка `QUOTA_BYTES`.
- Обробка відсутнього `lib/jszip.min.js` (немає навіть перевірки існування файлу).
- Тести для `background.js`, `popup.js`, `content.js`, `injected.js`.
- Логування вибору `imageKind`, пошукових запитів і рішень скорингу.
- Прослуховування події `"naurok-ai-progress"` у popup.

### 10.4 Невідоме (потребує ручної перевірки в браузері)

- Чи справді Gemini приймає поточний `response_format` (ризик §5.1).
- Чи працює вставка на актуальній версії конструктора Naurok (DOM/Angular).
- Чи приймає Naurok `data:image/...` у полі `image` і зберігає його.
- Реальні причини скарги про «червону книгу» на тій збірці, де вона спостерігалась.
- Поведінка `OffscreenCanvas`/`createImageBitmap` для SVG у service worker конкретної версії Chrome (у моєму harness їх не було, тому вийшов fallback на SVG data-URL).

---

## 11. Рекомендації щодо наступних кроків

### P0 — критично

**P0-1. Прибрати залежність від відсутнього `lib/jszip.min.js`.**
- *Проблема:* `.docx` гарантовано не читається (`popup.html:19`, `popup.js:1121-1124`).
- *Рішення (одне з):* додати `lib/jszip.min.js` у репозиторій; або прибрати згадку `.docx` з `accept` і з `extractTextFromFile`; або замінити на власний мінімальний парсер `word/document.xml`.
- *Файли:* `popup.html`, `popup.js`, `lib/`.
- *Критерій готовності:* завантаження `.docx` дає непорожній текст; у консолі popup немає `ERR_FILE_NOT_FOUND`; у `extractTextFromFile` немає шляху, що веде до `typeof JSZip === "undefined"`.

**P0-2. Заблокувати пошук фото для неприродничих/геометричних тем на рівні коду, а не промпту.**
- *Проблема:* `imageKind` від AI має пріоритет над локальною евристикою (`lib/educational-images.js:213-217`), тому AI може відправити геометрію в фото-пошук; `needsImage:true` без kind теж веде у фото (`lib/educational-images.js:242-244`).
- *Рішення:* у `resolveQuestionImages` **перед** гілкою фото викликати `Images.inferImageKind` та примусово переводити геометрію/рівняння в `GENERATED_KINDS`; для тем, що не мають `PHOTO_HINTS`, забороняти фото-гілку; для `needsImage:true` без явного `imageKind` — вимагати `imageSearchQueryEn` і не більше одного кандидата.
- *Файли:* `background.js` (`resolveQuestionImages`), `lib/educational-images.js` (`inferImageKind`, `isRelevantCandidate`).
- *Критерій готовності:* юніт-тест: для питання зі словом «трикутник» і `imageKind:"photo"` `resolveQuestionImages` **не** робить мережевих запитів і повертає `generated://geometry`.

**P0-3. Виправити завантаження зовнішніх зображень у service worker.**
- *Проблема:* `blobToDataUrl` використовує `FileReader` (`background.js:1036-1050`), якого немає у service worker → зовнішні фото завжди відкидаються (`background.js:918-921`). Це підтверджено запуском.
- *Рішення:* переписати конвертацію через `response.arrayBuffer()` + `btoa`/`Uint8Array` (без `FileReader`); ЗАБОРОНИТИ використання `FileReader` у `background.js`; додати перевірку наявності API на старті.
- *Файли:* `background.js`.
- *Критерій готовності:* тест із mock-fetch доводить, що `resolveQuestionImages` повертає `image` (data-URL) для кандидата з дозволеного хоста.

**P0-4. Додати діагностичне логування рішень по зображеннях і показати помилку користувачу.**
- *Проблема:* зараз єдиний слід — `console.warn` у `catch`; користувач не знає, що зображення не додано.
- *Рішення:* логувати `imageKind`, `queries.original/english`, топ-3 кандидати зі скорами, причину відмови; у `status` повідомляти «Зображення не додано (неточний збіг)».
- *Файли:* `background.js`, `lib/educational-images.js`, `popup.js`.
- *Критерій готовності:* у консолі service worker видно повний шлях рішення для кожного питання з картинкою; користувач отримує повідомлення при відмові.

### P1 — важливо

**P1-1. Усунути розходження Gemini `response_format` з актуальною схемою Interactions API.**
- *Проблема:* використовується `{type:"text", mime_type, schema}`; за гайдом міграції `response_mime_type` видалено, `response_format` став поліморфним.
- *Рішення:* звірити з актуальним `ResponseFormat`, або прибрати `response_format` і парсити текст як в OpenAI/Mistral, або додати заголовок `Api-Revision`.
- *Файли:* `background.js` (`callGemini`).
- *Критерій готовності:* реальний запит до Gemini з ключем повертає питання (скріншот/лог).

**P1-2. Інтеграційні тести для `background.js` з mock-fetch по всіх 4 провайдерах.**
- *Рішення:* окремий тест-файл із фейковими відповідями провайдерів і перевіркою `normalizeQuestions`.
- *Критерій готовності:* покриття шляхів: успіх, HTTP 400, HTTP 429, не-JSON відповідь, порожній `questions`, `correct` як літери.

**P1-3. Прибрати мертві файли й папку-двійник.**
- *Рішення:* видалити `popup.js.broken.bak`, `popup.html.broken.bak`, папку `naurok-ai-extension/`; уточнити README щодо папки для завантаження.
- *Критерій готовності:* у дереві проєкту немає `.bak` і немає другого `manifest.json`/`popup.js`.

**P1-4. Прибрати надлишкові дозволи та дозволи без використання.**
- *Рішення:* прибрати `scripting`, звузити `host_permissions` (прибрати `*.amazonaws.com`, `*.storage.googleapis.com`, якщо вони не потрібні; при потребі — конкретні бакети), обґрунтувати `tabs`.
- *Файли:* `manifest.json`.
- *Критерій готовності:* вставка й генерація працюють без прибраних дозволів.

**P1-5. Витяг зображень із PDF (і, за потреби, DOCX) або явне коригування README.**
- *Проблема:* README обіцяє «зображення з матеріалів», код витягує лише текст.
- *Рішення:* використати `page.getOperatorList()`/рендер сторінок у PDF.js; або явно описати обмеження в README.
- *Файли:* `popup.js` (`readPdfFile`), `README.md`.
- *Критерій готовності:* або PDF із рисунками дає `item.images.length > 0`, або README не обіцяє цього.

**P1-6. Точна геометрія SVG і предметні схеми замість заглушки.**
- *Проблема:* `renderGeometrySvg` не враховує числові умови; `renderLabelingSvg` малює фіксований еліпс.
- *Рішення:* обчислювати координати вершин із заданих кутів/сторін; для labeling — або реальне зображення з джерела, або явне повідомлення «схема орієнтовна».
- *Файли:* `lib/educational-images.js`.
- *Критерій готовності:* тест: для трикутника з кутами 50°/50°/80° SVG містить підписи саме цих кутів при відповідних вершинах і фігура візуально відповідає (перевірка людиною).

### P2 — бажано

**P2-1.** Один спільний модуль дефолтів провайдерів замість копій у `popup.js:18-35` і `background.js:8-25`; спільна функція формування заголовка.
**P2-2.** Дедуплікувати `popup.css` (блок `627-737` = `815-926`) і злити три визначення `.composer`.
**P2-3.** Додати `unlimitedStorage` або винести зображення з `chrome.storage.local` (наприклад, зберігати лише URL/посилання на джерело); обробляти `QUOTA_BYTES`.
**P2-4.** Додати `AbortController`/тайм-аути на всі `fetch`, retry з backoff на 429/5xx.
**P2-5.** Прокинути `"naurok-ai-progress"` у popup і показувати реальний прогрес вставки.
**P2-6.** Українізувати `Rename`/`Delete` (`popup.js:714, 726`), замінити `alert`/`prompt` на власні UI-елементи.
**P2-7.** Виправити `createdCount` в `injected.js:79-94`, щоб рахувати лише фактично збережені питання (за результатом `waitForQuestionSave`).
**P2-8.** Додати UI-вибір класу, предмету, кількості та типів питань замість парсингу вільного тексту.
**P2-9.** Розширити `TERM_TRANSLATIONS` або підключати переклад запитів через AI/словник; забороняти кириличні запити до Wikimedia, якщо мова кандидата не українська.

---

## 12. План наступного етапу

Послідовність малих етапів (кожен завершується перевірюваним результатом, без «великого рефакторингу»):

**Етап 0. Узгодження (без коду).**
Погодити відповіді на питання з розділу «Питання до узгодження» нижче. Зафіксувати, які провайдери вважаються обов'язковими (усі 4 чи OpenAI+Gemini), і який архів/`.crx` відповідає збірці, де спостерігалась «червона книга».

**Етап 1. Діагностика на живій збірці (0 змін логіки).**
Завантажити поточну збірку в Chrome, згенерувати тестове питання про трикутник, зібрати: консоль service worker, фактичні `imageKind`/`imageSearchQueryEn` від AI, поводження `OffscreenCanvas`. Результат — підтверджений або відкинутий список гіпотез §6.4.

**Етап 2. P0-4 (логування/повідомлення).**
Найменший за обсягом, дає дані для решти робіт. Результат: у консолі видно повний шлях рішення по кожному зображенню.

**Етап 3. P0-1 (JSZip).**
Або додати бібліотеку, або прибрати `.docx` з підтримки. Результат: немає «мертвої» функції в UI.

**Етап 4. P0-3 (конвертація blob → data-URL без `FileReader`).**
Результат: юніт-тест доводить, що зовнішнє зображення прикріплюється; у логах з'являється `web_image_...`.

**Етап 5. P0-2 (заборона фото для геометрії на рівні коду).**
Результат: юніт-тест на «трикутник + imageKind=photo» не робить мережевих запитів.

**Етап 6. P1-1 (Gemini) + P1-2 (інтеграційні тести).**
Результат: реальний успішний запит до Gemini + тести з mock-fetch для 4 провайдерів.

**Етап 7. P1-6 (точність SVG) і P1-5 (зображення з PDF).**
Результат: геометрія відповідає числовим умовам; або PDF дає зображення, або README виправлено.

**Етап 8. P1-3, P1-4, P2-* (чистота, дозволи, UX).**
Результат: немає `.bak`/папки-двійника, дозволи звужені, прогрес вставки видно в UI.

**Рішення, які треба погодити перед початком змін:**
1. Доля `.docx`: підтримувати (додаємо JSZip) чи прибрати?
2. Доля 4-го провайдера (Mistral) і Manus: чи залишаються обидва?
3. Чи дозволено зберігати зображення в `chrome.storage.local` (квота), чи переходимо на збереження лише посилань на джерело?
4. Чи потрібна вимога «зображення обов'язково має бути візуально верифіковане» (це вимагає vision-виклику і збільшує вартість)?
5. Для геометрії: чи достатньо SVG-схеми, чи потрібні ще й реальні зображення фігур?
6. Чи можна змінювати контракт повідомлень popup↔background↔injected (для додавання прогресу й метаданих зображень)?
7. Чи потрібна сумісність зі старим форматом збереженого стану (`chat.questions` без `questionSets`)?

---

## Питання до узгодження перед наступним етапом

1. **Яка саме збірка дала баг із «червоною книгою»?** Чи є `.crx`/архів/скріншот консолі саме тієї версії? У коді, що зараз у робочій копії, цей сценарій не відтворюється.
2. **Чи підтверджено, що генерація взагалі працює** з хоча б одним провайдером на поточній збірці (OpenAI / Gemini / Manus / Mistral) — і з яким саме?
3. **Gemini:** чи є можливість перевірити один реальний запит, щоб визначити, чи не ламає `response_format` з `mime_type` нову схему Interactions API?
4. **`.docx`:** додаємо JSZip у репозиторій чи прибираємо підтримку з UI?
5. **Зображення в Naurok:** чи відомо, що конструктор приймає `data:image/...` у полі `image`? Якщо ні — хто і як це перевірить?
6. **Пріоритет зображень:** що важливіше зараз — (а) щоб зовнішні фото взагалі прикріплювались, (б) щоб вони були релевантні, чи (в) щоб геометрія була точною?
7. **Чи потрібна візуальна верифікація зображень** (окремий vision-запит до моделі)? Це впливає на вартість і час генерації.
8. **Сховище:** залишаємо data-URL зображень у `chrome.storage.local` (ризик квоти 10 МБ) чи переходимо на збереження лише URL джерела?
9. **Мертві файли:** чи можна видалити `popup.js.broken.bak`, `popup.html.broken.bak` і папку `naurok-ai-extension/`, чи вони потрібні як історія?
10. **Обсяг тестів:** чи є вимога покрити тестами `injected.js`/`content.js` (це потребує jsdom або e2e-підходу), чи достатньо юніт-тестів для `background.js` і `lib/`?

---

### Додаток: перелік перевірених фактів про середовище

- Node.js у середовищі: `v24.21.0`.
- `node_modules` відсутній; `npm install` **не виконувався**.
- Git-репозиторій у проєкті **відсутній** (`fatal: not a git repository`) — історію змін відновити неможливо.
- Усі команди, що виконувались: `Get-ChildItem`, `Get-FileHash`, `Get-Content`, `Select-String`, `node --check`, `node tests/educational-images.test.js`, `node --test tests/educational-images.test.js`, ізольований Node-harness у `%TEMP%` (тимчасовий файл видалено). Файли проєкту не змінювались.
