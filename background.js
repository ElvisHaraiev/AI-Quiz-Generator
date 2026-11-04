// background.js — AI Quiz Generator provider router.
// Real API calls only. No mock or local generation.

importScripts("lib/educational-images.js", "lib/material.js");

const Images = self.QuizGenImages;
const Material = self.QuizGenMaterial;

const PROVIDER_DEFAULTS = {
  openai: {
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1"
  },
  gemini: {
    model: "gemini-3.6-flash",
    baseUrl: ""
  },
  deepseek: {
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com"
  },
  manus: {
    model: "manus-1.6-lite",
    baseUrl: "https://api.manus.ai"
  },
  mistral: {
    model: "mistral-small-latest",
    baseUrl: "https://api.mistral.ai/v1"
  }
};

// Моделі DeepSeek із підтримкою зображень на вхід (Vision API).
const DEEPSEEK_VISION_MODELS = ["deepseek-flash"];

// Ліміт тіла запиту DeepSeek — 48 MiB, тому обмежуємо сумарний розмір
// зображень, які додаються в запит.
const MAX_DEEPSEEK_REQUEST_IMAGE_BYTES = 24 * 1024 * 1024;

const MAX_SOURCE_IMAGES = 8;
const MAX_EXTERNAL_IMAGES = 5;
const MAX_EXTERNAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_GENERATED_IMAGES = 8;

// Ключ діагностики в chrome.storage.local. Вмикається без зміни коду:
// chrome.storage.local.set({ quizGenDebugImages: true })
const DEBUG_IMAGE_FLAG_KEY = "quizGenDebugImages";

let imageDebugEnabled = false;
let imageDebugLoaded = false;

const MAX_LOGGED_CANDIDATES = 3;

async function loadImageDebugFlag() {
  if (imageDebugLoaded) {
    return imageDebugEnabled;
  }

  imageDebugLoaded = true;

  try {
    const stored = await chrome.storage.local.get([DEBUG_IMAGE_FLAG_KEY]);
    imageDebugEnabled = stored?.[DEBUG_IMAGE_FLAG_KEY] === true;
  } catch (_) {
    imageDebugEnabled = false;
  }

  return imageDebugEnabled;
}

// Діагностика системи зображень. Вмикається лише прапорцем у сховищі,
// щоб не засмічувати консоль. Ніколи не виводить API-ключі, матеріали
// або повний текст питань — лише типи, запити та скори.
function imageLog(message, data) {
  if (!imageDebugEnabled) {
    return;
  }

  if (data === undefined) {
    console.log("[AI Quiz Generator][images]", message);
    return;
  }

  console.log("[AI Quiz Generator][images]", message, data);
}

function imageWarn(message, data) {
  if (data === undefined) {
    console.warn("[AI Quiz Generator][images]", message);
    return;
  }

  console.warn("[AI Quiz Generator][images]", message, data);
}

function truncateText(value, maxLength = 70) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  return text.length > maxLength
    ? text.slice(0, maxLength) + "…"
    : text;
}

function logCandidateList(candidates) {
  if (!imageDebugEnabled) {
    return;
  }

  const top = candidates.slice(0, MAX_LOGGED_CANDIDATES);

  if (!top.length) {
    imageLog("кандидатів немає");
    return;
  }

  top.forEach((candidate, index) => {
    imageLog(
      `  #${index + 1} score=${Number(candidate.score || 0).toFixed(3)} ` +
      `provider=${candidate.provider || "?"} ` +
      `title="${truncateText(candidate.title, 60)}"`,
      {
        host: safeHost(candidate.url || candidate.thumbnail || "")
      }
    );
  });
}

function safeHost(url) {
  try {
    return new URL(String(url)).hostname;
  } catch (_) {
    return "";
  }
}

const IMAGE_QUESTION_PROPERTIES = {
  type: { type: "string" },
  question: { type: "string" },
  answers: {
    type: "array",
    items: { type: "string" }
  },
  correct: {
    type: "array",
    items: { type: "integer" }
  },
  difficulty: { type: "string" },
  needsImage: { type: "boolean" },
  imageKind: { type: "string" },
  imageSourceId: { type: "string" },
  imageSearchQuery: { type: "string" },
  imageSearchQueryEn: { type: "string" },
  imageAlt: { type: "string" },
  imageSource: { type: "string" },
  geometrySpec: { type: "string" },
  diagramSpec: { type: "string" },
  language: { type: "string" }
};

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    chat_reply: {
      type: "string"
    },
    title: {
      type: "string"
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: IMAGE_QUESTION_PROPERTIES,
        required: [
          "type",
          "question",
          "answers",
          "correct",
          "difficulty",
          "needsImage",
          "imageKind",
          "imageSourceId"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["title", "questions"],
  additionalProperties: false
};

const GEMINI_QUESTION_SCHEMA = QUESTION_SCHEMA;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["providerConfig"], (data) => {
    if (!data.providerConfig) {
      chrome.storage.local.set({
        providerConfig: {
          provider: "openai",
          apiKey: "",
          model: PROVIDER_DEFAULTS.openai.model,
          baseUrl: PROVIDER_DEFAULTS.openai.baseUrl
        }
      });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateQuestions") {
    generateQuestions(request)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        console.error("[AI Quiz Generator] generation error:", error);

        sendResponse({
          error: error.message || "Помилка генерації питань."
        });
      });

    return true;
  }

  if (request.action === "testProvider") {
    testProvider(request.providerConfig)
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        console.error("[AI Quiz Generator] provider test error:", error);

        sendResponse({
          error: error.message || "Не вдалося перевірити AI-провайдера."
        });
      });

    return true;
  }

  return false;
});

function normalizeProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();

  if (value === "google" || value === "google_gemini") {
    return "gemini";
  }

  if (value === "deep-seek" || value === "deep_seek") {
    return "deepseek";
  }

  if (["openai", "gemini", "deepseek", "manus", "mistral"].includes(value)) {
    return value;
  }

  return "openai";
}

function normalizeProviderConfig(config = {}) {
  const provider = normalizeProvider(config.provider);
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;

  return {
    provider,
    apiKey: String(config.apiKey || "").trim(),
    model: String(config.model || defaults.model || "").trim(),
    baseUrl: String(config.baseUrl || defaults.baseUrl || "").trim()
  };
}

async function testProvider(providerConfig) {
  const config = normalizeProviderConfig(providerConfig);

  if (!config.apiKey) {
    throw new Error("Вкажіть API ключ.");
  }

  if (config.provider === "manus") {
    const created = await createManusTask(
      config,
      "Тест підключення. Підтвердь, що API працює.",
      null,
      []
    );

    if (!created.taskId) {
      throw new Error("Manus API не повернув task_id.");
    }

    return true;
  }

  const result = await callProvider(
    config,
    'Поверни тільки JSON без пояснень: {"chat_reply":"","title":"","questions":[]}',
    []
  );

  if (!result || typeof result !== "object") {
    throw new Error("AI-провайдер повернув некоректну відповідь.");
  }

  return true;
}

