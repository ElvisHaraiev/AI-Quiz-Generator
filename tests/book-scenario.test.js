// Наскрізна перевірка сценарію: у чаті завантажено підручник, користувач
// просить питання за параграфом (з помилками в тексті) — модель має піти
// в режим генерації, а не питати предмет і клас.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const Images = require(path.join(PROJECT_ROOT, "lib", "educational-images.js"));
const Material = require(path.join(PROJECT_ROOT, "lib", "material.js"));

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

  hooks.setImageDebugEnabled(false);

  return hooks;
}

const Hooks = loadBackground();

// Підручник: розділ 1, параграфи 1.1 – 1.5, друга книга — інший предмет.
function buildBook({ fileIndex, fileName, chapter, title }) {
  const pages = [];

  for (let section = 1; section <= 5; section++) {
    const heading = `${chapter}.${section}. ${title.toUpperCase()} — ПАРАГРАФ ${section}`;
    // Обсяг реального підручника: ~4000 символів на сторінку, щоб частини
    // матеріалу формувалися як у житті (по кілька сторінок).
    const body =
      `Це матеріал параграфа ${chapter}.${section} з предмета «${title}». ` +
      "Тут описано основні поняття, визначення та приклади застосування. ".repeat(55);

    pages.push({
      number: pages.length + 1,
      sourcePage: pages.length + 1,
      text: `${heading} ${body}`,
      fileName,
      fileIndex
    });
  }

  return pages;
}

const BOOK_MATH = buildBook({
  fileIndex: 0,
  fileName: "algebra-7.pdf",
  chapter: 1,
  title: "алгебра"
});

function modelAnswer() {
  return {
    chat_reply: "",
    title: "Тести 10 питань — Алгебра, параграф 1.4",
    questions: Array.from({ length: 10 }, (_, index) => ({
      type: "quiz",
      question: `Питання ${index + 1} за параграфом 1.4?`,
      answers: ["A", "B", "C", "D"],
      correct: [0],
      difficulty: "medium",
      needsImage: false,
      imageKind: "none",
      imageSourceId: "",
      imageSearchQuery: "",
      imageSearchQueryEn: "",
      imageAlt: "",
      imageSource: "",
      geometrySpec: "",
      diagramSpec: "",
      language: "uk"
    }))
  };
}

function withStub(run) {
  const requests = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body || "" });

    const payload = {
      choices: [{ message: { content: JSON.stringify(modelAnswer()) } }]
    };

    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => "application/json" },
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      }
    };
  };

  return Promise.resolve()
    .then(() => run(requests))
    .finally(() => {
      globalThis.fetch = original;
    });
}

// Той самий запит, що на скріншоті (з помилками в тексті).
const USER_PROMPT = "Зроби питання 10 штук вдаоівно трозділ 1 4 параграф";

test("запит із помилками розпізнає параграф 1.4", () => {
  const chunks = Material.buildChunks(BOOK_MATH, { maxChars: 4000 });
  const selection = Material.selectChunksForPrompt(chunks, USER_PROMPT, {
    maxChunks: 3,
    maxChars: 30000
  });

  assert.ok(
    selection.strategy === "section" || selection.strategy === "section-mention",
    `стратегія ${selection.strategy}`
  );
  assert.ok(
    selection.selected.some((chunk) => chunk.text.includes("1.4.")),
    "має бути обрана частина з параграфом 1.4"
  );
});

test("коли підручник завантажено, модель отримує режим генерації, а не діалогу", async () => {
  await withStub(async (requests) => {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      materialPages: BOOK_MATH,
      material: "",
      prompt: USER_PROMPT,
      questionCount: 10,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.equal(requests.length, 1, "має бути один виклик моделі");
    assert.equal(result.questions.length, 10);
    assert.equal(result.chatReply, "");

    const sentPrompt = JSON.parse(requests[0].body).messages
      .find((message) => message.role === "user").content;

    const promptText = typeof sentPrompt === "string"
      ? sentPrompt
      : sentPrompt.map((part) => part.text || "").join(" ");

    assert.match(promptText, /Це означає РЕЖИМ 2 — ГЕНЕРАЦІЯ/);
    assert.doesNotMatch(promptText, /Це означає РЕЖИМ 1 — ДІАЛОГ/);
    assert.match(promptText, /КАТЕГОРИЧНО ЗАБОРОНЕНО питати/);
    assert.match(promptText, /1\.4\./);

    // Джерело вказано, отже користувач бачить, з чого складався тест.
    assert.equal(result.materialPlan.fileName, "algebra-7.pdf");
    assert.deepEqual(result.materialPlan.fileNames, ["algebra-7.pdf"]);
  });
});

