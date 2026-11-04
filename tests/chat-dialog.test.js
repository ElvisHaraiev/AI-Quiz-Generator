// Тести розмовного режиму (chat_reply) та перемикача зображень.
//
// background.js завантажується в ізольований контекст через new Function,
// щоб не залежати від Chrome API. Мережа завжди підмінюється mock-fetch.
// Реальний API-ключ не потрібен.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const Images = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));
const Material = require(path.join(PROJECT_ROOT, "lib", "material.js"));

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function loadBackground() {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "background.js"), "utf8");

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
  const hooks = new Function(...names, `${source}\n;return globalThis.__QuizGenTestHooks;`)(
    ...names.map((name) => sandbox[name])
  );

  if (!hooks?.generateQuestions || !hooks?.buildPrompt) {
    throw new Error("Не вдалося завантажити тестові хуки з background.js.");
  }

  hooks.setImageDebugEnabled(false);

  return hooks;
}

const Hooks = loadBackground();

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    url: "https://api.openai.com/v1/chat/completions",
    headers: { get: () => "application/json" },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function modelResponse(aiJson) {
  return jsonResponse({
    choices: [
      { message: { content: JSON.stringify(aiJson) } }
    ]
  });
}

function imageSearchResponse(url) {
  const href = String(url);

  if (href.includes("list=search")) {
    return {
      ok: true,
      json: async () => ({ query: { search: [{ title: "File:Chloroplast-new.png" }] } })
    };
  }

  if (href.includes("prop=imageinfo")) {
    return {
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "File:Chloroplast-new.png",
              imageinfo: [
                {
                  mime: "image/png",
                  thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/fixture.png",
                  extmetadata: {
                    ImageDescription: { value: "Diagram of a chloroplast" },
                    Categories: { value: "Chloroplasts|Plant cells" }
                  }
                }
              ]
            }
          }
        }
      })
    };
  }

  if (href.includes("api.openverse.org")) {
    return { ok: true, json: async () => ({ results: [] }) };
  }

  if (href.startsWith("https://upload.wikimedia.org/")) {
    return {
      ok: true,
      status: 200,
      url: href,
      headers: { get: () => "image/png" },
      async arrayBuffer() {
        return new Uint8Array(PNG_BYTES).buffer;
      }
    };
  }

  throw new Error(`Неочікуваний URL: ${href}`);
}

const PROVIDER_CONFIG = {
  provider: "openai",
  apiKey: "test-key-not-real",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1"
};

const DIALOG_REPLY =
  "Вітаю! Із задоволенням складу тест. Підкажіть, будь ласка, предмет, клас і тему.";

const GENERATED_QUESTION = {
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
};

function withFetchStub(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;

  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

// 1. Діалоговий режим: chat_reply без питань
test("діалог: chat_reply без питань повертається як відповідь, а не помилка", async () => {
  const requests = [];

  const stub = async (url) => {
    requests.push(String(url));
    return modelResponse({
      chat_reply: DIALOG_REPLY,
      title: "",
      questions: []
    });
  };

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "",
      prompt: "Привіт",
      questionCount: 0,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.equal(result.chatReply, DIALOG_REPLY);
    assert.deepEqual(result.questions, []);
    assert.equal(result.title, "");
    assert.deepEqual(result.imageWarnings, []);
  });
});

test("діалог: порожній масив питань не викликає жодного пошуку зображень", async () => {
  const requests = [];

  const stub = async (url) => {
    requests.push(String(url));
    return modelResponse({ chat_reply: "Яку тему взяти?", title: "", questions: [] });
  };

  await withFetchStub(stub, async () => {
    await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "",
      prompt: "зроби тест",
      questionCount: 0,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });
  });

  const searchCalls = requests.filter((url) => url.includes("commons.wikimedia.org"));
  assert.equal(searchCalls.length, 0);
  assert.equal(requests.length, 1, "має бути лише один запит — до провайдера");
});

test("діалог: порожній chat_reply повертається як порожній рядок, без помилки", async () => {
  const stub = async () => modelResponse({ title: "", questions: [] });

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "",
      prompt: "щось незрозуміле",
      questionCount: 0,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.equal(result.chatReply, "");
    assert.deepEqual(result.questions, []);
  });
});

