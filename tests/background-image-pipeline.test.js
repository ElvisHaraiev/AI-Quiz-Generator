// Тести image pipeline у background.js.
//
// background.js завантажується в ізольований контекст через new Function,
// щоб не залежати від Chrome API. Мережа завжди підмінюється mock-fetch.
// Реальний API-ключ не потрібен.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BACKGROUND_PATH = path.join(PROJECT_ROOT, "background.js");
const Images = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));
const Material = require(path.join(PROJECT_ROOT, "lib", "material.js"));

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BYTES_BASE64 = "iVBORw0KGgo=";

function loadBackground() {
  const source = fs.readFileSync(BACKGROUND_PATH, "utf8");

  const sandbox = {
    importScripts: () => {},
    self: { QuizGenImages: Images, QuizGenMaterial: Material },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} }
      },
      storage: {
        local: {
          get() {
            return Promise.resolve({});
          },
          set() {
            return Promise.resolve();
          }
        }
      }
    },
    console,
    URL,
    URLSearchParams,
    Blob,
    atob,
    btoa,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    globalThis
  };

  const names = Object.keys(sandbox);
  const body = `${source}\n;return globalThis.__QuizGenTestHooks;`;

  const hooks = new Function(...names, body)(
    ...names.map((name) => sandbox[name])
  );

  if (!hooks?.blobToDataUrl) {
    throw new Error(
      "Не вдалося завантажити тестові хуки з background.js (__QuizGenTestHooks)."
    );
  }

  hooks.setImageDebugEnabled(false);

  return hooks;
}

const Hooks = loadBackground();

function asciiToBytes(text) {
  return new Uint8Array(
    Array.from(text).map((character) => character.charCodeAt(0))
  );
}

function makeImageResponse(bytes, url, contentType = "image/png") {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? contentType
          : null;
      }
    },
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
    },
    async blob() {
      return new Blob([bytes], { type: contentType });
    },
    async json() {
      return {};
    }
  };
}

function makeJsonResponse(data) {
  return {
    ok: true,
    status: 200,
    url: "https://api.example/",
    headers: { get: () => "application/json" },
    async json() {
      return data;
    },
    async text() {
      return JSON.stringify(data);
    }
  };
}

// Той самий формат відповідей, який очікують searchWikimediaCommons
// та searchOpenverse у lib/educational-images.js.
function makeSearchFetch({ titles = [], openverse = [], events }) {
  return async function fetchImpl(url) {
    const href = String(url);

    events.push(href);

    if (href.includes("commons.wikimedia.org") && href.includes("list=search")) {
      return makeJsonResponse({
        query: {
          search: titles.map((title) => ({ title }))
        }
      });
    }

    if (href.includes("commons.wikimedia.org") && href.includes("prop=imageinfo")) {
      return makeJsonResponse({
        query: {
          pages: Object.fromEntries(
            titles.map((title, index) => [
              String(index + 1),
              {
                title,
                imageinfo: [
                  {
                    mime: "image/png",
                    thumburl:
                      "https://upload.wikimedia.org/wikipedia/commons/thumb/fixture.png",
                    extmetadata: {
                      ImageDescription: { value: "Diagram of a chloroplast" },
                      Categories: { value: "Chloroplasts|Plant cells" }
                    }
                  }
                ]
              }
            ])
          )
        }
      });
    }

    if (href.includes("api.openverse.org")) {
      return makeJsonResponse({ results: openverse });
    }

    if (href.startsWith("https://upload.wikimedia.org/")) {
      return makeImageResponse(new Uint8Array(PNG_BYTES), href);
    }

    throw new Error(`Unexpected fetch URL in test: ${href}`);
  };
}

const GEOMETRY_QUESTION = {
  type: "quiz",
  question:
    "У рівнобедреному трикутнику кути при основі дорівнюють 50°. Чому дорівнює кут при вершині?",
  answers: ["80°", "50°", "100°", "65°"],
  correct: [0],
  difficulty: "medium",
  // Навмисно помилковий тип від моделі — саме цей випадок спричиняв
  // пошук випадкової фотографії.
  imageKind: "photo",
  needsImage: true,
  imageSourceId: "",
  imageSearchQuery: "рівнобедрений трикутник",
  imageSearchQueryEn: "isosceles triangle",
  imageAlt: "Рівнобедрений трикутник"
};