test("питання складено з потрібного параграфа, а не з початку книги", async () => {
  await withStub(async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      materialPages: BOOK_MATH,
      material: "",
      prompt: USER_PROMPT,
      questionCount: 10,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    const plan = result.materialPlan;

    // Параграф 1.4 — четверта сторінка (1.1 … 1.5), тож вибір має бути
    // зміщений у другу половину книги, а не з самої сторінки 1.
    assert.ok(
      plan.pages[0].from >= 3,
      `вибір має починатися ближче до 1.4, а починається з ${plan.pages[0].from}`
    );
    assert.equal(plan.strategy, "section");
  });
});

test("без матеріалу той самий запит лишається діалогом", async () => {
  await withStub(async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      materialPages: [],
      material: "",
      prompt: USER_PROMPT,
      questionCount: 10,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.equal(result.materialPlan.strategy, "dialog");
  });
});

test("друга книга в тому ж чаті: без орієнтирів беруться питання з неї", async () => {
  const bookHistory = buildBook({
    fileIndex: 1,
    fileName: "history-8.pdf",
    chapter: 1,
    title: "історія"
  });

  await withStub(async (requests) => {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      materialPages: [...BOOK_MATH, ...bookHistory],
      material: "",
      prompt: "Зроби 10 питань",
      questionCount: 10,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.equal(result.materialPlan.fileName, "history-8.pdf");
    assert.equal(result.materialPlan.fileChoiceReason, "latest");

    const sentPrompt = JSON.parse(requests[0].body).messages
      .find((message) => message.role === "user").content;

    const promptText = typeof sentPrompt === "string"
      ? sentPrompt
      : sentPrompt.map((part) => part.text || "").join(" ");

    assert.match(promptText, /ІСТОРІЯ/);
    assert.doesNotMatch(promptText, /АЛГЕБРА/);

    // І користувач попереджений, який файл використано.
    assert.ok(
      result.imageWarnings.some((text) => /history-8\.pdf/.test(text)),
      "має бути повідомлення, який файл узято"
    );
  });
});

// Модель іноді ігнорує вимогу про multiquiz і повертає всі питання типу quiz.
// Це не помилка, але користувач має дізнатися про це з попередження, а не
// дивуватися, чому в тесті немає питань із кількома відповідями.
test("коли модель зробила всі питання quiz — користувач попереджений", async () => {
  await withStub(async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      materialPages: BOOK_MATH,
      material: "",
      prompt: USER_PROMPT,
      questionCount: 10,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.equal(result.questions.length, 10);
    assert.ok(
      result.questions.every((question) => question.type === "quiz"),
      "у цьому сценарії модель повертає тільки quiz"
    );
    assert.ok(
      result.imageWarnings.some((text) => /Типи питань/.test(text)),
      `очікувалось попередження про типи питань, отримано: ${result.imageWarnings.join(" | ")}`
    );
  });
});

test("коли користувач просив лише quiz — попередження про типи не показуємо", async () => {
  await withStub(async () => {
    const result = await Hooks.generateQuestions({
      providerConfig: {
        provider: "openai",
        apiKey: "test-key-not-real",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      },
      materialPages: BOOK_MATH,
      material: "",
      prompt: USER_PROMPT,
      questionCount: 10,
      questionTypes: "quiz",
      currentQuestions: [],
      sourceImages: [],
      useImageInputs: false,
      allowImages: true
    });

    assert.ok(
      !result.imageWarnings.some((text) => /Типи питань/.test(text)),
      "не має бути попередження, коли користувач сам обрав лише quiz"
    );
  });
});