async function generateQuestions({
  providerConfig,
  material,
  materialPages,
  prompt,
  questionCount,
  questionTypes,
  currentQuestions,
  sourceImages,
  useImageInputs,
  allowImages
}) {
  const config = normalizeProviderConfig(providerConfig);

  if (!config.apiKey) {
    throw new Error(
      "API ключ не вказано. Відкрийте AI-провайдер і додайте ключ."
    );
  }

  const cleanMaterial = String(material || "").trim();
  const cleanPrompt = String(prompt || "").trim();

  // allowImages за замовчуванням увімкнено (як і перемикач у UI).
  const imagesAllowed = allowImages !== false;

  const normalizedCurrentQuestions =
    sanitizeCurrentQuestions(currentQuestions);

  const normalizedSourceImages =
    normalizeSourceImages(sourceImages);

  const hasPages = Array.isArray(materialPages) && materialPages.length > 0;

  if (
    !cleanMaterial &&
    !hasPages &&
    !cleanPrompt &&
    !normalizedCurrentQuestions.length
  ) {
    throw new Error("Додайте навчальні матеріали або напишіть запит.");
  }

  const count = questionCount
    ? Math.max(1, Math.min(30, Number(questionCount)))
    : Math.max(1, Math.min(30, normalizedCurrentQuestions.length || 10));

  await loadImageDebugFlag();

  // Скан без текстового шару: моделі нема чого читати, тож не витрачаємо
  // виклик і не даємо їй почати питати предмет та клас.
  // Якщо сторінок узагалі не передали — це звичайний діалог, не скан.
  const materialQuality = assessMaterialQuality(materialPages);
  const hasUnreadableMaterial =
    Array.isArray(materialPages) &&
    materialPages.length > 0 &&
    materialQuality.level === "none" &&
    !cleanMaterial;

  if (hasUnreadableMaterial) {
    imageLog("Матеріал непридатний для генерації", materialQuality);

    return {
      title: "",
      chatReply: "",
      questions: [],
      imageWarnings: [
        `У завантаженому файлі майже немає тексту (${materialQuality.chars} символів ` +
        `на ${materialQuality.pages} сторінок). Схоже, це скановані зображення ` +
        "без текстового шару. Розпізнайте файл (OCR) або додайте .docx/.txt."
      ],
      materialPlan: {
        source: "pages",
        totalChunks: 0,
        selectedChunks: 0,
        strategy: "unreadable",
        fileName: "",
        fileCount: 1,
        fileChoiceReason: "single",
        partial: false,
        suspectFontEncoding: false,
        pages: []
      }
    };
  }

  // Розбиваємо матеріал на частини та обираємо ті, що стосуються запиту.
  const plannedMaterial = planMaterial({
    materialPages,
    material: cleanMaterial,
    prompt: cleanPrompt,
    questionCount: count
  });

  // Великий PDF: спершу показуємо моделі зміст УСІЄЇ книги і даємо обрати
  // розділи. Інакше в запит потрапляло ~3% тексту, і для незнайомих книжок
  // питання бралися з випадкового місця.
  let materialPlan = plannedMaterial;
  let documentOutline = [];

  if (shouldRouteByOutline(materialPages, plannedMaterial)) {
    imageLog("Будую карту документа для великого матеріалу");

    const routed = await routeByOutline({
      materialPages,
      plan: plannedMaterial,
      prompt: cleanPrompt,
      questionCount: count,
      config
    });

    materialPlan = routed.plan;
    documentOutline = routed.outline;

    imageLog("Маршрутизація за картою", {
      розділівУКарті: routed.outline.length,
      обрано: routed.picked || [],
      застосовано: Boolean(routed.routed),
      частинОбрано: materialPlan.selected.length
    });
  }

  imageLog("План матеріалу", {
    джерело: materialPlan.source,
    частинУсього: materialPlan.totalChunks,
    обрано: materialPlan.selected.length,
    стратегія: materialPlan.strategy,
    сторінки: materialPlan.selected.map((chunk) => ({
      від: chunk.pageFrom,
      до: chunk.pageTo
    }))
  });

  const aiResponses = [];

  for (let index = 0; index < materialPlan.selected.length; index++) {
    const chunk = materialPlan.selected[index];
    const isLast = index === materialPlan.selected.length - 1;
    const chunkCount = materialPlan.selected.length === 1
      ? count
      : distributeCount(count, materialPlan.selected.length)[index];

    if (!chunkCount) {
      continue;
    }

    const providerPrompt = buildPrompt({
      material: chunk.text,
      materialSource: chunk.source === "pages"
        ? `сторінки ${Material.formatPageRange(chunk)} підручника/матеріалу`
        : "наданий текст",
      materialPart: materialPlan.selected.length > 1
        ? `частина ${index + 1} з ${materialPlan.selected.length}`
        : "",
      dialogOnly: Boolean(materialPlan.dialogOnly),
      prompt: cleanPrompt,
      questionCount: chunkCount,
      questionCountRequested: Boolean(questionCount),
      questionTypes: String(questionTypes || "all"),
      currentQuestions: isLast ? normalizedCurrentQuestions : [],
      sourceImages: index === 0 ? normalizedSourceImages : [],
      allowImages: imagesAllowed
    });

    const imagesForProvider = useImageInputs && imagesAllowed && index === 0
      ? normalizedSourceImages
      : [];

    aiResponses.push({
      chunk,
      chunkCount,
      response: await callProvider(config, providerPrompt, imagesForProvider)
    });
  }

  const firstResponse = aiResponses[0]?.response;
  const chatReply = String(firstResponse?.chat_reply || "").trim();

  // Запобіжник: якщо в усіх питаннях правильна відповідь стоїть першою,
  // учень угадуватиме за номером варіанта. Зсуваємо позиції по колу.
  const rawQuestions = distributeCorrectPositions(
    mergeRawQuestions(aiResponses, count)
  );

  // Діалоговий режим: модель відповіла текстом і не повернула питань.
  // Це не помилка — питань просто ще немає.
  if (!rawQuestions.length) {
    return {
      title: "",
      chatReply,
      questions: [],
      imageWarnings: [],
      materialPlan: describePlan(materialPlan)
    };
  }

  const imageWarnings = [];

  if (materialPlan.partial) {
    const coverage = describeOutlineCoverage(materialPlan, documentOutline);

    if (coverage) {
      // Карту документа побудовано: користувач бачить, що систему прочитала
      // всю книгу, а в запит пішли обрані розділи.
      imageWarnings.push(
        `Опрацьовано книгу повністю: ${coverage.sections} розділів у змісті, ` +
        `для питань узято ${materialPlan.selected.length} ` +
        `(${Math.round(coverage.ratio * 100)}% тексту, сторінки ` +
        `${Material.formatPageRange(materialPlan.selected[0])}–` +
        `${Material.formatPageRange(materialPlan.selected[materialPlan.selected.length - 1])}).`
      );
    } else {
      imageWarnings.push(
        `Матеріал великий: опрацьовано частину (${materialPlan.selected.length} з ` +
        `${materialPlan.totalChunks} фрагментів, сторінки ` +
        `${Material.formatPageRange(materialPlan.selected[0])}–` +
        `${Material.formatPageRange(materialPlan.selected[materialPlan.selected.length - 1])}). ` +
        "Уточніть тему або розділ для точнішого результату."
      );
    }
  }

  if (materialPlan.suspectFontEncoding) {
    imageWarnings.push(
      "У частині матеріалу символи зіпсовані вбудованим шрифтом PDF — " +
      "модель бачить текст із підстановками. Якщо є можливість, використайте " +
      "текстовий файл або .docx."
    );
  }

  // Коли завантажено кілька книг і потрібну не назвали — кажемо, яку взято.
  if (
    materialPlan.fileCount > 1 &&
    materialPlan.fileName &&
    (materialPlan.fileChoiceReason === "latest" ||
      materialPlan.fileChoiceReason === "keywords")
  ) {
    imageWarnings.push(
      `У чаті ${materialPlan.fileCount} файли (${materialPlan.fileNames.join(", ")}). ` +
      `Питання складаються з «${materialPlan.fileName}». ` +
      "Щоб узяти інший, назвіть його тему, розділ або номер файлу в запиті."
    );
  }

  imageLog("Старт обробки зображень", {
    питань: rawQuestions.length,
    зображеньЗМатеріалів: normalizedSourceImages.length,
    діагностика: imageDebugEnabled,
    зображенняУвімкнено: imagesAllowed
  });

  const resolvedImages = await resolveQuestionImages(
    rawQuestions,
    normalizedSourceImages,
    {
      allowImages: imagesAllowed,
      onWarning: (message) => {
        if (!imageWarnings.includes(message)) {
          imageWarnings.push(message);
        }
      }
    }
  );

  const questions = normalizeQuestions(
    resolvedImages.questions,
    resolvedImages.sourceImages
  );

  if (!questions.length) {
    return {
      title: "",
      chatReply,
      questions: [],
      imageWarnings,
      materialPlan: describePlan(materialPlan)
    };
  }

  // Модель іноді повертає всі питання типу quiz, хоч у промпті просили
  // частину зробити multiquiz. Це не помилка, але користувач має знати,
  // що типів немає, а не дивуватися мовчки.
  const allowedTypes = String(questionTypes || "all");

  if (
    (allowedTypes === "all" || allowedTypes === "mix") &&
    questions.length >= 4 &&
    !questions.some((question) => question.type === "multiquiz")
  ) {
    imageWarnings.push(
      "Типи питань: модель склала всі питання з однією правильною відповіддю. " +
      "Якщо потрібні питання з кількома правильними, напишіть у чаті: " +
      "«зроби 2 питання з кількома правильними відповідями»."
    );
  }

  if (imageWarnings.length) {
    console.warn(
      "[AI Quiz Generator][images] попередження щодо зображень:",
      imageWarnings
    );
  }

  return {
    title: normalizeGeneratedTitle(
      firstResponse?.title,
      questions.length,
      cleanPrompt,
      materialPlan.previewText
    ),
    chatReply,
    questions,
    imageWarnings,
    materialPlan: {
      ...describePlan(materialPlan),
      outline: describeOutlineCoverage(materialPlan, documentOutline)
    }
  };
}

const MATERIAL_CHUNK_CHARS = 12000;
const MAX_MATERIAL_CHUNKS = 4;
const MAX_MATERIAL_CHARS = 30000;

// Мінімум символів на сторінку, щоб сторінка вважалася придатною для питань.
// Скановані PDF без текстового шару дають близько нуля.
const MIN_CHARS_PER_PAGE = 20;

// Оцінює, скільки матеріалу справді придатно для генерації питань.
// Потрібно, щоб не витрачати виклик моделі на порожній скан і не отримати
// у відповідь прохання «вкажіть предмет і клас».
function assessMaterialQuality(materialPages) {
  const list = Array.isArray(materialPages) ? materialPages : [];

  if (!list.length) {
    return { level: "none", pages: 0, usablePages: 0, ratio: 0, chars: 0 };
  }

  let chars = 0;
  let usablePages = 0;

  list.forEach((page) => {
    const length = String(page?.text || "").trim().length;

    chars += length;

    if (length >= MIN_CHARS_PER_PAGE) {
      usablePages++;
    }
  });

  const ratio = usablePages / list.length;

  // Кілька сторінок із нормальним текстом цілком достатньо для тесту.
  if (usablePages >= 3 && chars >= 600) {
    return { level: "ok", pages: list.length, usablePages, ratio, chars };
  }

  if (usablePages >= 1 && chars >= 300) {
    return { level: "partial", pages: list.length, usablePages, ratio, chars };
  }

  return { level: "none", pages: list.length, usablePages, ratio, chars };
}

// Планує, які частини матеріалу підуть у модель.
// Якщо є посторінковий текст — ріжемо по сторінках і шукаємо названу тему.
// Інакше працюємо з суцільним текстом, як раніше.
function planMaterial({ materialPages, material, prompt, questionCount }) {
  const hasPages = Array.isArray(materialPages) && materialPages.length > 0;

  if (hasPages) {
    const pages = materialPages
      .map((page, index) => ({
        number: Number(page?.number || index + 1),
        sourcePage: Number(page?.sourcePage || page?.number || index + 1),
        text: String(page?.text || ""),
        fileName: String(page?.fileName || ""),
        fileIndex: Number(page?.fileIndex || 0)
      }))
      .filter((page) => page.text.trim());

    if (!pages.length) {
      return buildDialogPlan();
    }

    const allChunks = Material.buildChunks(pages, {
      maxChars: MATERIAL_CHUNK_CHARS
    }).map((chunk) => ({ ...chunk, source: "pages" }));

    if (!allChunks.length) {
      return buildDialogPlan();
    }

    // Кілька завантажених книг не змішуємо: обираємо одну.
    const fileNames = [...new Set(pages.map((page) => page.fileName).filter(Boolean))];
    const groups = Material.groupChunksByFile(allChunks);
    const picked = pickMaterialGroup(groups, prompt);
    const chunks = picked.group.chunks;

    const selection = Material.selectChunksForPrompt(chunks, prompt, {
      maxChunks: chunkBudgetForCount(questionCount),
      maxChars: MAX_MATERIAL_CHARS
    });

    const sample = pages
      .map((page) => page.text)
      .join(" ")
      .slice(0, 6000);

    return buildPlan({
      source: "pages",
      chunks,
      selected: selection.selected,
      strategy: selection.strategy,
      headings: selection.headings || [],
      requested: selection.requested,
      fileName: picked.group.fileName,
      fileIndex: picked.group.fileIndex,
      fileCount: groups.length,
      fileNames,
      fileChoiceReason: picked.reason,
      suspectFontEncoding: Material.mojibakeRatio(sample) > 0.65
    });
  }

  const text = String(material || "").trim();

  if (!text) {
    return buildDialogPlan();
  }

  const chunks = splitPlainText(text, MATERIAL_CHUNK_CHARS)
    .map((chunk, index) => ({
      index,
      pages: [],
      pageFrom: 0,
      pageTo: 0,
      chars: chunk.length,
      text: chunk,
      source: "text",
      fileName: "",
      fileIndex: 0
    }));

  const selection = Material.selectChunksForPrompt(chunks, prompt, {
    maxChunks: chunkBudgetForCount(questionCount),
    maxChars: MAX_MATERIAL_CHARS
  });

  return buildPlan({
    source: "text",
    chunks,
    selected: selection.selected,
    strategy: selection.strategy,
    headings: [],
    requested: selection.requested,
    fileName: "",
    fileIndex: 0,
    fileCount: 1,
    fileChoiceReason: "single",
    suspectFontEncoding: Material.mojibakeRatio(text.slice(0, 6000)) > 0.65
  });
}

// Обирає одну книгу з-поміж завантажених. Пріоритет:
//   1. файл, названий у запиті («з другої книги», «файл 2»);
//   2. файл, у якому є названа тема (заголовок «1.2»);
//   3. файл із найбільшим збігом ключових слів;
//   4. найновіший завантажений файл.
function pickMaterialGroup(groups, prompt) {
  const list = Array.isArray(groups) ? groups : [];

  if (list.length <= 1) {
    return {
      group: list[0] || { chunks: [], fileName: "", fileIndex: 0 },
      reason: "single"
    };
  }

  const requested = Material.extractRequestedSections(prompt);

  for (const group of list) {
    if (requested.fileMentions.includes(group.fileIndex + 1)) {
      return { group, reason: "mentioned" };
    }
  }

  if (requested.sections.length || requested.chapters.length) {
    let best = null;

    list.forEach((group) => {
      const score = Material.scoreFileForPrompt(group.chunks, prompt);

      if (score.headingPages > 0 && (!best || score.headingPages > best.headingPages)) {
        best = { group, headingPages: score.headingPages };
      }
    });

    if (best) {
      return { group: best.group, reason: "section" };
    }
  }

  if (requested.keywords.length) {
    let best = null;

    list.forEach((group) => {
      const score = Material.scoreFileForPrompt(group.chunks, prompt);

      if (!best || score.keywordHits > best.keywordHits) {
        best = { group, keywordHits: score.keywordHits };
      }
    });

    const newest = list[list.length - 1];
    const newestScore = Material.scoreFileForPrompt(newest.chunks, prompt);

    // Ключові слова перемагають «найновіший файл» лише коли збіг справді
    // змістовний: або ≥2 збіги, або в найновішому файлі збігів немає зовсім.
    const meaningful = best && (
      best.keywordHits >= 2 ||
      newestScore.keywordHits === 0
    );

    if (meaningful && best.group.fileIndex !== newest.fileIndex) {
      return { group: best.group, reason: "keywords" };
    }

    if (best && best.keywordHits > 0 && best.group.fileIndex === newest.fileIndex) {
      return { group: best.group, reason: "keywords" };
    }
  }

  // Найновіший завантажений файл — найімовірніше саме його мав на увазі користувач.
  return { group: list[list.length - 1], reason: "latest" };
}