const BIOLOGY_QUESTION = {
  type: "quiz",
  question: "Яка органела рослинної клітини відповідає за фотосинтез?",
  answers: ["хлоропласт", "ядро", "мітохондрія", "вакуоля"],
  correct: [0],
  difficulty: "medium",
  imageKind: "photo",
  needsImage: true,
  imageSourceId: "",
  imageSearchQuery: "хлоропласт",
  imageSearchQueryEn: "chloroplast diagram",
  imageAlt: "Хлоропласт"
};

// 1. Blob → data URL без FileReader
test("blobToDataUrl перетворює Blob у data URL без FileReader у Service Worker", async () => {
  const originalFileReader = globalThis.FileReader;

  // Service Worker не має FileReader — перевіряємо, що він і не потрібен.
  globalThis.FileReader = undefined;

  try {
    const blob = new Blob([asciiToBytes("PNG!")], { type: "image/png" });
    const dataUrl = await Hooks.blobToDataUrl(blob);

    assert.equal(dataUrl, "data:image/png;base64,UE5HIQ==");
    assert.equal(dataUrl.startsWith("data:image/png;base64,"), true);
    assert.equal(typeof globalThis.FileReader, "undefined");
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

test("bytesToBase64 коректно додає padding", () => {
  assert.equal(Hooks.bytesToBase64(asciiToBytes("A")), "QQ==");
  assert.equal(Hooks.bytesToBase64(asciiToBytes("AB")), "QUI=");
  assert.equal(Hooks.bytesToBase64(asciiToBytes("ABC")), "QUJD");
  assert.equal(Hooks.bytesToBase64(new Uint8Array(PNG_BYTES)), PNG_BYTES_BASE64);
  assert.equal(Hooks.bytesToBase64(new Uint8Array([])), "");
});

test("blobToDataUrl повідомляє про помилку, а не повертає порожній рядок", async () => {
  await assert.rejects(
    () => Hooks.blobToDataUrl({ type: "image/png" }),
    /arrayBuffer/
  );

  await assert.rejects(
    () => Hooks.blobToDataUrl(new Blob([], { type: "image/png" })),
    /порожнє/
  );
});

// 2. Геометрія з imageKind:"photo" не запускає мережевий пошук
test("геометричне запитання з imageKind:\"photo\" не виконує мережевий пошук фото", async () => {
  const calls = [];
  const fetchImpl = makeSearchFetch({ events: calls });

  const result = await Hooks.resolveQuestionImages(
    [{ ...GEOMETRY_QUESTION }],
    [],
    { fetchImpl }
  );

  const question = result.questions[0];

  assert.equal(calls.length, 0, "не має бути жодного мережевого запиту");
  assert.equal(question.imageKind, "geometry");
  assert.match(question.imageSourceId, /^generated_image_/);
  assert.equal(question.imageSource, "generated://geometry");
  assert.equal(question.needsImage, true);
});

test("рівняння з imageKind:\"photo\" також не запускає пошук фото", async () => {
  const calls = [];
  const fetchImpl = makeSearchFetch({ events: calls });

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Розв'яжіть рівняння 2x + 3 = 11.",
        answers: ["4", "7", "5", "3"],
        correct: [0],
        imageKind: "photo",
        needsImage: true,
        imageSearchQueryEn: "equation"
      }
    ],
    [],
    { fetchImpl }
  );

  assert.equal(calls.length, 0);
  assert.equal(result.questions[0].imageKind, "equation");
});

