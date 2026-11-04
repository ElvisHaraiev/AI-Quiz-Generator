// Тести AI-провайдерів: маршрутизація, endpoint, авторизація, JSON-режим,
// зображення та обробка помилок. Мережа завжди підмінюється mock-fetch.
//
// Реальні API-ключі не потрібні.

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

  if (!hooks?.generateQuestions) {
    throw new Error("Не вдалося завантажити тестові хуки з background.js.");
  }

  hooks.setImageDebugEnabled(false);

  return hooks;
}

const Hooks = loadBackground();

const ANSWER = {
  chat_reply: "",
  title: "Тести 1 питань — Клітина",
  questions: [
    {
      type: "quiz",
      question: "Яка органела рослинної клітини відповідає за фотосинтез?",
      answers: ["хлоропласт", "ядро", "мітохондрія", "вакуоля"],
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
    }
  ]
};

function chatCompletion(payload) {
  return {
    ok: true,
    status: 200,
    url: "https://api.example/v1/chat/completions",
    headers: { get: () => "application/json" },
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify(payload) } }]
      };
    },
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }]
      });
    }
  };
}

function jsonError(status, message) {
  const body = JSON.stringify({ error: { message } });

  return {
    ok: false,
    status,
    url: "https://api.example/chat/completions",
    headers: { get: () => "application/json" },
    async json() {
      return { error: { message } };
    },
    async text() {
      return body;
    }
  };
}

async function runGenerate({ provider, model, baseUrl, stub, allowImages = false, sourceImages = [] }) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;

  try {
    return await Hooks.generateQuestions({
      providerConfig: {
        provider,
        apiKey: "test-key-not-real",
        model,
        baseUrl
      },
      material: "Рослинна клітина",
      prompt: "1 питання",
      questionCount: 1,
      questionTypes: "all",
      currentQuestions: [],
      sourceImages,
      useImageInputs: sourceImages.length > 0,
      allowImages
    });
  } finally {
    globalThis.fetch = original;
  }
}

// --- DeepSeek: базовий виклик ---

test("DeepSeek: endpoint /chat/completions без /v1 і Bearer-авторизація", async () => {
  let captured = null;

  const stub = async (url, init) => {
    captured = { url: String(url), init };
    return chatCompletion(ANSWER);
  };

  const result = await runGenerate({
    provider: "deepseek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
    stub
  });

  assert.equal(
    captured.url,
    "https://api.deepseek.com/chat/completions",
    "DeepSeek не використовує префікс /v1"
  );
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer test-key-not-real");
  assert.equal(captured.init.headers["Content-Type"], "application/json");

  const body = JSON.parse(captured.init.body);

  assert.equal(body.model, "deepseek-flash");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 8000);
  assert.equal(result.questions.length, 1);
});

test("DeepSeek: кілька слешів у baseUrl не ламають endpoint", async () => {
  let captured = "";

  const stub = async (url) => {
    captured = String(url);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "deepseek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com///",
    stub
  });

  assert.equal(captured, "https://api.deepseek.com/chat/completions");
});

test("DeepSeek: власна модель (deepseek-v4-pro) передається як є", async () => {
  let body = null;

  const stub = async (url, init) => {
    body = JSON.parse(init.body);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    stub
  });

  assert.equal(body.model, "deepseek-v4-pro");
});

test("DeepSeek: без sourceImages вміст запиту — звичайний рядок", async () => {
  let body = null;

  const stub = async (url, init) => {
    body = JSON.parse(init.body);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "deepseek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
    stub
  });

  const userMessage = body.messages.find((message) => message.role === "user");

  assert.equal(typeof userMessage.content, "string");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /json/i);
});

test("DeepSeek: зображення передаються як image_url для vision-моделі", async () => {
  let body = null;

  const stub = async (url, init) => {
    body = JSON.parse(init.body);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "deepseek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
    stub,
    allowImages: true,
    sourceImages: [
      {
        id: "file_1_image_1",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        fileName: "cell.png",
        page: 1,
        width: 10,
        height: 10
      }
    ]
  });

  const userMessage = body.messages.find((message) => message.role === "user");

  assert.ok(Array.isArray(userMessage.content), "має бути масив блоків контенту");

  const imageBlock = userMessage.content.find((block) => block.type === "image_url");

  assert.ok(imageBlock, "має бути блок image_url");
  assert.equal(imageBlock.image_url.url, "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(imageBlock.image_url.detail, "low");
});