function splitPlainText(text, maxChars) {
  const value = String(text || "");

  if (value.length <= maxChars) {
    return value ? [value] : [];
  }

  const chunks = [];
  let current = "";

  value.split(/\n{2,}/).forEach((paragraph) => {
    const block = paragraph.trim();

    if (!block) {
      return;
    }

    if (current && current.length + block.length + 2 > maxChars) {
      chunks.push(current);
      current = block;
      return;
    }

    current = current ? `${current}\n\n${block}` : block;
  });

  if (current) {
    chunks.push(current);
  }

  // Якщо абзаців немає — ріжемо жорстко, щоб не перевищити ліміт.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars) {
      return [chunk];
    }

    const parts = [];

    for (let i = 0; i < chunk.length; i += maxChars) {
      parts.push(chunk.slice(i, i + maxChars));
    }

    return parts;
  });
}

function chunkBudgetForCount(questionCount) {
  const count = Number(questionCount || 0);

  if (count >= 20) {
    return MAX_MATERIAL_CHUNKS;
  }

  if (count >= 10) {
    return Math.min(MAX_MATERIAL_CHUNKS, 3);
  }

  return 2;
}

function buildPlan({
  source,
  chunks,
  selected,
  strategy,
  headings,
  requested,
  fileName,
  fileIndex,
  fileCount,
  fileNames,
  fileChoiceReason,
  suspectFontEncoding
}) {
  const effectiveSelected = selected.length
    ? selected
    : chunks.slice(0, 1);
  const previewText = effectiveSelected
    .map((chunk) => chunk.text)
    .join("\n\n")
    .slice(0, 900);

  return {
    source,
    chunks,
    selected: effectiveSelected,
    totalChunks: chunks.length,
    strategy,
    headings,
    requested,
    fileName: fileName || "",
    fileIndex: Number(fileIndex || 0),
    fileCount: Number(fileCount || 1),
    fileNames: Array.isArray(fileNames) ? fileNames : [],
    fileChoiceReason: fileChoiceReason || "single",
    suspectFontEncoding,
    partial: effectiveSelected.length < chunks.length,
    previewText
  };
}

// ─── Маршрутизація по карті документа ───────────────────────────────────────
//
// Проблема: у книзі на 368 сторінок у модель потрапляло 2–3 частини з 53
// (близько 3% тексту). Для будь-якого великого PDF це означає, що більшість
// розділів модель узагалі не бачить, тож питання беруться з випадкового місця.
//
// Рішення: система сама будує «зміст» книги (структурний, без прив'язки до
// конкретного підручника), надсилає його моделі одним дешевим запитом і далі
// бере ті розділи, які модель обрала. Так працює будь-який PDF будь-якого
// предмета, а не тільки знайомі книги.

// З якого обсягу текст не влазить в один запит і потрібна карта.
const OUTLINE_ROUTE_MIN_CHARS = 40000;

// Скільки символів карти максимум надсилаємо (щоб не з'їсти бюджет).
const OUTLINE_MAX_CHARS = 14000;

// Скільки частин максимум беремо за вибором моделі.
const OUTLINE_MAX_CHUNKS = 8;

function shouldRouteByOutline(materialPages, plan) {
  if (plan?.dialogOnly || !Array.isArray(materialPages)) {
    return false;
  }

  // Локальний алгоритм уже точно знайшов названу тему («тема 1.2»,
  // «§ 14») — це точніше за будь-яку карту, тож не чіпаємо.
  const requested = plan?.requested || {};
  const namedTopic =
    (Array.isArray(requested.sections) && requested.sections.length > 0) ||
    (Array.isArray(requested.chapters) && requested.chapters.length > 0);
  const preciseStrategy = ["paragraph", "section", "chapter"].includes(plan?.strategy);

  if (namedTopic && preciseStrategy && plan?.selected?.length) {
    return false;
  }

  const chars = materialPages.reduce(
    (sum, page) => sum + String(page?.text || "").length,
    0
  );

  // Маленький матеріал і так влазить цілком — карта не потрібна.
  return chars >= OUTLINE_ROUTE_MIN_CHARS;
}

async function routeByOutline({ materialPages, plan, prompt, questionCount, config }) {
  const pages = Array.isArray(materialPages) ? materialPages : [];
  const outline = Material.buildDocumentOutline(pages, { maxHeadings: 400 });

  // Заголовків не знайшли (суцільний текст без структури) — лишаємо
  // звичайний вибір, щоб не витрачати виклик на порожню карту.
  if (outline.length < 2) {
    return { plan, outline: [], routed: false };
  }

  const outlineText = Material.formatOutlineForModel(outline, {
    maxChars: OUTLINE_MAX_CHARS
  });

  if (!outlineText) {
    return { plan, outline, routed: false };
  }

  const question = buildOutlinePrompt(outlineText, prompt, plan);
  let picked = [];

  try {
    const response = await callProvider(config, question, []);
    picked = Material.parseOutlineSelection(
      extractOutlineAnswer(response),
      outline.length
    );
  } catch (error) {
    imageWarn(
      "Не вдалося вибрати розділи за картою документа, використано звичайний вибір",
      error?.message || error
    );

    return { plan, outline, routed: false };
  }

  if (!picked.length) {
    return { plan, outline, routed: false };
  }

  // Частини з обраних розділів + ті, що вже вибрав локальний алгоритм:
  // якщо локальний вибір уточнює тему, втрачати його не можна.
  const byOutline = Material.chunksForOutlineItems(plan.chunks, outline, picked);
  const merged = [];
  const budget = Math.max(
    OUTLINE_MAX_CHUNKS,
    chunkBudgetForCount(questionCount)
  );
  let usedChars = 0;

  [...plan.selected, ...byOutline].forEach((chunk) => {
    if (merged.length >= budget || merged.includes(chunk)) {
      return;
    }

    if (merged.length && usedChars + chunk.chars > MAX_MATERIAL_CHARS * 3) {
      return;
    }

    merged.push(chunk);
    usedChars += chunk.chars;
  });

  if (!merged.length) {
    return { plan, outline, routed: false };
  }

  merged.sort((left, right) => left.index - right.index);

  return {
    outline,
    routed: true,
    picked,
    plan: buildPlan({
      source: plan.source,
      chunks: plan.chunks,
      selected: merged,
      strategy: "outline",
      headings: plan.headings,
      requested: plan.requested,
      fileName: plan.fileName,
      fileIndex: plan.fileIndex,
      fileCount: plan.fileCount,
      fileNames: plan.fileNames,
      fileChoiceReason: plan.fileChoiceReason,
      suspectFontEncoding: plan.suspectFontEncoding
    })
  };
}

// Запит до моделі: ось зміст книги — скажи, які розділи потрібні.
function buildOutlinePrompt(outlineText, prompt, plan) {
  return `Тобі дано ЗМІСТ навчального матеріалу (${plan.fileName || "файл"}).
Треба скласти тест за запитом користувача.

ЗМІСТ:
${outlineText}

Запит користувача:
${prompt || "Створи питання за матеріалом."}

Вибери зі змісту ТІЛЬКИ ті розділи, які потрібні для цього запиту.
Якщо запит стосується всієї книги — вибери всі розділи.
Якщо запит називає конкретну тему — вибери лише відповідні розділи.

Відповідай ТІЛЬКИ JSON без пояснень:
{"sections": [1, 3, 5]}

Числа — це номери у квадратних дужках зі змісту.`;
}

// Модель може відповісти і JSON-ом, і простим переліком номерів.
function extractOutlineAnswer(response) {
  const direct = response?.sections ?? response?.outline ?? response?.chapters;

  if (direct !== undefined) {
    return direct;
  }

  const reply = String(response?.chat_reply || "").trim();
  const jsonMatch = reply.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);

      return parsed?.sections ?? parsed?.outline ?? parsed?.chapters ?? "";
    } catch (error) {
      // Не JSON — нижче спробуємо витягти номери з тексту.
    }
  }

  return reply;
}

function emptyPlan(source) {
  return {
    source,
    chunks: [],
    selected: [],
    totalChunks: 0,
    strategy: "empty",
    headings: [],
    requested: { sections: [], pages: [], keywords: [] },
    suspectFontEncoding: false,
    partial: false,
    dialogOnly: true,
    previewText: ""
  };
}

// Коли матеріалу немає, але користувач написав запит — це діалог.
// Модель має відповісти текстом (chat_reply) і НЕ вигадувати тест.
function buildDialogPlan() {
  return {
    source: "none",
    chunks: [],
    selected: [
      {
        index: 0,
        pages: [],
        pageFrom: 0,
        pageTo: 0,
        chars: 0,
        source: "none",
        text: "[Навчальні матеріали не додані. Доступний лише текст запиту користувача.]"
      }
    ],
    totalChunks: 0,
    strategy: "dialog",
    headings: [],
    requested: { sections: [], pages: [], keywords: [] },
    suspectFontEncoding: false,
    partial: false,
    dialogOnly: true,
    previewText: ""
  };
}

function describePlan(plan) {
  return {
    source: plan.source,
    totalChunks: plan.totalChunks,
    selectedChunks: plan.selected.length,
    strategy: plan.strategy,
    fileName: plan.fileName || "",
    fileCount: plan.fileCount || 1,
    fileNames: Array.isArray(plan.fileNames) ? plan.fileNames : [],
    fileChoiceReason: plan.fileChoiceReason || "single",
    partial: plan.partial,
    suspectFontEncoding: plan.suspectFontEncoding,
    pages: plan.selected.map((chunk) => ({
      from: chunk.pageFrom,
      to: chunk.pageTo
    }))
  };
}

// Скільком розділам книги модель дала питання й чи покрито всю книгу.
// Потрібно, щоб користувач бачив, що система справді читала всю книгу.
function describeOutlineCoverage(plan, outline) {
  const items = Array.isArray(outline) ? outline : [];

  if (!items.length || !plan?.chunks?.length) {
    return null;
  }

  const totalChars = plan.chunks.reduce(
    (sum, chunk) => sum + Number(chunk.chars || 0),
    0
  );
  const usedChars = (Array.isArray(plan.selected) ? plan.selected : []).reduce(
    (sum, chunk) => sum + Number(chunk.chars || 0),
    0
  );

  return {
    sections: items.length,
    selectedSections: (Array.isArray(plan.selected) ? plan.selected : []).length,
    totalChars,
    usedChars,
    ratio: totalChars ? usedChars / totalChars : 0
  };
}