test("діалог: chat_reply разом із питаннями зберігається окремо від питань", async () => {
  const stub = async () =>
    modelResponse({
      chat_reply: "Готово, ось тест.",
      title: "Тести 1 питань — Клітина",
      questions: [{ ...GENERATED_QUESTION }]
    });

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "Рослинна клітина",
      prompt: "1 питання про клітину",
      questionCount: 1,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: false
    });

    assert.equal(result.chatReply, "Готово, ось тест.");
    assert.equal(result.questions.length, 1);
  });
});

// 2. Перемикач зображень
test("allowImages:false повністю вимикає зображення: без мережі, без SVG", async () => {
  const requests = [];

  const stub = async (url) => {
    requests.push(String(url));
    return modelResponse({
      chat_reply: "",
      title: "Тести 1 питань — Клітина",
      questions: [
        { ...GENERATED_QUESTION },
        {
          type: "quiz",
          question:
            "У рівнобедреному трикутнику кути при основі 50°. Чому дорівнює кут при вершині?",
          answers: ["80°", "50°", "100°", "65°"],
          correct: [0],
          difficulty: "medium",
          needsImage: true,
          imageKind: "photo",
          imageSourceId: "",
          imageSearchQueryEn: "isosceles triangle",
          imageAlt: "Трикутник",
          geometrySpec: "",
          diagramSpec: "",
          language: "uk"
        }
      ]
    });
  };

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "Клітина та трикутники",
      prompt: "2 питання",
      questionCount: 2,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: false
    });

    assert.equal(result.questions.length, 2);

    result.questions.forEach((question) => {
      assert.equal(question.image, null);
      assert.equal(question.imageSourceId, "");
      assert.equal(question.needsImage, false);
      assert.equal(question.imageKind, "none");
      assert.equal(question.imageSearchQueryEn, "");
      assert.equal(question.imageMeta, null);
    });

    const networkCalls = requests.filter(
      (url) => !url.includes("/chat/completions")
    );

    assert.deepEqual(networkCalls, [], "жодного мережевого запиту по зображеннях");
  });
});

test("allowImages:false блокує також ілюстрації з матеріалу", async () => {
  const stub = async () =>
    modelResponse({
      chat_reply: "",
      title: "Тести 1 питань — Клітина",
      questions: [
        {
          ...GENERATED_QUESTION,
          imageSourceId: "file_1_image_1"
        }
      ]
    });

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "Клітина",
      prompt: "1 питання",
      questionCount: 1,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [
        {
          id: "file_1_image_1",
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          mimeType: "image/png",
          fileName: "cell.png",
          page: 0,
          width: 10,
          height: 10
        }
      ],
      useImageInputs: true,
      allowImages: false
    });

    assert.equal(result.questions[0].image, null);
    assert.equal(result.questions[0].imageSourceId, "");
  });
});

test("allowImages:true (за замовчуванням) зберігає попередню поведінку зображень", async () => {
  const requests = [];

  const stub = async (url) => {
    const href = String(url);
    requests.push(href);

    if (href.includes("/chat/completions")) {
      return modelResponse({
        chat_reply: "",
        title: "Тести 2 питань — Трикутник і клітина",
        questions: [
          {
            type: "quiz",
            question:
              "У рівнобедреному трикутнику кути при основі 50°. Чому дорівнює кут при вершині?",
            answers: ["80°", "50°", "100°", "65°"],
            correct: [0],
            difficulty: "medium",
            needsImage: true,
            imageKind: "photo",
            imageSourceId: "",
            imageSearchQueryEn: "isosceles triangle",
            imageAlt: "Трикутник",
            geometrySpec: "",
            diagramSpec: "",
            language: "uk"
          },
          { ...GENERATED_QUESTION }
        ]
      });
    }

    return imageSearchResponse(href);
  };

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "Трикутники та клітина",
      prompt: "2 питання",
      questionCount: 2,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    const geometry = result.questions[0];
    const biology = result.questions[1];

    assert.equal(geometry.imageKind, "geometry");
    assert.match(String(geometry.imageSource), /^generated:\/\//);
    assert.equal(biology.imageKind, "photo");
    assert.equal(biology.image, "data:image/png;base64,iVBORw0KGgo=");

    const searchCalls = requests.filter((url) => url.includes("list=search"));
    assert.equal(searchCalls.length, 1, "пошук лише для біологічного питання");
  });
});