// 3. Геометрія отримує SVG-ілюстрацію
test("геометричне запитання отримує SVG-ілюстрацію, якщо генератор підтримує тип", async () => {
  const result = await Hooks.resolveQuestionImages(
    [{ ...GEOMETRY_QUESTION }],
    [],
    { fetchImpl: makeSearchFetch({ events: [] }) }
  );

  const question = result.questions[0];
  const image = result.sourceImages.find((item) => item.id === question.imageSourceId);

  assert.ok(image, "згенерована ілюстрація має бути в пулі зображень");
  assert.match(String(image.dataUrl), /^data:image\//);
  assert.match(String(image.dataUrl), /svg/);
  assert.equal(image.mimeType, "image/svg+xml");
  assert.equal(question.imageAlt, "Рівнобедрений трикутник");
});

test("таблиця з пропусками також генерується програмно", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Заповніть пропуски в таблиці про речовини.",
        answers: ["вода", "вуглекислий газ", "кисень", "азот"],
        correct: [0],
        imageKind: "photo",
        needsImage: true,
        diagramSpec: JSON.stringify({
          type: "table",
          headers: ["Речовина", "Формула"],
          rows: [["вода", "___"], ["кисень", "___"]]
        })
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ events: calls }) }
  );

  assert.equal(calls.length, 0);
  assert.equal(result.questions[0].imageKind, "table");
  assert.match(String(result.sourceImages[0].dataUrl), /^data:image\/svg/);
});

// 4. Біологічне запитання може отримати реальне зображення
test("біологічне запитання виконує пошук і прикріплює реальне зображення", async () => {
  const calls = [];
  const fetchImpl = makeSearchFetch({
    titles: ["File:Chloroplast-new.png"],
    events: calls
  });

  const result = await Hooks.resolveQuestionImages(
    [{ ...BIOLOGY_QUESTION }],
    [],
    { fetchImpl }
  );

  const question = result.questions[0];
  const image = result.sourceImages.find((item) => item.id === question.imageSourceId);

  assert.ok(calls.length > 0, "пошук має звернутися до мережі");
  assert.equal(question.imageKind, "photo");
  assert.match(question.imageSourceId, /^web_image_/);
  assert.ok(image, "прикріплене зображення має бути в пулі");
  assert.equal(image.dataUrl, `data:image/png;base64,${PNG_BYTES_BASE64}`);
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.sourceUrl.includes("commons.wikimedia.org"), true);
});

// 5. Невідповідний або недоступний результат не прикріплюється
test("нерелевантний кандидат не прикріплюється до запитання", async () => {
  const calls = [];
  const fetchImpl = makeSearchFetch({
    titles: ["File:Logo.png"],
    events: calls
  });

  const result = await Hooks.resolveQuestionImages(
    [{ ...BIOLOGY_QUESTION }],
    [],
    { fetchImpl }
  );

  assert.ok(calls.length > 0, "пошук має звернутися до мережі");
  assert.equal(result.questions[0].imageSourceId, "");
  assert.equal(result.sourceImages.length, 0);
});

test("нерелевантний кандидат (logo) відхиляється і зображення не додається", async () => {
  const fetchImpl = async function (url) {
    const href = String(url);

    if (href.includes("list=search")) {
      return makeJsonResponse({
        query: { search: [{ title: "File:Logo.png" }] }
      });
    }

    if (href.includes("prop=imageinfo")) {
      return makeJsonResponse({
        query: {
          pages: {
            "1": {
              title: "File:Logo.png",
              imageinfo: [
                {
                  mime: "image/png",
                  thumburl: "https://upload.wikimedia.org/wikipedia/commons/logo.png",
                  extmetadata: { ImageDescription: { value: "Company logo" } }
                }
              ]
            }
          }
        }
      });
    }

    if (href.includes("api.openverse.org")) {
      return makeJsonResponse({ results: [] });
    }

    throw new Error(`Неочікуваний URL: ${href}`);
  };

  const warnings = [];

  const result = await Hooks.resolveQuestionImages(
    [{ ...BIOLOGY_QUESTION }],
    [],
    {
      fetchImpl,
      onWarning: (message) => warnings.push(message)
    }
  );

  assert.equal(result.questions[0].imageSourceId, "");
  assert.equal(result.sourceImages.length, 0);
  assert.ok(warnings.length > 0, "користувачу має бути повідомлено про відсутнє зображення");
  assert.ok(
    warnings.some((message) => /релевантного/.test(message)),
    "причина відмови має бути вказана"
  );
});