// Вирівнює позиції правильних відповідей.
//
// Дві проблеми, які це лікує:
//   1) модель ставить правильну відповідь першою в усіх питаннях — учень
//      угадує за номером варіанта;
//   2) позиції правильних відповідей нерівномірні (напр. 6 з 10 на позиції 0).
//
// Для парних i зсуваємо варіанти по колу: позиція правильної відповіді
// змінюється, а її текст — ні. Якщо модель уже розподілила позиції добре,
// список не чіпаємо.
function distributeCorrectPositions(questions) {
  if (!Array.isArray(questions) || questions.length < 3) {
    return questions;
  }

  const positions = questions.map((question) => {
    const answers = Array.isArray(question?.answers) ? question.answers : [];
    const correct = Array.isArray(question?.correct) ? question.correct : [];
    const maxIndex = answers.length
      ? answers.length - 1
      : correct.reduce((top, item) => Math.max(top, Number(item) || 0), 0);

    if (!correct.length || maxIndex < 1) {
      return null;
    }

    return (Number(correct[0]) || 0) / maxIndex;
  });

  const known = positions.filter((value) => value !== null);

  if (known.length < 3) {
    return questions;
  }

  // Частка питань, де правильна відповідь стоїть на першій позиції.
  const firstShare = known.filter((value) => value === 0).length / known.length;

  if (firstShare < 0.5) {
    return questions;
  }

  return questions.map((question, index) => {
    const answers = Array.isArray(question?.answers) ? question.answers : [];

    if (answers.length < 2 || index === 0) {
      return question;
    }

    // Зсуваємо масив праворуч на shift: варіант з індексом i переїжджає
    // в (i + shift) % length. Отже кожен правильний індекс збільшується
    // на shift за модулем — і текст відповіді лишається тим самим.
    const shift = index % answers.length;
    const rotated = answers.map((_, position) => {
      return answers[(position - shift + answers.length) % answers.length];
    });
    const correct = (Array.isArray(question?.correct) ? question.correct : [])
      .map((value) => (Number(value) || 0) + shift)
      .map((value) => value % answers.length)
      .sort((left, right) => left - right);

    return {
      ...question,
      answers: rotated,
      correct
    };
  });
}

// Сумісність зі старим імʼям.
function balanceCorrectPositions(questions) {
  return distributeCorrectPositions(questions);
}

// Модель може повернути повний список питань для кожної частини —
// тому склеюємо все, прибираємо дублікати за текстом питання
// і не віддаємо більше, ніж просив користувач.
function mergeRawQuestions(aiResponses, limit) {
  const merged = [];
  const seen = new Set();
  const max = Number(limit || 0);

  (Array.isArray(aiResponses) ? aiResponses : []).forEach((item) => {
    const list = Array.isArray(item?.response?.questions)
      ? item.response.questions
      : [];

    list.forEach((question) => {
      if (max && merged.length >= max) {
        return;
      }

      const key = String(question?.question || "")
        .toLowerCase()
        .replace(/[^\wА-Яа-яІіЇїЄєҐґ]+/gu, "")
        .slice(0, 160);

      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      merged.push({ ...question, materialPart: item.chunk?.index });
    });
  });

  return merged;
}

// Розподіляє бажану кількість питань між частинами матеріалу.
function distributeCount(total, parts) {
  const count = Math.max(1, Number(total || 0));
  const share = Math.floor(count / parts);
  let remainder = count - share * parts;

  return Array.from({ length: parts }, () => {
    const value = share + (remainder > 0 ? 1 : 0);

    if (remainder > 0) {
      remainder--;
    }

    return value;
  });
}

// Тестовий шов: дозволяє автотестам отримати внутрішні функції.
// У Chrome Service Worker нічого не робить без явного виклику.
if (typeof globalThis !== "undefined") {
  globalThis.__QuizGenTestHooks = {
    backgroundVersion: 1,
    blobToDataUrl,
    bytesToBase64,
    resolveQuestionImages,
    downloadExternalImage,
    rasterizeIllustration,
    detectImageIntentSafely,
    inferImageKindSafely,
    safeHost,
    truncateText,
    generateQuestions,
    buildPrompt,
    planMaterial,
    assessMaterialQuality,
    mergeRawQuestions,
    balanceCorrectPositions,
    distributeCorrectPositions,
    shouldRouteByOutline,
    routeByOutline,
    buildOutlinePrompt,
    extractOutlineAnswer,
    describeOutlineCoverage,
    distributeCount,
    splitPlainText,
    setImageDebugEnabled(value) {
      imageDebugEnabled = Boolean(value);
      imageDebugLoaded = true;
    }
  };
}

function sanitizeCurrentQuestions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      return {
        number: index + 1,
        type: String(item.type || "quiz"),
        question: String(item.question || "").trim(),
        answers: Array.isArray(item.answers)
          ? item.answers
              .map((answer) => {
                if (typeof answer === "string") {
                  return answer.trim();
                }

                if (answer && typeof answer === "object") {
                  return String(
                    answer.text ||
                    answer.value ||
                    answer.title ||
                    ""
                  ).trim();
                }

                return "";
              })
              .filter(Boolean)
          : [],
        correct: Array.isArray(item.correct) ? item.correct : [0],
        difficulty: normalizeDifficulty(item.difficulty),
        imageSourceId: String(item.imageSourceId || "").trim(),
        sourceTestTitle: String(item.sourceTestTitle || "").trim(),
        sourceQuestionNumber: item.sourceQuestionNumber || index + 1
      };
    })
    .filter((item) => {
      return item && item.question && item.answers.length >= 2;
    });
}

function normalizeSourceImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = [];
  const usedIds = new Set();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const id = String(item.id || "").trim();
    const dataUrl = String(item.dataUrl || "").trim();

    if (
      !id ||
      !dataUrl.startsWith("data:image/") ||
      usedIds.has(id)
    ) {
      continue;
    }

    usedIds.add(id);

    result.push({
      id,
      dataUrl,
      mimeType: String(
        item.mimeType ||
        getMimeTypeFromDataUrl(dataUrl)
      ),
      fileName: String(item.fileName || "Навчальний матеріал"),
      page: Number(item.page || 0),
      width: Number(item.width || 0),
      height: Number(item.height || 0)
    });

    if (result.length >= MAX_SOURCE_IMAGES) {
      break;
    }
  }

  return result;
}

function buildPrompt({
  material,
  materialSource,
  materialPart,
  dialogOnly,
  prompt,
  questionCount,
  questionCountRequested,
  questionTypes,
  currentQuestions,
  sourceImages,
  allowImages
}) {
  const hasCurrentQuestions = currentQuestions.length > 0;
  const imagesAllowed = allowImages !== false;
  const language = Images.detectQuestionLanguage(`${prompt}\n${material}`);
  const languageName = language === "en" ? "English" : "українська";
  const languageRule = language === "en"
    ? "Question text, captions, table headers and answer options must be in English."
    : "Текст питань, підписи, таблиці та варіанти відповідей — українською.";

  const imageCatalog = sourceImages.length
    ? sourceImages
        .map((image) => {
          const location = image.page
            ? `${image.fileName}, сторінка ${image.page}`
            : image.fileName;

          return `- ${image.id}: ${location}`;
        })
        .join("\n")
    : "Немає доступних окремих зображень із матеріалу.";

  const questionCountLine = questionCountRequested
    ? `Користувач явно вказав кількість питань: ${questionCount}.`
    : `Кількість питань, якщо ти генеруєш тест: приблизно ${questionCount}.`;

  const imageRules = imagesAllowed
    ? `
Правила зображень:
- Додавай зображення лише коли воно справді потрібне для перевірки знань, а не до кожного питання.
- Якщо в питанні є зображення (needsImage=true), текст питання ОБОВ'ЯЗКОВО має посилатися на нього: «На рисунку зображено…», «Скористайтеся схемою…», «За таблицею визначте…». Питання без такого посилання не має сенсу, бо учень бачить лише малюнок.
- Не переказуй у тексті питання все, що видно на зображенні: частину інформації учень має взяти саме з малюнка (кути, підписи, значення, позначення).
- imageKind: "none" | "photo" | "geometry" | "equation" | "diagram" | "table" | "labeling".
- ГЕОМЕТРІЯ (трикутники, кути, кола, чотирикутники, паралельні прямі, координатна площина): imageKind="geometry". Заповни geometrySpec JSON-рядком (figure, points, sideLabels, angleLabels, rightAngle, equation).
- ФОРМУЛИ фізики, хімії та АЛГЕБРИ (скорочене множення, теорема, закон, хімічна сполука): imageKind="equation", у geometrySpec.equation запиши саму формулу (наприклад "a² − b² = (a − b)(a + b)", "v = s / t", "I = U / R", "H2SO4").
- ГРАФІКИ функцій і залежностей: imageKind="geometry" з geometrySpec.figure="graph". Для functions вкажи тип: "line" (a, b), "parabola" (a, b, c), "hyperbola" (k), "abs" (a, b), "cubic" (a, b, c), "sqrt" (a, b). Додай grid=true, якщо потрібна координатна сітка, і points для позначених точок.
- Таблиці з пропусками: imageKind="table", diagramSpec з headers і rows; порожні клітинки як "___".
- Підписування частин (клітина, органи, деталі, кресленик): imageKind="labeling", diagramSpec.parts з showName=false; у тексті питання залиш пропуски/номери; варіанти відповідей — підписи до пропусків.
- КАРТИ (географія, історія): imageKind="photo" і точний англійський запит, наприклад "map of rivers of Ukraine", "map of Kievan Rus". Карту НЕ можна намалювати схемою — потрібне справжнє зображення.
- Біологія, тварини, рослини, органи, географічні об'єкти, історичні події, портрети історичних постатей, мистецтво: imageKind="photo". Заповни imageSearchQuery мовою питання та точний imageSearchQueryEn англійською.
- Іноземні мови: для лексики (показати предмет, тварину, дію на малюнку) — imageKind="photo" з конкретним іменником англійською ("kitchen appliance", "animal photo"). Для граматики, правопису й перекладу — needsImage=false, imageKind="none".
- Не вигадуй підписи чи дані, яких немає в умові.
- Якщо відповідність зображення не гарантована, постав needsImage=false і imageKind="none".
- Якщо підходить зображення з каталогу матеріалу, запиши його imageSourceId.
- Не вигадуй URL. imageSource завжди "".
- needsImage=true лише разом із photo/geometry/equation/diagram/table/labeling.
- imageSearchQueryEn має бути КОНКРЕТНИМ англійським описом того, що видно на малюнку (не назвою теми й не переказом питання). Пиши його завжди латиницею.

Доступні окремі зображення з книги:
${imageCatalog}
`
    : `
Правила зображень (ЗАБОРОНА):
- DO NOT generate or suggest any images for this test.
- Для КОЖНОГО питання: needsImage=false, imageKind="none", imageSourceId="", imageSearchQuery="", imageSearchQueryEn="", imageAlt="", imageSource="", geometrySpec="", diagramSpec="".
- Не описуй зображення в тексті питання, не посилайся на малюнки, схеми, фото, таблиці-картинки чи графіки-картинки.
- Формулюй питання так, щоб їх можна було розв'язати без жодної ілюстрації (наприклад, усі потрібні числові дані — у тексті умови).
- Якщо без зображення питання не має сенсу — сформулюй інше питання на ту саму тему.
`

  const hasMaterial = Boolean(String(material || "").trim()) && !dialogOnly;

  return `
Ти — AI Quiz Generator: живий, уважний і доброзичливий асистент-методист для вчителів.
Ти ведеш природний діалог із користувачем і, коли маєш достатньо даних, створюєш тестові питання.

ГОЛОВНЕ ПРАВИЛО ВИБОРУ РЕЖИМУ:
${
  hasMaterial
    ? `Навчальний матеріал УЖЕ надано (див. блок «Навчальні матеріали» нижче).
Це означає РЕЖИМ 2 — ГЕНЕРАЦІЯ. Створи питання за цим матеріалом.
КАТЕГОРИЧНО ЗАБОРОНЕНО питати «з якого предмета?», «для якого класу?»,
«яка тема?» або просити додати матеріал: предмет і тема вже визначаються
з наданого тексту. Якщо чогось не вистачає — зроби розумне припущення
з матеріалу й одразу переходь до питань.`
    : `Навчальний матеріал НЕ надано.
Це означає РЕЖИМ 1 — ДІАЛОГ. Не створюй питань, відповідай у chat_reply
і з'ясуй, який предмет, клас і тема потрібні, або попроси додати матеріал.`
}