test("без параметра allowImages зображення працюють (сумісність зі старим викликом)", async () => {
  const requests = [];

  const stub = async (url) => {
    const href = String(url);
    requests.push(href);

    if (href.includes("/chat/completions")) {
      return modelResponse({
        chat_reply: "",
        title: "Тести 1 питань — Клітина",
        questions: [{ ...GENERATED_QUESTION }]
      });
    }

    return imageSearchResponse(href);
  };

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      material: "Клітина",
      prompt: "1 питання",
      questionCount: 1,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false
    });

    assert.equal(result.questions[0].imageKind, "photo");
    assert.equal(result.questions[0].image, "data:image/png;base64,iVBORw0KGgo=");
  });
});

// 3. Системний промпт
test("системний промпт описує обидва режими та поле chat_reply", () => {
  const prompt = Hooks.buildPrompt({
    material: "",
    prompt: "Привіт",
    questionCount: 10,
    questionCountRequested: false,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /chat_reply/);
  assert.match(prompt, /РЕЖИМ 1 — ДІАЛОГ/);
  assert.match(prompt, /РЕЖИМ 2 — ГЕНЕРАЦІЯ/);
  assert.match(prompt, /на яку тему, для якого класу та з якого предмета/);
  assert.match(prompt, /друкарськ/i);
  assert.match(prompt, /Перепитай/i);
});

// Запит користувача: «не всі питання мають бути одного типу».
test("системний промпт вимагає 2–3 питання multiquiz", () => {
  const prompt = Hooks.buildPrompt({
    material: "Текст підручника про многогранники.",
    prompt: "Зроби 10 питань",
    questionCount: 10,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /multiquiz/);
  assert.match(prompt, /2–3 питання/);
  assert.match(prompt, /Не роби всі питання тесту одного типу/);
  assert.match(prompt, /РОЗПОДІЛ ПРАВИЛЬНИХ ВІДПОВІДЕЙ/);
});

test("системний промпт просить розподіляти позиції правильних відповідей", () => {
  const prompt = Hooks.buildPrompt({
    material: "Текст підручника.",
    prompt: "Зроби 8 питань",
    questionCount: 8,
    questionCountRequested: true,
    questionTypes: "quiz",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /не став правильну відповідь завжди першою/i);
  assert.match(prompt, /Чергуй позиції/);
});

test("системний промпт з questionTypes:quiz забороняє multiquiz", () => {
  const prompt = Hooks.buildPrompt({
    material: "Текст.",
    prompt: "Зроби 5 питань",
    questionCount: 5,
    questionCountRequested: true,
    questionTypes: "quiz",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /Генеруй тільки quiz\./);
});

test("системний промпт з allowImages:false містить жорстку заборону зображень", () => {
  const prompt = Hooks.buildPrompt({
    material: "",
    prompt: "Створи 5 питань про клітину",
    questionCount: 5,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: false
  });

  assert.match(prompt, /DO NOT generate or suggest any images for this test/);
  assert.doesNotMatch(prompt, /imageKind="photo"/);
  assert.doesNotMatch(prompt, /Доступні окремі зображення з книги/);
});

test("системний промпт з allowImages:true зберігає правила зображень", () => {
  const prompt = Hooks.buildPrompt({
    material: "",
    prompt: "Створи 5 питань про клітину",
    questionCount: 5,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /Правила зображень/);
  assert.match(prompt, /imageKind/);
  assert.doesNotMatch(prompt, /DO NOT generate or suggest any images/);
});

test("системний промпт не нав'язує кількість питань, якщо користувач її не вказав", () => {
  const withoutCount = Hooks.buildPrompt({
    material: "",
    prompt: "Привіт",
    questionCount: 10,
    questionCountRequested: false,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(withoutCount, /якщо ти генеруєш тест/);
  assert.doesNotMatch(withoutCount, /Створи 10 питань/);

  const withCount = Hooks.buildPrompt({
    material: "",
    prompt: "Зроби 7 питань про фотосинтез",
    questionCount: 7,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(withCount, /явно вказав кількість питань: 7/);
});

test("системний промпт вимагає, щоб питання з зображенням посилалося на нього", () => {
  const prompt = Hooks.buildPrompt({
    material: "Текст підручника",
    prompt: "Зроби питання з малюнками",
    questionCount: 5,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /На рисунку зображено/);
  assert.match(prompt, /ОБОВ'ЯЗКОВО має посилатися/);
  assert.match(prompt, /учень бачить лише малюнок/);
});

test("промпт пояснює моделі, яка книга пішла в роботу", () => {
  const prompt = Hooks.buildPrompt({
    material: "[Сторінка 1]\nТекст",
    materialSource: "сторінки 16–26 підручника/матеріалу",
    materialPart: "",
    dialogOnly: false,
    prompt: "зроби 5 питань",
    questionCount: 5,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: false
  });

  assert.match(prompt, /Джерело матеріалу: сторінки 16–26/);
  assert.match(prompt, /Складай питання\s+ВИКЛЮЧНО за наведеним текстом/);
});

test("у діалоговому режимі промпт забороняє вигадувати тест без матеріалу", () => {
  const prompt = Hooks.buildPrompt({
    material: "[Навчальні матеріали не додані.]",
    dialogOnly: true,
    prompt: "Привіт",
    questionCount: 10,
    questionCountRequested: false,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /НЕ додані/);
  assert.match(prompt, /ОБОВ'ЯЗКОВО має бути порожнім масивом/);
});

test("з наданим матеріалом промпт перемикає модель у режим генерації", () => {
  const prompt = Hooks.buildPrompt({
    material: "[Сторінка 12]\n1.4. ПАРАГРАФ. Текст підручника про тему.",
    materialSource: "сторінки 12 підручника/матеріалу",
    dialogOnly: false,
    prompt: "Зроби 10 питань за розділом 1.4",
    questionCount: 10,
    questionCountRequested: true,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /Це означає РЕЖИМ 2 — ГЕНЕРАЦІЯ/);
  assert.doesNotMatch(prompt, /Це означає РЕЖИМ 1 — ДІАЛОГ/);
  assert.match(prompt, /КАТЕГОРИЧНО ЗАБОРОНЕНО питати/);
  assert.match(prompt, /Предмет, клас і тему визначай із самого/);
  assert.match(prompt, /НЕ питай предмет, клас чи тему/);
});

test("без матеріалу промпт перемикає модель у режим діалогу", () => {
  const prompt = Hooks.buildPrompt({
    material: "[Навчальні матеріали не додані.]",
    dialogOnly: true,
    prompt: "Зроби тест",
    questionCount: 10,
    questionCountRequested: false,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /Це означає РЕЖИМ 1 — ДІАЛОГ/);
  assert.doesNotMatch(prompt, /КАТЕГОРИЧНО ЗАБОРОНЕНО питати/);
});

test("порожній material без dialogOnly не вмикає режим генерації", () => {
  const prompt = Hooks.buildPrompt({
    material: "   ",
    dialogOnly: false,
    prompt: "Привіт",
    questionCount: 10,
    questionCountRequested: false,
    questionTypes: "all",
    currentQuestions: [],
    sourceImages: [],
    allowImages: true
  });

  assert.match(prompt, /Це означає РЕЖИМ 1 — ДІАЛОГ/);
});

// Скан без текстового шару
test("скан без тексту не витрачає виклик моделі й повідомляє про OCR", async () => {
  const requests = [];
  const stub = async (url) => {
    requests.push(String(url));
    return modelResponse({ chat_reply: "", title: "", questions: [] });
  };

  await withFetchStub(stub, async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: PROVIDER_CONFIG,
      materialPages: Array.from({ length: 150 }, (_, index) => ({
        number: index + 1,
        sourcePage: index + 1,
        text: "",
        fileName: "scan.pdf",
        fileIndex: 0
      })),
      material: "",
      prompt: "Зроби 10 питань",
      questionCount: 10,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.deepEqual(result.questions, []);
    assert.equal(result.chatReply, "");
    assert.ok(
      result.imageWarnings.some((text) => /скановані зображення|OCR/.test(text)),
      "має бути підказка про OCR"
    );
  });

  assert.equal(requests.length, 0, "жодного виклику моделі");
});

test("assessMaterialQuality розрізняє нормальний текст і скан", () => {
  const normal = Hooks.assessMaterialQuality(
    Array.from({ length: 50 }, () => ({ text: "x".repeat(1500) }))
  );
  const scanned = Hooks.assessMaterialQuality(
    Array.from({ length: 50 }, () => ({ text: "" }))
  );
  const tiny = Hooks.assessMaterialQuality([{ text: "x".repeat(400) }]);

  assert.equal(normal.level, "ok");
  assert.equal(scanned.level, "none");
  assert.equal(scanned.chars, 0);
  assert.equal(tiny.level, "partial");
});