test("зображення не додається, якщо немає надійного англійського запиту", async () => {
  const calls = [];
  const warnings = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        ...BIOLOGY_QUESTION,
        imageSearchQuery: "хлоропласт",
        imageSearchQueryEn: ""
      }
    ],
    [],
    {
      fetchImpl: makeSearchFetch({ titles: ["File:Chloroplast.png"], events: calls }),
      onWarning: (message) => warnings.push(message)
    }
  );

  assert.equal(calls.length, 0, "без англійського запиту мережа не викликається");
  assert.equal(result.questions[0].imageSourceId, "");
  assert.ok(warnings.some((message) => /пошукового запиту/.test(message)));
});

test("завантаження з недозволеного хоста відхиляється до мережевого запиту", async () => {
  let fetchCalls = 0;

  const image = await Hooks.downloadExternalImage(
    "https://evil.example.com/picture.png",
    async () => {
      fetchCalls++;
      throw new Error("мережа не має викликатися");
    },
    "image/png",
    "Evil",
    "Evil"
  );

  assert.equal(image, null);
  assert.equal(fetchCalls, 0);
});

// 6. Помилка пошуку або перетворення не ламає генерацію
test("помилка мережі під час пошуку не ламає обробку решти питань", async () => {
  const fetchImpl = async function () {
    throw new Error("network down");
  };

  const warnings = [];

  const result = await Hooks.resolveQuestionImages(
    [{ ...BIOLOGY_QUESTION }, { ...GEOMETRY_QUESTION }],
    [],
    {
      fetchImpl,
      onWarning: (message) => warnings.push(message)
    }
  );

  // Генерація не падає: геометричне питання все одно отримує ілюстрацію.
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].imageSourceId, "");
  assert.match(result.questions[1].imageSourceId, /^generated_image_/);
  assert.ok(
    warnings.some((message) => /релевантного/.test(message)),
    "користувач має дізнатися, що зображення не додано"
  );
});

test("невдача пошуку не приховується помилкою, а завершується без зображення", async () => {
  const fetchImpl = async function () {
    throw new Error("network down");
  };

  const result = await Hooks.resolveQuestionImages(
    [{ ...BIOLOGY_QUESTION }],
    [],
    { fetchImpl }
  );

  assert.equal(result.questions[0].imageSourceId, "");
  assert.equal(result.sourceImages.length, 0);
});

test("помилка перетворення Blob не приховується і потрапляє в warnings", async () => {
  const fetchImpl = makeSearchFetch({
    titles: ["File:Chloroplast-new.png"],
    events: []
  });

  // Підмінюємо arrayBuffer так, щоб перетворення впало.
  const brokenFetch = async function (url) {
    const href = String(url);

    if (href.startsWith("https://upload.wikimedia.org/")) {
      return {
        ok: true,
        status: 200,
        url: href,
        headers: { get: () => "image/png" },
        async arrayBuffer() {
          throw new Error("read failed");
        }
      };
    }

    return fetchImpl(url);
  };

  const warnings = [];

  const result = await Hooks.resolveQuestionImages(
    [{ ...BIOLOGY_QUESTION }],
    [],
    {
      fetchImpl: brokenFetch,
      onWarning: (message) => warnings.push(message)
    }
  );

  assert.equal(result.questions[0].imageSourceId, "");
  assert.ok(
    warnings.some((message) => /Помилка зображення/.test(message)),
    "помилка перетворення має бути видимою"
  );
});

test("resolveQuestionImages не кидає виняток, якщо fetchImpl відсутній, а пошук не потрібен", async () => {
  const result = await Hooks.resolveQuestionImages(
    [{ ...GEOMETRY_QUESTION }],
    []
  );

  assert.match(result.questions[0].imageSourceId, /^generated_image_/);
});

// Додатково: діагностика та захисні функції
test("detectImageIntentSafely повертає тип і причину", () => {
  const geometry = Hooks.detectImageIntentSafely({ ...GEOMETRY_QUESTION });

  assert.equal(geometry.kind, "geometry");
  assert.match(geometry.reason, /програмну ілюстрацію/);

  const biology = Hooks.detectImageIntentSafely({ ...BIOLOGY_QUESTION });

  assert.equal(biology.kind, "photo");
});