Твоя відповідь — завжди ОДИН JSON-об'єкт із двома полями:
- "chat_reply": твоя відповідь людиною. Порожній рядок, якщо говорити нічого не потрібно.
- "questions": масив тестових питань. Порожній масив, якщо питання ще не можна скласти.

Два режими роботи:

РЕЖИМ 1 — ДІАЛОГ (questions = [], chat_reply = твоя відповідь).
Застосовується ЛИШЕ коли навчального матеріалу немає:
- Користувач вітається, дякує, ставить загальне запитання, або просить "зроби тест" чи "згенеруй тест".
- У цьому випадку НЕ створюй питань. Привітайся природно і запитай, на яку тему, для якого класу та з якого предмета потрібен тест.
- Якщо в запиті є друкарські помилки або зміст незрозумілий — не вгадуй. Перепитай своїми словами, що саме мав на увазі користувач.
- Відповідай у тому ж стилі й тією ж мовою, що й користувач: як живий асистент, а не як форма.
- Будь емпатичним, коротким і конкретним. Став не більше 1–2 уточнювальних питань за раз.

РЕЖИМ 2 — ГЕНЕРАЦІЯ (questions = масив питань).
Застосовується ЗАВЖДИ, коли навчальний матеріал надано, або коли користувач
уже назвав тему, предмет і клас:
- Створи питання згідно з правилами нижче.
- Якщо користувач просив конкретну кількість питань — дотримуйся її.
- У "chat_reply" у цьому режимі зазвичай залишай порожній рядок або одну коротку робочу фразу.
- Якщо частину запиту написано з помилками — просто виконай його за змістом. Перепитувати НЕ потрібно, якщо загальний сенс зрозумілий.

Головне завдання зараз:
${
  hasCurrentQuestions
    ? "Виконай інструкцію користувача над поточними питаннями та поверни ПОВНИЙ оновлений список питань."
    : hasMaterial
      ? "Створи питання виключно за наданим навчальним матеріалом."
      : "Підтримай діалог: матеріалу ще немає, тож питань не створюй."
}

Правила редагування:
- Якщо користувач назвав номер питання, змінюй саме це питання.
- Якщо користувач просить видалити тему або не використовувати її, не повертай питань на цю тему.
- Якщо користувач просить переписати питання, поверни повний оновлений список, а не лише змінені питання.
- Якщо користувач просить додати нові питання до поточних, поверни повний список: старі питання + нові.
- Якщо користувач просить замінити питання, поверни тільки новий повний список після заміни.
- Якщо користувач просить легкі, середні та складні питання, дотримуйся вказаного розподілу.
- Якщо користувач просить розділ 2.1, 3.2 або іншу конкретну частину, використовуй саме цю частину матеріалу.
- Не вигадуй фактів, яких немає у матеріалі.

Правила формату:
- Мова тесту: ${languageName}.
- ${languageRule}
- Кожне питання повинно мати 4 варіанти відповіді, якщо користувач не просить інакше.
- Індекси правильних відповідей: 0-based.
- РОЗПОДІЛ ПРАВИЛЬНИХ ВІДПОВІДЕЙ: не став правильну відповідь завжди першою.
  Чергуй позиції (0, 1, 2, 3) між питаннями приблизно рівномірно, щоб учень
  не міг угадати за номером варіанта.
- Одна правильна відповідь: type = "quiz".
- Кілька правильних відповідей: type = "multiquiz". Використовуй multiquiz,
  коли завдання справді передбачає кілька правильних варіантів (виберіть усі,
  що належать, тощо). Кількість правильних може бути 2, 3, 4 або навіть усі
  варіанти — якщо всі відповіді правильні за умовою, це допустимо.
- Не роби всі питання тесту одного типу: обов'язково 2–3 питання зроби
  "multiquiz" (по 2–3 правильні відповіді в кожному), решту — "quiz".
- difficulty: "easy", "medium" або "hard".
- title має бути у форматі: "Тести N питань — коротка тема". У режимі діалогу title = "".
- Якщо користувач вказав клас, додай клас у title.
- Якщо тема визначається з матеріалу, використай цю тему в title.
- Поверни тільки JSON без markdown і пояснень.
${imageRules}
Типи питань:
${getTypeInstructions(questionTypes)}

Поточні питання:
${
  hasCurrentQuestions
    ? JSON.stringify(currentQuestions, null, 2)
    : "Поточних питань немає."
}

Запит користувача:
${prompt || "Створи питання за навчальними матеріалами."}

Навчальні матеріали:
${material || "[Текст матеріалу не додано]"}

Джерело матеріалу: ${materialSource || "наданий текст"}${materialPart ? ` (${materialPart})` : ""}
${
  dialogOnly
    ? `УВАГА: навчальні матеріали НЕ додані. Ти не маєш даних, щоб скласти тест,
тому questions ОБОВ'ЯЗКОВО має бути порожнім масивом. Відповідай користувачу
в chat_reply: привітайся, коротко з'ясуй предмет, клас і тему та підкажи, що
для точного тесту можна додати файл із матеріалом.`
    : `Матеріал надано — працюй із ним. Предмет, клас і тему визначай із самого
тексту, а не питай у користувача. Якщо в запиті є друкарські помилки —
виконай його за змістом, без перепитувань.

Матеріал уривчастий і може містити лише частину підручника. Складай питання
ВИКЛЮЧНО за наведеним текстом: якщо потрібної теми немає в уривку — не вигадуй
її, а сформулюй питання за тим, що є. Не посилайся на номери тем чи сторінок,
яких немає в уривку. Якщо текст містить символи, зіпсовані шрифтом PDF,
спирайся на зрозумілі фрагменти й не відтворюй зіпсовані символи у варіантах
відповідей.`
}

${questionCountLine}

Формат відповіді:
{
  "chat_reply": "Твоя відповідь користувачу (порожній рядок, якщо не потрібна)",
  "title": "Тести N питань — коротка тема",
  "questions": [
    {
      "type": "quiz",
      "question": "Текст питання",
      "answers": [
        "Варіант 1",
        "Варіант 2",
        "Варіант 3",
        "Варіант 4"
      ],
      "correct": [0],
      "difficulty": "medium",
      "needsImage": false,
      "imageKind": "none",
      "imageSourceId": "",
      "imageSearchQuery": "",
      "imageSearchQueryEn": "",
      "imageAlt": "",
      "imageSource": "",
      "geometrySpec": "",
      "diagramSpec": "",
      "language": "${language}"
    }
  ]
}

Приклад діалогової відповіді (питань ще немає, БЕЗ матеріалу):
{
  "chat_reply": "Вітаю! Із задоволенням складу тест. Підкажіть, будь ласка, предмет, клас і тему — і я одразу візьмуся до роботи.",
  "title": "",
  "questions": []
}
${
  hasMaterial
    ? `
Пам'ятай: матеріал УЖЕ додано, тому зараз потрібен РЕЖИМ 2.
Поверни заповнений масив questions і НЕ питай предмет, клас чи тему.`
    : ""
}
`.trim();
}
function getTypeInstructions(questionTypes) {
  if (questionTypes === "quiz") {
    return "Генеруй тільки quiz.";
  }

  if (questionTypes === "multiquiz") {
    return "Генеруй тільки multiquiz.";
  }

  return (
    "Дозволені і quiz, і multiquiz. " +
    "Обов'язково зроби 2–3 питання типу multiquiz (по 2–3 правильні відповіді " +
    "кожне) і решту — quiz. Не роби всі питання одним типом."
  );
}

async function callProvider(config, prompt, sourceImages) {
  if (config.provider === "openai") {
    return await callOpenAI(config, prompt, sourceImages);
  }

  if (config.provider === "gemini") {
    return await callGemini(config, prompt, sourceImages);
  }

  if (config.provider === "deepseek") {
    return await callDeepSeek(config, prompt, sourceImages);
  }

  if (config.provider === "manus") {
    return await callManus(config, prompt, sourceImages);
  }

  if (config.provider === "mistral") {
    return await callMistral(config, prompt, sourceImages);
  }

  throw new Error("Непідтримуваний AI-провайдер.");
}

// prefixV1 = false для провайдерів, у яких endpoint лежить у корені
// (наприклад, DeepSeek: https://api.deepseek.com/chat/completions).
function makeChatCompletionsUrl(baseUrl, prefixV1 = true) {
  const cleanBase = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");

  if (!cleanBase) {
    return prefixV1
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.deepseek.com/chat/completions";
  }

  if (cleanBase.endsWith("/chat/completions")) {
    return cleanBase;
  }

  if (cleanBase.endsWith("/v1")) {
    return `${cleanBase}/chat/completions`;
  }

  return prefixV1
    ? `${cleanBase}/v1/chat/completions`
    : `${cleanBase}/chat/completions`;
}

async function callOpenAI(config, prompt, sourceImages) {
  const url = makeChatCompletionsUrl(
    config.baseUrl || PROVIDER_DEFAULTS.openai.baseUrl
  );

  const userContent = [
    {
      type: "text",
      text: prompt
    }
  ];

  for (const image of sourceImages) {
    userContent.push({
      type: "text",
      text:
        `Зображення ${image.id}. ` +
        `Джерело: ${image.fileName}` +
        (image.page ? `, сторінка ${image.page}` : "") +
        "."
    });

    userContent.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "low"
      }
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: config.model || PROVIDER_DEFAULTS.openai.model,
      messages: [
        {
          role: "system",
          content: "Return valid JSON only. Do not include markdown."
        },
        {
          role: "user",
          content: userContent
        }
      ],
      temperature: 0.2,
      max_tokens: 6000,
      response_format: {
        type: "json_object"
      }
    })
  });

  const data = await readJson(response, "OpenAI");
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI повернув порожню відповідь.");
  }

  return parseJsonObject(content);
}

// DeepSeek: OpenAI-сумісний Chat Completions API.
// base_url = https://api.deepseek.com, endpoint = /chat/completions (без /v1).
// JSON Output: response_format = { "type": "json_object" } і слово "json" у промпті.
// Thinking вимкнено явно: для генерації тестів потрібна швидка детермінована
// відповідь (у thinking-режимі temperature ігнорується).
async function callDeepSeek(config, prompt, sourceImages) {
  const url = makeChatCompletionsUrl(
    config.baseUrl || PROVIDER_DEFAULTS.deepseek.baseUrl,
    false
  );

  const model = config.model || PROVIDER_DEFAULTS.deepseek.model;
  const supportsImages = DEEPSEEK_VISION_MODELS.includes(model);
  const userContent = [
    {
      type: "text",
      text: prompt
    }
  ];

  if (supportsImages) {
    for (const image of selectDeepSeekImages(sourceImages)) {
      userContent.push({
        type: "text",
        text:
          `Зображення ${image.id}. ` +
          `Джерело: ${image.fileName}` +
          (image.page ? `, сторінка ${image.page}` : "") +
          "."
      });

      userContent.push({
        type: "image_url",
        image_url: {
          url: image.dataUrl,
          detail: "low"
        }
      });
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Return valid JSON only. Do not include markdown. " +
            "The answer must be a single JSON object."
        },
        {
          role: "user",
          // DeepSeek очікує звичайний рядок, якщо зображень немає.
          content: userContent.length === 1 ? prompt : userContent
        }
      ],
      temperature: 0.2,
      max_tokens: 8000,
      response_format: {
        type: "json_object"
      },
      thinking: {
        type: "disabled"
      }
    })
  });

  const data = await readJson(response, "DeepSeek");
  const choice = data.choices?.[0];
  const content = choice?.message?.content;

  if (!content) {
    const reason = choice?.finish_reason
      ? ` (finish_reason: ${choice.finish_reason})`
      : "";

    throw new Error(
      `DeepSeek повернув порожню відповідь${reason}. ` +
      "Спробуйте повторити запит або зменшити кількість питань."
    );
  }

  return parseJsonObject(content);
}

// Обмежуємо сумарний розмір зображень, щоб не перевищити ліміт тіла
// запиту DeepSeek (48 MiB).
function selectDeepSeekImages(sourceImages) {
  const result = [];
  let totalBytes = 0;

  for (const image of sourceImages) {
    const size = estimateDataUrlBytes(image.dataUrl);

    if (totalBytes + size > MAX_DEEPSEEK_REQUEST_IMAGE_BYTES) {
      imageWarn(
        "зображення пропущено: перевищено ліміт розміру запиту DeepSeek",
        { id: image.id, size }
      );
      continue;
    }

    totalBytes += size;
    result.push(image);
  }

  return result;
}

function estimateDataUrlBytes(dataUrl) {
  const value = String(dataUrl || "");
  const base64 = value.slice(value.indexOf(",") + 1);

  if (!base64) {
    return 0;
  }

  return Math.floor((base64.length * 3) / 4);
}

async function callMistral(config, prompt, sourceImages) {
  const url = makeChatCompletionsUrl(
    config.baseUrl || PROVIDER_DEFAULTS.mistral.baseUrl
  );

  const userContent = [
    {
      type: "text",
      text: prompt
    }
  ];

  for (const image of sourceImages) {
    userContent.push({
      type: "text",
      text:
        `Зображення ${image.id}. ` +
        `Джерело: ${image.fileName}` +
        (image.page ? `, сторінка ${image.page}` : "") +
        "."
    });

    userContent.push({
      type: "image_url",
      image_url: image.dataUrl
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: config.model || PROVIDER_DEFAULTS.mistral.model,
      messages: [
        {
          role: "system",
          content: "Return valid JSON only. Do not include markdown."
        },
        {
          role: "user",
          content: userContent
        }
      ],
      temperature: 0.2,
      max_tokens: 6000,
      response_format: {
        type: "json_object"
      }
    })
  });

  const data = await readJson(response, "Mistral");
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Mistral повернув порожню відповідь.");
  }

  return parseJsonObject(content);
}

async function callGemini(config, prompt, sourceImages) {
  const model = config.model || PROVIDER_DEFAULTS.gemini.model;
  const geminiPrompt = `${prompt}