test("DeepSeek: надто великий набір зображень не перевищує ліміт запиту", async () => {
  let body = null;

  const stub = async (url, init) => {
    body = JSON.parse(init.body);
    return chatCompletion(ANSWER);
  };

  // 3 зображення по ~10 МБ у base64 → у запит має потрапити не все.
  const bigDataUrl = "data:image/png;base64," + "A".repeat(14 * 1024 * 1024);

  await runGenerate({
    provider: "deepseek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
    stub,
    allowImages: true,
    sourceImages: [
      { id: "img_1", dataUrl: bigDataUrl, fileName: "a.png", page: 0 },
      { id: "img_2", dataUrl: bigDataUrl, fileName: "b.png", page: 0 },
      { id: "img_3", dataUrl: bigDataUrl, fileName: "c.png", page: 0 }
    ]
  });

  const userMessage = body.messages.find((message) => message.role === "user");
  const imageBlocks = userMessage.content.filter((block) => block.type === "image_url");
  const totalBytes = imageBlocks.reduce(
    (sum, block) => sum + Math.floor((block.image_url.url.length * 3) / 4),
    0
  );

  assert.ok(imageBlocks.length < 3, "частину зображень має бути пропущено");
  assert.ok(
    totalBytes <= 24 * 1024 * 1024,
    `сумарний розмір ${totalBytes} перевищує ліміт`
  );
});

test("DeepSeek: порожня відповідь дає зрозумілу помилку з finish_reason", async () => {
  const emptyAnswer = {
    choices: [{ message: { content: "" }, finish_reason: "length" }]
  };

  const stub = async () => ({
    ok: true,
    status: 200,
    url: "https://api.deepseek.com/chat/completions",
    headers: { get: () => "application/json" },
    async json() {
      return emptyAnswer;
    },
    async text() {
      return JSON.stringify(emptyAnswer);
    }
  });

  await assert.rejects(
    () =>
      runGenerate({
        provider: "deepseek",
        model: "deepseek-flash",
        baseUrl: "https://api.deepseek.com",
        stub
      }),
    (error) => {
      assert.match(error.message, /DeepSeek/);
      assert.match(error.message, /порожню відповідь/);
      assert.match(error.message, /finish_reason/);
      return true;
    }
  );
});

test("DeepSeek: HTTP-помилка провайдера прокидається з текстом", async () => {
  const stub = async () => jsonError(401, "Authentication Fails");

  await assert.rejects(
    () =>
      runGenerate({
        provider: "deepseek",
        model: "deepseek-flash",
        baseUrl: "https://api.deepseek.com",
        stub
      }),
    /DeepSeek API: Authentication Fails/
  );
});

test("DeepSeek: діалоговий режим (chat_reply без питань) працює", async () => {
  const stub = async () =>
    chatCompletion({
      chat_reply: "Вітаю! Підкажіть предмет, клас і тему.",
      title: "",
      questions: []
    });

  const result = await runGenerate({
    provider: "deepseek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
    stub
  });

  assert.equal(result.chatReply, "Вітаю! Підкажіть предмет, клас і тему.");
  assert.deepEqual(result.questions, []);
});

// --- Нормалізація назви провайдера ---

test("DeepSeek: варіанти назви провайдера нормалізуються", async () => {
  for (const provider of ["deepseek", "DeepSeek", "DEEPSEEK", "deep_seek", "deep-seek"]) {
    let captured = "";

    const stub = async (url) => {
      captured = String(url);
      return chatCompletion(ANSWER);
    };

    await runGenerate({
      provider,
      model: "deepseek-flash",
      baseUrl: "https://api.deepseek.com",
      stub
    });

    assert.equal(
      captured,
      "https://api.deepseek.com/chat/completions",
      `провайдер "${provider}" має маршрутизуватися в DeepSeek`
    );
  }
});

test("невідомий провайдер падає назад в OpenAI, а не в помилку", async () => {
  let captured = "";

  const stub = async (url) => {
    captured = String(url);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "some-unknown-provider",
    model: "gpt-4o-mini",
    baseUrl: "",
    stub
  });

  assert.equal(captured, "https://api.openai.com/v1/chat/completions");
});

// --- Регресії інших провайдерів ---

test("OpenAI: endpoint з /v1 не змінився", async () => {
  let captured = "";

  const stub = async (url) => {
    captured = String(url);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "openai",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    stub
  });

  assert.equal(captured, "https://api.openai.com/v1/chat/completions");
});

test("Mistral: endpoint з /v1 не змінився", async () => {
  let captured = "";

  const stub = async (url) => {
    captured = String(url);
    return chatCompletion(ANSWER);
  };

  await runGenerate({
    provider: "mistral",
    model: "mistral-small-latest",
    baseUrl: "https://api.mistral.ai/v1",
    stub
  });

  assert.equal(captured, "https://api.mistral.ai/v1/chat/completions");
});