test("safeHost і truncateText не кидають винятків на некоректних даних", () => {
  assert.equal(Hooks.safeHost("not a url"), "");
  assert.equal(Hooks.safeHost(""), "");
  assert.equal(Hooks.safeHost("https://upload.wikimedia.org/a.png"), "upload.wikimedia.org");
  assert.equal(Hooks.truncateText(""), "");
  assert.equal(Hooks.truncateText("абв", 2), "аб…");
});

test("resolveQuestionImages не додає зображення для звичайного запитання", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Що таке гіперпосилання?",
        answers: ["A", "B", "C", "D"],
        correct: [0],
        needsImage: false
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ events: calls }) }
  );

  assert.equal(calls.length, 0);
  assert.equal(result.questions[0].imageKind, "none");
  assert.equal(result.questions[0].imageSourceId, "");
});

// Додаткові предметні випадки для правила «фото лише там, де доречно»
test("географічне запитання без imageKind усе одно може шукати реальне зображення", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Який океан є найбільшим на Землі?",
        answers: ["Тихий", "Атлантичний", "Індійський", "Північний Льодовитий"],
        correct: [0],
        needsImage: true,
        imageSearchQueryEn: "Pacific Ocean satellite view"
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ titles: ["File:Pacific Ocean.png"], events: calls }) }
  );

  assert.equal(result.questions[0].imageKind, "photo");
  assert.ok(calls.length > 0, "для географії пошук доречний");
});

test("запитання з літератури з помилковим imageKind:\"photo\" не шукає фото", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Хто автор поеми «Енеїда»?",
        answers: ["Котляревський", "Шевченко", "Франко", "Леся Українка"],
        correct: [0],
        needsImage: true,
        imageKind: "photo",
        // Навіть гарний англійський запит не рятує: це не візуальне питання.
        imageSearchQueryEn: "Eneida poem author",
        imageAlt: "Автор поеми"
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ titles: ["File:Ivan Kotliarevskyi.png"], events: calls }) }
  );

  assert.equal(calls.length, 0, "без ознак предмета з реальними зображеннями пошук не виконується");
  assert.equal(result.questions[0].imageKind, "none");
  assert.equal(result.questions[0].imageSourceId, "");
});

test("запитання до карти завжди отримує реальне зображення, а не схему", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Яку річку позначено на карті цифрою 1?",
        answers: ["Дніпро", "Дністер", "Дунай", "Південний Буг"],
        correct: [0],
        needsImage: true,
        // Модель помилково обрала програмну схему — карта має перемогти.
        imageKind: "labeling",
        imageSearchQuery: "карта річок України",
        imageSearchQueryEn: "map of rivers of Ukraine"
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ titles: ["File:Rivers of Ukraine.png"], events: calls }) }
  );

  assert.equal(result.questions[0].imageKind, "photo");
  assert.ok(calls.length > 0, "має бути виконаний пошук зображення карти");
});

test("лексика іноземної мови отримує зображення (це і є завдання)", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Welches Bild zeigt ein Tier?",
        answers: ["der Hund", "der Tisch", "das Buch", "der Stuhl"],
        correct: [0],
        needsImage: true,
        imageKind: "photo",
        imageSearchQueryEn: "animal photo"
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ titles: ["File:Animal.png"], events: calls }) }
  );

  assert.equal(result.questions[0].imageKind, "photo");
  assert.ok(calls.length > 0, "для лексики пошук зображення потрібен");
});

test("граматичне завдання не отримує зображення, навіть із запитом від моделі", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Wähle die richtige grammatische Form: Ich ___ müde.",
        answers: ["bin", "bist", "ist", "sind"],
        correct: [0],
        needsImage: true,
        imageKind: "photo",
        imageSearchQueryEn: "german verb conjugation"
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ titles: ["File:Grammar.png"], events: calls }) }
  );

  assert.equal(result.questions[0].imageKind, "none");
  assert.equal(calls.length, 0);
});