Додаткові правила зображень:
- Не всі питання повинні мати зображення.
- Геометрію і рівняння передавай через geometrySpec, не через photo.
- Для photo заповни imageSearchQueryEn конкретним англійським запитом.
- Якщо зображення не потрібне: needsImage=false, imageKind="none".
`.trim();

  const input = sourceImages.length
    ? [
        {
          type: "text",
          text: geminiPrompt
        }
      ]
    : geminiPrompt;

  for (const image of sourceImages) {
    const parsedImage = splitDataUrl(image.dataUrl);

    if (!parsedImage) {
      continue;
    }

    input.push({
      text:
        `Зображення ${image.id}. ` +
        `Джерело: ${image.fileName}` +
        (image.page ? `, сторінка ${image.page}` : "") +
        ".",
      type: "text"
    });

    input.push({
      type: "image",
      mime_type: parsedImage.mimeType,
      data: parsedImage.base64
    });
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model,
        input,
        store: false,
        generation_config: {
          max_output_tokens: 6000
        },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: GEMINI_QUESTION_SCHEMA
        }
      })
    }
  );

  const data = await readJson(response, "Gemini", true);

  const text = (Array.isArray(data.steps) ? data.steps : [])
    .filter((step) => step?.type === "model_output")
    .flatMap((step) =>
      Array.isArray(step.content)
        ? step.content
        : []
    )
    .filter((content) => content?.type === "text")
    .map((content) => content.text || "")
    .join("\n")
    .trim();

  if (!text) {
    const reason =
      data.error?.message ||
      data.status ||
      "порожня відповідь";

    throw new Error(`Gemini повернув порожню відповідь: ${reason}`);
  }

  return parseJsonObject(text);
}

function inferImageKindSafely(question) {
  try {
    return Images.inferImageKind(question);
  } catch (error) {
    imageWarn("не вдалося визначити тип зображення", error?.message || error);
    return "none";
  }
}

function detectImageIntentSafely(question) {
  try {
    if (typeof Images.detectImageIntent === "function") {
      const intent = Images.detectImageIntent(question);

      if (intent && typeof intent.kind === "string") {
        return {
          kind: intent.kind,
          reason: String(intent.reason || "")
        };
      }
    }
  } catch (error) {
    imageWarn("помилка визначення типу зображення", error?.message || error);
  }

  return {
    kind: inferImageKindSafely(question),
    reason: "тип визначено запасним способом"
  };
}

function addImageWarning(collector, message) {
  if (typeof collector !== "function") {
    return;
  }

  collector(message);
}

async function resolveQuestionImages(rawQuestions, sourceImages, options = {}) {
  const fetchImpl = typeof options.fetchImpl === "function"
    ? options.fetchImpl
    : (input, init) => fetch(input, init);
  const onWarning = typeof options.onWarning === "function"
    ? options.onWarning
    : null;
  // allowImages === false повністю вимикає і мережевий пошук фото,
  // і програмну генерацію SVG — жодне зображення не додається.
  const imagesAllowed = options.allowImages !== false;
  const questions = Array.isArray(rawQuestions) ? rawQuestions.map((item) => {
    return Images.applyBlankAnswers({ ...(item || {}) });
  }) : [];
  const resolvedImages = [...sourceImages];
  const sourceImageIds = new Set(
    resolvedImages.map((image) => image.id)
  );
  let externalImageCount = 0;
  let generatedImageCount = 0;

  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    // Запам'ятовуємо тип від моделі до того, як перезапишемо його рішенням системи.
    const modelImageKind = String(question.imageKind || "").trim().toLowerCase();
    // Рішення про тип зображення ухвалюється за змістом запитання,
    // а не лише за полем imageKind від моделі.
    const intent = detectImageIntentSafely(question);
    const kind = intent.kind;

    question.imageKind = kind;
    question.imageIntentReason = intent.reason;
    question.language = question.language || Images.detectQuestionLanguage(
      `${question.question || ""} ${question.imageAlt || ""}`
    );

    if (!imagesAllowed) {
      question.imageSourceId = "";
      question.imageKind = "none";
      question.needsImage = false;
      question.imageAlt = "";
      question.imageSource = "";
      question.imageSearchQuery = "";
      question.imageSearchQueryEn = "";
      imageLog(
        `Питання ${index + 1}: зображення вимкнено перемикачем (було type=${kind})`
      );
      continue;
    }

    imageLog(
      `Питання ${index + 1}: тип=${kind}`,
      {
        reason: intent.reason,
        needsImage: Boolean(question.needsImage),
        modelImageKind,
        question: truncateText(question.question, 80),
        searchQuery: truncateText(question.imageSearchQuery, 60),
        searchQueryEn: truncateText(question.imageSearchQueryEn, 60)
      }
    );

    const existingImageId = String(question.imageSourceId || "").trim();

    if (existingImageId && sourceImageIds.has(existingImageId)) {
      imageLog(`Питання ${index + 1}: використано зображення з матеріалу ${existingImageId}`);
      continue;
    }

    if (kind === "none") {
      question.imageSourceId = "";
      question.imageAlt = "";
      question.imageSource = "";
      imageLog(`Питання ${index + 1}: зображення не додано — ${intent.reason}`);
      continue;
    }

    if (Images.GENERATED_KINDS.has(kind)) {
      if (generatedImageCount >= MAX_GENERATED_IMAGES) {
        question.imageSourceId = "";
        imageLog(
          `Питання ${index + 1}: зображення не додано — досягнуто ліміт згенерованих ілюстрацій (${MAX_GENERATED_IMAGES})`
        );
        addImageWarning(
          onWarning,
          `Схеми: досягнуто ліміт ${MAX_GENERATED_IMAGES} згенерованих ілюстрацій.`
        );
        continue;
      }

      const illustration = Images.renderQuestionIllustration(question);

      if (!illustration) {
        question.imageSourceId = "";
        imageLog(
          `Питання ${index + 1}: зображення не додано — генератор не підтримує тип ${kind}`
        );
        addImageWarning(
          onWarning,
          `Ілюстрацію для типу «${kind}» не створено (генератор не підтримує цей тип).`
        );
        continue;
      }

      // Питання має посилатися на ілюстрацію, інакше учень бачить малюнок,
      // з якого не випливає запитання.
      if (typeof Images.ensureImageReference === "function") {
        const referenced = Images.ensureImageReference(
          question,
          kind,
          question.language
        );

        if (referenced && referenced !== question.question) {
          imageLog(`Питання ${index + 1}: додано посилання на ілюстрацію в тексті`);
          question.question = referenced;
        }
      }

      const raster = await rasterizeIllustration(illustration);
      const imageId = `generated_image_${Date.now()}_${index}`;

      resolvedImages.push({
        id: imageId,
        dataUrl: raster.dataUrl,
        mimeType: raster.mimeType,
        fileName: illustration.alt,
        page: 0,
        width: 0,
        height: 0,
        alt: illustration.alt,
        sourceUrl: illustration.sourceUrl
      });

      sourceImageIds.add(imageId);
      question.imageSourceId = imageId;
      question.imageAlt = illustration.alt;
      question.imageSource = illustration.sourceUrl;
      question.needsImage = true;
      generatedImageCount++;
      imageLog(
        `Питання ${index + 1}: додано згенеровану ілюстрацію (${kind}, ${raster.mimeType})`,
        { sourceUrl: illustration.sourceUrl, id: imageId }
      );
      continue;
    }

    if (kind !== "photo") {
      question.imageSourceId = "";
      imageLog(`Питання ${index + 1}: зображення не додано — тип ${kind} не підтримується`);
      continue;
    }

    // Сюди потрапляють лише типи, для яких фото доречне (біологія, географія,
    // історія тощо). Геометрія й рівняння відсікаються вище і ніколи не
    // запускають мережевий пошук.
    const englishQuery = String(question.imageSearchQueryEn || "").trim();

    if (englishQuery.length < 3) {
      question.imageSourceId = "";
      imageLog(
        `Питання ${index + 1}: зображення не додано — немає надійного англійського пошукового запиту (imageSearchQueryEn)`
      );
      addImageWarning(
        onWarning,
        "Зображення не додано: модель не дала надійного пошукового запиту."
      );
      continue;
    }

    if (externalImageCount >= MAX_EXTERNAL_IMAGES) {
      question.imageSourceId = "";
      imageLog(
        `Питання ${index + 1}: зображення не додано — досягнуто ліміт зовнішніх зображень (${MAX_EXTERNAL_IMAGES})`
      );
      addImageWarning(
        onWarning,
        `Зображення: досягнуто ліміт ${MAX_EXTERNAL_IMAGES} зовнішніх зображень.`
      );
      continue;
    }

    try {
      const found = await Images.findRelevantPhoto(
        question,
        fetchImpl,
        (diagnostics) => {
          imageLog(
            `Питання ${index + 1}: пошук «${truncateText(diagnostics.searchTerm, 60)}»`,
            {
              мовніЗапити: diagnostics.queries?.english || [],
              вихідніЗапити: diagnostics.queries?.original || [],
              знайдено: diagnostics.candidatesFound
            }
          );
          logCandidateList(diagnostics.ranked || []);

          if (diagnostics.outcome === "chosen") {
            imageLog("  рішення: кандидат прийнято", {
              title: truncateText(diagnostics.chosen?.title, 60),
              score: Number(diagnostics.chosen?.score || 0).toFixed(3)
            });
          }
        }
      );

      if (!found?.downloadUrl) {
        question.imageSourceId = "";
        imageLog(
          `Питання ${index + 1}: зображення не додано — придатний кандидат не знайдений`
        );
        addImageWarning(
          onWarning,
          "Зображення не додано: серед знайдених немає достатньо релевантного."
        );
        continue;
      }

      const image = await downloadExternalImage(
        found.downloadUrl,
        fetchImpl,
        found.mimeType,
        found.title,
        question.imageAlt || found.title,
        found.sourceUrl
      );

      if (!image) {
        question.imageSourceId = "";
        imageLog(
          `Питання ${index + 1}: зображення не додано — файл відхилено (хост, MIME або розмір)`,
          { host: safeHost(found.downloadUrl) }
        );
        addImageWarning(
          onWarning,
          "Зображення не додано: файл джерела не пройшов перевірку (хост, тип або розмір)."
        );
        continue;
      }

      const imageId = `web_image_${Date.now()}_${index}`;

      resolvedImages.push({
        ...image,
        id: imageId
      });

      sourceImageIds.add(imageId);
      question.imageSourceId = imageId;
      question.imageAlt = image.alt;
      question.imageSource = image.sourceUrl;
      question.needsImage = true;
      externalImageCount++;
      imageLog(
        `Питання ${index + 1}: додано зовнішнє зображення (${image.mimeType})`,
        { sourceUrl: image.sourceUrl, id: imageId }
      );
    } catch (error) {
      question.imageSourceId = "";
      imageWarn(
        `Питання ${index + 1}: помилка пошуку або завантаження зображення`,
        error?.message || error
      );
      addImageWarning(
        onWarning,
        `Помилка зображення: ${error?.message || "невідома помилка"}`
      );
    }
  }

  // Фінальна перевірка: будь-яке питання, яке отримало зображення (з
  // матеріалу, з мережі або згенероване), мусить посилатися на нього
  // в тексті. Інакше учень бачить малюнок, який не пов'язаний із запитанням.
  if (imagesAllowed && typeof Images.ensureImageReference === "function") {
    questions.forEach((question, index) => {
      if (!String(question.imageSourceId || "").trim()) {
        return;
      }

      const before = String(question.question || "");

      if (Images.questionReferencesImage(question)) {
        return;
      }

      const referenced = Images.ensureImageReference(
        question,
        question.imageKind,
        question.language
      );

      if (referenced && referenced !== before) {
        question.question = referenced;
        imageLog(`Питання ${index + 1}: додано посилання на зображення (фінальна перевірка)`);
      }
    });
  }

  return {
    questions,
    sourceImages: resolvedImages
  };
}

async function rasterizeIllustration(illustration) {
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return {
      dataUrl: illustration.dataUrl,
      mimeType: illustration.mimeType
    };
  }

  try {
    const blob = new Blob([illustration.svg], {
      type: "image/svg+xml;charset=utf-8"
    });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(
      bitmap.width || 420,
      bitmap.height || 300
    );
    const context = canvas.getContext("2d");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const png = await canvas.convertToBlob({
      type: "image/png"
    });

    return {
      dataUrl: await blobToDataUrl(png, "image/png"),
      mimeType: "image/png"
    };
  } catch (error) {
    // Растеризація не вдалася — це не помилка генерації: SVG data-URL
    // лишається придатним для показу в popup.
    imageWarn(
      "SVG не вдалося растеризувати, використано SVG data URL",
      error?.message || error
    );

    return {
      dataUrl: illustration.dataUrl,
      mimeType: illustration.mimeType
    };
  }
}

// fetchImpl передається завжди явно (прив'язка параметра, а не неявне
// звернення до глобального fetch), щоб шлях завантаження можна було
// підмінити в тестах і щоб не було двох різних джерел fetch.
async function downloadExternalImage(
  imageUrl,
  fetchImpl,
  fallbackMimeType,
  title,
  imageAlt,
  sourceUrl
) {
  if (!Images.allowedImageUrl(imageUrl)) {
    return null;
  }

  const response = await fetchImpl(imageUrl, {
    headers: {
      Accept: "image/*"
    }
  });

  if (!response.ok) {
    return null;
  }

  if (!Images.allowedImageUrl(response.url || imageUrl)) {
    return null;
  }

  const contentType = String(
    response.headers.get("Content-Type") || fallbackMimeType
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (!contentType.startsWith("image/")) {
    return null;
  }

  // Читаємо через arrayBuffer(): FileReader у Service Worker недоступний,
  // а response.blob() дає Blob, який не має де взяти base64 без нього.
  const rawBuffer = await response.arrayBuffer();

  if (!rawBuffer || !rawBuffer.byteLength) {
    return null;
  }

  if (rawBuffer.byteLength > MAX_EXTERNAL_IMAGE_BYTES) {
    return null;
  }

  const mimeType = contentType;
  const dataUrl = await blobToDataUrl(
    new Blob([rawBuffer], {
      type: mimeType
    }),
    mimeType
  );

  return {
    dataUrl,
    mimeType,
    fileName: String(title || "Educational image"),
    page: 0,
    width: 0,
    height: 0,
    alt: String(imageAlt || title || "Навчальне зображення").trim(),
    sourceUrl
  };
}

// Base64-таблиця для перетворення байтів у data URL без FileReader:
// у MV3 Service Worker FileReader недоступний, тому використовуємо
// arrayBuffer() + власне base64-кодування.
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes) {
  let result = "";
  let index = 0;
  const length = bytes.length || 0;

  while (index < length) {
    const byte1 = bytes[index++] & 0xff;
    const byte2 = index < length ? bytes[index++] & 0xff : NaN;
    const byte3 = index < length ? bytes[index++] & 0xff : NaN;
    const hasByte2 = !Number.isNaN(byte2);
    const hasByte3 = !Number.isNaN(byte3);
    const chunk =
      (byte1 << 16) |
      ((hasByte2 ? byte2 : 0) << 8) |
      (hasByte3 ? byte3 : 0);

    result += BASE64_ALPHABET.charAt((chunk >> 18) & 63);
    result += BASE64_ALPHABET.charAt((chunk >> 12) & 63);
    result += hasByte2
      ? BASE64_ALPHABET.charAt((chunk >> 6) & 63)
      : "=";
    result += hasByte3
      ? BASE64_ALPHABET.charAt(chunk & 63)
      : "=";
  }

  return result;
}

async function blobToDataUrl(blob, mimeTypeOverride) {
  if (!blob || typeof blob.arrayBuffer !== "function") {
    throw new Error(
      "Не вдалося прочитати зображення: об'єкт не є Blob із підтримкою arrayBuffer()."
    );
  }

  const buffer = await blob.arrayBuffer();

  if (!buffer || !buffer.byteLength) {
    throw new Error("Завантажене зображення порожнє.");
  }

  // Buffer може бути view у більшому ArrayBuffer — беремо лише свої байти,
  // інакше в data URL потрапив би сторонній вміст.
  const bytes =
    typeof buffer.byteOffset === "number" && buffer.byteOffset > 0
      ? new Uint8Array(buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(
          buffer.buffer || buffer,
          buffer.byteOffset || 0,
          buffer.byteLength
        );

  const mimeType = String(
    mimeTypeOverride || blob.type || "application/octet-stream"
  ).trim() || "application/octet-stream";

  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

async function callManus(config, prompt, sourceImages) {
  const created = await createManusTask(
    config,
    prompt,
    QUESTION_SCHEMA,
    sourceImages
  );

  return await pollManusResult(
    created.baseUrl,
    config.apiKey,
    created.taskId
  );
}

async function createManusTask(config, prompt, schema, sourceImages) {
  const baseUrl = (
    config.baseUrl || PROVIDER_DEFAULTS.manus.baseUrl
  ).replace(/\/+$/, "");

  const content = [
    {
      type: "text",
      text: prompt
    }
  ];

  for (const image of sourceImages) {
    const fileId = await uploadManusImage(
      baseUrl,
      config.apiKey,
      image
    );

    content.push({
      type: "text",
      text:
        `Зображення ${image.id}. ` +
        `Джерело: ${image.fileName}` +
        (image.page ? `, сторінка ${image.page}` : "") +
        "."
    });

    content.push({
      type: "file",
      file_id: fileId
    });
  }

  const body = {
    title: "AI Quiz Generator questions",
    agent_profile: config.model || PROVIDER_DEFAULTS.manus.model,
    interactive_mode: false,
    hide_in_task_list: true,
    message: {
      content: content.length === 1 ? prompt : content
    }
  };

  if (schema) {
    body.structured_output_schema = schema;
  }

  const createResponse = await fetch(`${baseUrl}/v2/task.create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-manus-api-key": config.apiKey
    },
    body: JSON.stringify(body)
  });

  const parsed = await readJsonNoThrow(createResponse);

  if (!parsed.ok || parsed.data?.ok === false) {
    const message =
      parsed.data?.error?.message ||
      parsed.data?.message ||
      parsed.raw ||
      `HTTP ${parsed.status}`;

    throw new Error(`Manus API: ${message}`);
  }

  const taskId =
    parsed.data?.task_id ||
    parsed.data?.id ||
    parsed.data?.task?.id ||
    parsed.data?.task?.task_id ||
    parsed.data?.data?.task_id ||
    parsed.data?.data?.id ||
    parsed.data?.data?.task?.id ||
    parsed.data?.data?.task?.task_id ||
    "";

  if (!taskId) {
    console.log("[Manus] create response without task_id:", parsed.data);

    throw new Error("Manus API не повернув task_id.");
  }

  return {
    baseUrl,
    taskId,
    raw: parsed.data
  };
}

async function uploadManusImage(baseUrl, apiKey, image) {
  const parsedImage = splitDataUrl(image.dataUrl);

  if (!parsedImage) {
    throw new Error(`Некоректне зображення ${image.id}.`);
  }

  const extension = mimeTypeToExtension(parsedImage.mimeType);
  const filename = `${sanitizeFileName(image.id)}.${extension}`;

  const createFileResponse = await fetch(`${baseUrl}/v2/file.upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-manus-api-key": apiKey
    },
    body: JSON.stringify({
      filename
    })
  });

  const createFileData = await readJsonNoThrow(createFileResponse);

  if (!createFileData.ok || createFileData.data?.ok === false) {
    const message =
      createFileData.data?.error?.message ||
      createFileData.data?.message ||
      createFileData.raw ||
      `HTTP ${createFileData.status}`;

    throw new Error(`Manus file.upload: ${message}`);
  }

  const fileId =
    createFileData.data?.file?.id ||
    createFileData.data?.file_id ||
    createFileData.data?.data?.file?.id ||
    "";

  const uploadUrl =
    createFileData.data?.upload_url ||
    createFileData.data?.data?.upload_url ||
    "";

  if (!fileId || !uploadUrl) {
    throw new Error(
      "Manus file.upload не повернув file_id або upload_url."
    );
  }

  const blob = dataUrlToBlob(image.dataUrl);

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": parsedImage.mimeType
    },
    body: blob
  });

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text().catch(() => "");

    throw new Error(
      "Manus upload URL: " +
      (detail || `HTTP ${uploadResponse.status}`)
    );
  }

  await sleep(400);

  return fileId;
}

async function pollManusResult(baseUrl, apiKey, taskId) {
  const startedAt = Date.now();
  const timeoutMs = 180000;
  const notFoundGraceMs = 60000;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(5000);

    const url =
      `${baseUrl}/v2/task.listMessages` +
      `?task_id=${encodeURIComponent(taskId)}` +
      "&order=asc&limit=100";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-manus-api-key": apiKey
      }
    });

    const parsed = await readJsonNoThrow(response);

    if (!parsed.ok || parsed.data?.ok === false) {
      const message =
        parsed.data?.error?.message ||
        parsed.data?.message ||
        parsed.raw ||
        `HTTP ${parsed.status}`;

      if (
        /task not found/i.test(message) &&
        Date.now() - startedAt < notFoundGraceMs
      ) {
        continue;
      }

      throw new Error(`Manus API: ${message}`);
    }

    const errorMessage = findManusError(parsed.data);

    if (errorMessage) {
      throw new Error(`Manus API: ${errorMessage}`);
    }

    const structured = findManusStructuredOutput(parsed.data);

    if (structured) {
      const normalized = normalizeManusStructuredValue(structured);

      if (normalized) {
        return normalized;
      }
    }

    const assistantJson = findManusAssistantJson(parsed.data);

    if (assistantJson) {
      return assistantJson;
    }
  }

  throw new Error(
    "Manus не повернув результат вчасно. Спробуйте меншу кількість питань."
  );
}

function normalizeManusStructuredValue(structured) {
  if (!structured) {
    return null;
  }

  if (structured.success === false) {
    throw new Error(
      structured.error ||
      "Manus не зміг витягнути структурований результат."
    );
  }

  const value =
    structured.value ||
    structured.result ||
    structured.output ||
    structured.data ||
    structured;

  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return parseJsonObject(value);
  }

  if (Array.isArray(value)) {
    return {
      questions: value
    };
  }

  if (typeof value === "object") {
    if (Array.isArray(value.questions)) {
      return value;
    }

    if (Array.isArray(value.data?.questions)) {
      return value.data;
    }
  }

  return null;
}

function collectManusMessages(data) {
  const result = [];

  if (Array.isArray(data)) {
    result.push(...data);
  }

  const candidateArrays = [
    data?.messages,
    data?.data,
    data?.items,
    data?.events,
    data?.data?.messages,
    data?.data?.items,
    data?.data?.events,
    data?.result?.messages,
    data?.result?.items,
    data?.result?.events
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      result.push(...candidate);
    }
  }

  return result;
}

function findManusStructuredOutput(data) {
  const messages = collectManusMessages(data);

  for (const item of messages) {
    if (item?.structured_output_result) {
      return item.structured_output_result;
    }

    if (item?.type === "structured_output_result") {
      return item.structured_output_result || item.value || item.result || null;
    }

    if (item?.event?.structured_output_result) {
      return item.event.structured_output_result;
    }

    if (item?.message?.structured_output_result) {
      return item.message.structured_output_result;
    }

    if (item?.data?.structured_output_result) {
      return item.data.structured_output_result;
    }
  }

  return null;
}

function findManusAssistantJson(data) {
  const messages = collectManusMessages(data);

  for (let index = messages.length - 1; index >= 0; index--) {
    const text = extractManusText(messages[index]);

    if (!text) {
      continue;
    }

    try {
      const parsed = parseJsonObject(text);

      if (parsed && Array.isArray(parsed.questions)) {
        return parsed;
      }
    } catch (_) {}
  }

  return null;
}

function extractManusText(item) {
  const candidates = [
    item?.assistant_message?.content,
    item?.message?.assistant_message?.content,
    item?.message?.content,
    item?.content,
    item?.text,
    item?.result,
    item?.output,
    item?.data?.content,
    item?.data?.text
  ];

  for (const candidate of candidates) {
    const text = normalizeTextCandidate(candidate);

    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeTextCandidate(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return item?.text || item?.content || item?.value || "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text.trim();
    }

    if (typeof value.content === "string") {
      return value.content.trim();
    }

    if (Array.isArray(value.content)) {
      return normalizeTextCandidate(value.content);
    }
  }

  return "";
}

function findManusError(data) {
  const messages = collectManusMessages(data);

  for (const item of messages) {
    if (item?.error_message) {
      return (
        item.error_message.content ||
        item.error_message.message ||
        item.error_message.error_type ||
        "Manus task error."
      );
    }

    if (item?.message?.error_message) {
      return (
        item.message.error_message.content ||
        item.message.error_message.message ||
        "Manus task error."
      );
    }

    if (item?.type === "error_message") {
      return item.content || item.message || "Manus task error.";
    }
  }

  return "";
}

async function readJsonNoThrow(response) {
  const raw = await response.text();

  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw
  };
}

async function readJson(response, providerName, includeHttpStatus = false) {
  const raw = await response.text();

  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.code ||
      data?.message ||
      raw ||
      `HTTP ${response.status}`;

    const statusPrefix = includeHttpStatus
      ? `HTTP ${response.status} — `
      : "";

    throw new Error(`${providerName} API: ${statusPrefix}${message}`);
  }

  if (!data) {
    throw new Error(`${providerName} API повернув не JSON відповідь.`);
  }

  return data;
}

function parseJsonObject(text) {
  let raw = String(text || "").trim();

  if (!raw) {
    throw new Error("AI повернув порожню відповідь.");
  }

  raw = raw.replace(/^```json\s*/i, "");
  raw = raw.replace(/^```\s*/i, "");
  raw = raw.replace(/\s*```$/i, "");
  raw = raw.trim();

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? {
          questions: parsed
        }
      : parsed;
  } catch (_) {
    const firstObject = raw.indexOf("{");
    const lastObject = raw.lastIndexOf("}");
    const firstArray = raw.indexOf("[");
    const lastArray = raw.lastIndexOf("]");

    if (firstObject >= 0 && lastObject > firstObject) {
      return JSON.parse(raw.slice(firstObject, lastObject + 1));
    }

    if (firstArray >= 0 && lastArray > firstArray) {
      return {
        questions: JSON.parse(raw.slice(firstArray, lastArray + 1))
      };
    }

    throw new Error("AI повернув некоректний JSON.");
  }
}