test("історичне запитання з imageKind:\"photo\" зберігає пошук реального зображення", async () => {
  const calls = [];

  const result = await Hooks.resolveQuestionImages(
    [
      {
        type: "quiz",
        question: "Який замок зображено на фотографії?",
        answers: ["Кам'янець-Подільський", "Луцький", "Хотинський", "Мукачівський"],
        correct: [0],
        needsImage: true,
        imageKind: "photo",
        imageSearchQueryEn: "Kamianets Podilskyi castle"
      }
    ],
    [],
    { fetchImpl: makeSearchFetch({ titles: ["File:Kamianets castle.png"], events: calls }) }
  );

  assert.equal(result.questions[0].imageKind, "photo");
  assert.ok(calls.length > 0, "для історії пошук доречний");
});

// Інтеграційний тест: повний шлях generateQuestions із підміненим мережевим шаром.
test("generateQuestions проходить повний шлях і повертає imageWarnings без винятків", async () => {
  const MODEL_ANSWER = {
    title: "Тести 2 питань — Трикутники та клітина",
    questions: [
      {
        type: "quiz",
        question:
          "У рівнобедреному трикутнику кути при основі дорівнюють 50°. Чому дорівнює кут при вершині?",
        answers: ["80°", "50°", "100°", "65°"],
        correct: [0],
        difficulty: "medium",
        needsImage: true,
        // Модель помиляється з типом — раніше це запускало пошук фото.
        imageKind: "photo",
        imageSourceId: "",
        imageSearchQueryEn: "isosceles triangle",
        imageAlt: "Рівнобедрений трикутник",
        geometrySpec: "",
        diagramSpec: "",
        language: "uk"
      },
      {
        type: "quiz",
        question: "Яка органела рослинної клітини відповідає за фотосинтез?",
        answers: ["хлоропласт", "ядро", "мітохондрія", "вакуоля"],
        correct: [0],
        difficulty: "medium",
        needsImage: true,
        imageKind: "photo",
        imageSourceId: "",
        imageSearchQuery: "хлоропласт",
        imageSearchQueryEn: "chloroplast diagram",
        imageAlt: "Хлоропласт",
        geometrySpec: "",
        diagramSpec: "",
        language: "uk"
      }
    ]
  };

  const requests = [];

  const fakeFetch = async function (url) {
    const href = String(url);

    requests.push(href);

    if (href.includes("/chat/completions")) {
      return {
        ok: true,
        status: 200,
        url: href,
        headers: { get: () => "application/json" },
        async json() {
          return {
            choices: [
              { message: { content: JSON.stringify(MODEL_ANSWER) } }
            ]
          };
        },
        async text() {
          return JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(MODEL_ANSWER) } }
            ]
          });
        }
      };
    }

    return makeSearchFetch({
      titles: ["File:Chloroplast-new.png"],
      events: []
    })(href);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;

  try {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      material: "Навчальний матеріал про трикутники та рослинну клітину.",
      prompt: "Створи 2 питання",
      questionCount: 2,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false
    });

    assert.equal(result.questions.length, 2);
    assert.ok(Array.isArray(result.imageWarnings));
    assert.match(result.title, /Трикутники та клітина/);

    const geometry = result.questions[0];
    const biology = result.questions[1];

    // Геометрія: згенерована ілюстрація, жодного пошуку фото.
    assert.equal(geometry.imageKind, "geometry");
    assert.match(String(geometry.image), /^data:image\//);
    assert.match(String(geometry.imageSource), /^generated:\/\//);

    // Біологія: реальне зображення з дозволеного джерела.
    assert.equal(biology.imageKind, "photo");
    assert.equal(biology.image, `data:image/png;base64,${PNG_BYTES_BASE64}`);
    assert.match(String(biology.imageSource), /commons\.wikimedia\.org/);

    // Пошук фото мав статися рівно для біологічного питання.
    const searchCalls = requests.filter((href) => href.includes("list=search"));
    assert.equal(searchCalls.length, 1);
    assert.equal(result.imageWarnings.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