function normalizeQuestions(items, sourceImages) {
  if (!Array.isArray(items)) {
    return [];
  }

  const imageMap = new Map(
    sourceImages.map((image) => [image.id, image])
  );

  return items
    .map((item) => normalizeQuestion(item, imageMap))
    .filter(Boolean);
}

function normalizeQuestion(item, imageMap) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const question = String(item.question || "").trim();

  const answers = Array.isArray(item.answers)
    ? item.answers
        .map((answer) => String(answer || "").trim())
        .filter(Boolean)
    : [];

  if (!question || answers.length < 2) {
    return null;
  }

  const correct = normalizeCorrectIndexes(item.correct, answers.length);

  if (!correct.length) {
    return null;
  }

  let type = String(item.type || "quiz").trim().toLowerCase();

  if (!["quiz", "multiquiz"].includes(type)) {
    type = correct.length > 1 ? "multiquiz" : "quiz";
  }

  if (correct.length > 1) {
    type = "multiquiz";
  }

  const imageSourceId = String(item.imageSourceId || "").trim();
  const sourceImage = imageMap.get(imageSourceId) || null;

  return {
    type,
    question,
    answers: answers.slice(0, 8),
    correct,
    difficulty: normalizeDifficulty(item.difficulty),
    needsImage: Boolean(sourceImage),
    imageKind: String(
      item.imageKind ||
      (
        String(sourceImage?.sourceUrl || "").startsWith("generated://")
          ? sourceImage.sourceUrl.replace("generated://", "")
          : ""
      )
    ).trim(),
    imageSearchQuery: String(item.imageSearchQuery || "").trim(),
    imageSearchQueryEn: String(item.imageSearchQueryEn || "").trim(),
    imageAlt: String(
      sourceImage?.alt || item.imageAlt || ""
    ).trim(),
    imageSource: String(
      sourceImage?.sourceUrl || item.imageSource || ""
    ).trim(),
    imageSourceId: sourceImage ? imageSourceId : "",
    image: sourceImage ? sourceImage.dataUrl : null,
    imageMeta: sourceImage
      ? {
          fileName: sourceImage.fileName,
          page: sourceImage.page,
          width: sourceImage.width,
          height: sourceImage.height,
          alt: sourceImage.alt || "",
          sourceUrl: sourceImage.sourceUrl || ""
        }
      : null
  };
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "medium")
    .trim()
    .toLowerCase();

  if (["easy", "medium", "hard"].includes(difficulty)) {
    return difficulty;
  }

  if (
    ["легке", "легкий", "легка", "просте"].includes(difficulty)
  ) {
    return "easy";
  }

  if (
    ["складне", "складний", "важке"].includes(difficulty)
  ) {
    return "hard";
  }

  return "medium";
}

function normalizeCorrectIndexes(value, answersCount) {
  const raw = Array.isArray(value) ? value : [value];
  const result = [];

  for (const item of raw) {
    let index = -1;

    if (typeof item === "number") {
      index = item;
    } else if (
      typeof item === "string" &&
      /^\d+$/.test(item.trim())
    ) {
      index = Number(item.trim());
    } else if (
      typeof item === "string" &&
      /^[A-H]$/i.test(item.trim())
    ) {
      index = item.trim().toUpperCase().charCodeAt(0) - 65;
    }

    if (
      index >= 0 &&
      index < answersCount &&
      !result.includes(index)
    ) {
      result.push(index);
    }
  }

  return result;
}

function splitDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:([^;,]+);base64,(.+)$/s
  );

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

function getMimeTypeFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)/);

  return match?.[1] || "image/jpeg";
}

function dataUrlToBlob(dataUrl) {
  const parsed = splitDataUrl(dataUrl);

  if (!parsed) {
    throw new Error("Некоректний data URL зображення.");
  }

  const binary = atob(parsed.base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: parsed.mimeType
  });
}

function mimeTypeToExtension(mimeType) {
  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  if (mimeType === "image/gif") {
    return "gif";
  }

  return "jpg";
}

function sanitizeFileName(value) {
  return String(value || "image")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80);
}

function normalizeGeneratedTitle(value, count, promptText, materialText = "") {
  const raw = String(value || "").trim();

  if (raw) {
    const cleaned = raw
      .replace(/^Тести\s+\d+\s+питань\s*[—-]?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return `Тести ${count} питань — ${cleaned || "Навчальний тест"}`;
  }

  const prompt = String(promptText || "")
    .replace(/\s+/g, " ")
    .trim();

  if (prompt) {
    return `Тести ${count} питань — ${prompt.slice(0, 52)}`;
  }

  const firstMeaningfulLine = String(materialText || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\[.*?\]/, "").trim())
    .find((line) => line.length > 8);

  if (firstMeaningfulLine) {
    return `Тести ${count} питань — ${firstMeaningfulLine.slice(0, 52)}`;
  }

  return `Тести ${count} питань — Навчальний тест`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
