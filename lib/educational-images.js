// Educational image helpers for AI Quiz Generator.
// Works in the extension service worker and in Node tests.

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.QuizGenImages = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const IMAGE_KINDS = [
    "none",
    "photo",
    "geometry",
    "equation",
    "diagram",
    "table",
    "labeling"
  ];

  const GENERATED_KINDS = new Set([
    "geometry",
    "equation",
    "diagram",
    "table",
    "labeling"
  ]);

  const MIN_RELEVANCE_SCORE = 0.34;

  const UK_STOPWORDS = new Set([
    "і", "й", "та", "або", "чи", "на", "у", "в", "із", "з", "до", "для",
    "про", "це", "цей", "ця", "які", "яка", "який", "що", "як", "за",
    "питання", "тест", "зображення", "фото", "малюнок", "схема", "рисунок"
  ]);

  const EN_STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "of", "on", "in", "to", "for", "from",
    "this", "that", "which", "what", "who", "how", "with", "into",
    "question", "image", "photo", "picture", "diagram", "shown", "following"
  ]);

  const TERM_TRANSLATIONS = {
    клітина: "cell",
    клітини: "cell",
    рослинна: "plant",
    рослина: "plant",
    рослини: "plant",
    тваринна: "animal",
    тварина: "animal",
    ядро: "nucleus",
    хлоропласт: "chloroplast",
    мітохондрія: "mitochondrion",
    мембрана: "membrane",
    орган: "organ",
    серце: "heart",
    легені: "lungs",
    мозок: "brain",
    печінка: "liver",
    нирка: "kidney",
    скелет: "skeleton",
    листок: "leaf",
    корінь: "root",
    квітка: "flower",
    гриб: "fungus",
    бактерія: "bacterium",
    вірус: "virus",
    днк: "dna",
    органела: "organelle",
    органели: "organelle",
    фотосинтез: "photosynthesis",
    хлорофіл: "chlorophyll",
    трикутник: "triangle",
    прямокутник: "rectangle",
    коло: "circle",
    кут: "angle",
    графік: "graph",
    рівняння: "equation",
    карта: "map",
    замок: "castle",
    храм: "temple",
    собор: "cathedral",
    портрет: "portrait",
    атом: "atom",
    молекула: "molecule",
    періодична: "periodic",
    таблиця: "table"
  };

  const GEOMETRY_HINTS = [
    "трикутник", "прямокутн", "паралелограм", "трапец", "коло", "круг",
    "кут", "катет", "гіпотенуз", "вершин", "сторона ab", "градус",
    "triangle", "rectangle", "parallelogram", "trapezoid", "circle",
    "angle", "hypotenuse", "vertex", "right triangle", "isosceles",
    "графік функц", "coordinate", "осі координат", "рівняння",
    "equation", "plot the graph"
  ];

  const PHOTO_HINTS = [
    "клітин", "орган", "тварин", "рослин", "лист", "квітка", "гриб",
    "бактер", "вірус", "скелет", "серце", "мозок", "леген",
    "cell", "organ", "animal", "plant", "leaf", "flower", "fungus",
    "bacteria", "virus", "skeleton", "heart", "brain", "lung",
    "castle", "temple", "cathedral", "portrait", "artifact",
    "замок", "храм", "собор", "портрет", "артефакт", "істор"
  ];

  const REJECT_HINTS = [
    "logo", "icon", "flag of", "coat of arms", "screenshot",
    "poster", "meme", "clipart", "stock photo watermark"
  ];

  // Фото доречне лише для предметів, де існує реальний об'єкт спостереження.
  const HISTORY_HINTS = [
    "історичн", "істор", "замок", "фортец", "храм", "собор", "пам'ятк",
    "памятк", "портрет", "палац", "архітектур", "монет", "герб", "прапор",
    "карта", "артефакт", "розкопк", "середньовіч",
    "history", "historical", "castle", "fortress", "temple", "cathedral",
    "palace", "monument", "portrait", "architecture", "artifact", "ancient"
  ];

  const GEO_HINTS = [
    "країн", "столиц", "континент", "океан", "море", "гор", "річк", "озер",
    "клімат", "рельєф", "карта", "атлас",
    "country", "capital", "continent", "ocean", "river", "mountain",
    "climate", "map", "region"
  ];

  // Слова, які самі по собі належать до геометрії/рівнянь.
  // Використовуються для ухвалення рішення про тип зображення.
  const GENERATED_INTENT_HINTS = [
    "трикутник", "прямокутн", "паралелограм", "трапец", "ромб", "коло",
    "круг", "кут", "катет", "гіпотенуз", "вершин", "пірамід", "конус",
    "циліндр", "координат", "графік функц", "рівняння", "нерівніст",
    "формул", "обчисл", "многочлен", "дріб", "відсотк",
    // фізика
    "швидкіст", "прискоренн", "сила струму", "напруг", "опір", "потужніст",
    "тиск", "густин", "імпульс", "енергі", "амплітуд", "частот", "довжин хвил",
    "закон ома", "закон ньютон", "молекулярн", "електричн", "магнітн",
    // хімія
    "хімічна формул", "валентн", "молярн", "реакц", "ступінь окисненн",
    "електронна формул", "йон", "ізомер",
    "triangle", "rectangle", "parallelogram", "trapezoid", "rhombus",
    "circle", "angle", "hypotenuse", "vertex", "polygon", "equation",
    "inequality", "coordinate", "graph of", "perimeter", "area of",
    "formula", "velocity", "acceleration", "voltage", "resistance",
    "chemical formula", "reaction"
  ];

  // Предмети, для яких справжня фотографія не є навчальною ілюстрацією.
  // Сюди НЕ входять лексика іноземних мов і мистецтво: там зображення
  // є саме завданням («який малюнок показує яблуко?»).
  const NON_PHOTO_SUBJECT_HINTS = [
    "граматик", "правопис", "орфограф", "наголос", "частини мови", "відмінювання",
    "дієвідмінювання", "синтаксис", "пунктуац", "переклад тексту",
    "літературний аналіз", "художній засіб", "віршований розмір",
    "автор", "поем", "вірш", "письменник", "поет", "персонаж", "жанр",
    "синонім", "антонім", "реченн", "переклад", "лексичн",
    "grammar", "spelling", "conjugation", "tenses", "prepositions",
    // терміни мовою оригіналу (так їх пишуть у підручниках).
    // Основа без закінчення покриває форми: grammatik → grammatische.
    "grammatik", "grammatisch", "gramática", "gramatica", "gramatyk",
    "gramatyka", "ortografía", "ortografia", "rechtschreibung",
    "konjugation", "konjugacja", "conjugación", "conjugacion"
  ];

  // Ознаки мовного завдання на граматику: «вибери правильну форму»,
  // «заповни пропуск», «утвори час». Для таких питань ілюстрація не потрібна,
  // навіть якщо модель дала гарний англійський пошуковий запит.
  const GRAMMAR_TASK_HINTS = [
    "richtige form", "richtige grammatische", "wähle", "waehle", "ergänze",
    "erganze", "correct form", "choose the correct", "fill in", "complete the sentence",
    "forma correcta", "elige", "completa", "poprawna forma", "wybierz", "uzupełnij",
    "виберіть правильну форму", "заповніть пропуск", "утворіть", "поставте в"
  ];

  function isGrammarTask(question) {
    return containsAny(questionTextForIntent(question), GRAMMAR_TASK_HINTS);
  }

  // Мови світу: у підручниках іноземних мов зображення використовують для
  // лексики, тому це ознака доречного фото.
  const LANGUAGE_HINTS = [
    "англійськ", "німецьк", "іспанськ", "французьк", "польськ", "італійськ",
    "китайськ", "японськ", "корейськ", "турецьк", "чеськ", "словацьк",
    "english", "german", "spanish", "french", "polish", "deutsch", "español",
    "espanol", "français", "vocabulary", "word", "picture shows", "which picture",
    "welches bild", "qué imagen", "que imagen", "który obrazek", "ktory obrazek",
    "лексик", "слово", "словник", "зображено на малюнку", "малюнку зображено"
  ];

  // Мистецтво, музика, культура: питання про конкретний твір або портрет.
  const ART_HINTS = [
    "картин", "полотно", "портрет", "скульптур", "пам'ятк", "памятк", "ікон",
    "ілюстрац", "художник", "митець", "композитор", "музичний твір", "опер",
    "архітектур", "орнамент", "розпис", "мозаїк", "фресц", "гравюр",
    "painting", "portrait", "sculpture", "artwork", "composer", "architecture"
  ];

  // Карти: для них потрібне СПРАВЖНЄ зображення карти, а не схема.
  //
  // ВАЖЛИВО: \b у JavaScript працює лише з ASCII, тому «карт[аиіу]\b»
  // НІКОЛИ не спрацьовував — а саме він мав ловити «карта», «карті», «карти».
  // Замість \b — явна перевірка «далі не літера». Це реальний баг: питання
  // «Що позначено на карті?» не отримувало справжню карту.
  //
  // Хвіст [а-яіїєґ]* потрібен для відмінків, але він же давав хибні
  // спрацювання на «картопля» й «картина», тому ці слова виключені явно.
  const MAP_HINTS = [
    "карт(?!опл|ин)[а-яіїєґ]*(?![A-Za-zА-Яа-яІіЇїЄєҐґ])",
    "map(?![A-Za-z])", "atlas"
  ];

  // Чи потрібна саме фотографія/карта, а не програмна схема.
  function hasMapIntent(question) {
    const text = questionTextForIntent(question);

    return MAP_HINTS.some((hint) => new RegExp(hint, "i").test(text));
  }

  function detectQuestionLanguage(text) {
    const value = String(text || "");
    const uk = (value.match(/[А-Яа-яІіЇїЄєҐґ]/g) || []).length;
    const en = (value.match(/[A-Za-z]/g) || []).length;

    return uk > en ? "uk" : "en";
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9а-яіїєґ\s-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    const language = detectQuestionLanguage(value);
    const stopwords = language === "uk" ? UK_STOPWORDS : EN_STOPWORDS;

    return normalizeText(value)
      .split(" ")
      .map((token) => TERM_TRANSLATIONS[token] || token)
      .filter((token) => token.length > 2 && !stopwords.has(token) && !UK_STOPWORDS.has(token) && !EN_STOPWORDS.has(token));
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function translateEducationalQuery(query, language) {
    const raw = String(query || "").trim();

    if (!raw) {
      return "";
    }

    if (language === "en" || !/[А-Яа-яІіЇїЄєҐґ]/.test(raw)) {
      return raw;
    }

    const translated = normalizeText(raw)
      .split(" ")
      .map((token) => TERM_TRANSLATIONS[token] || token)
      .filter((token) => !UK_STOPWORDS.has(token))
      .join(" ")
      .trim();

    const hasCyrillic = /[а-яіїєґ]/i.test(translated);

    if (!translated || hasCyrillic) {
      const mapped = unique(
        tokenize(raw).filter((token) => /^[a-z0-9-]+$/i.test(token))
      );

      return mapped.join(" ") || raw;
    }

    return translated;
  }

  function buildSearchQueries(question) {
    const language = detectQuestionLanguage(
      `${question?.question || ""} ${question?.imageSearchQuery || ""}`
    );
    const provided = String(question?.imageSearchQuery || "").trim();
    const providedEn = String(question?.imageSearchQueryEn || "").trim();
    const fromQuestion = tokenize(question?.question || "").slice(0, 6).join(" ");

    const english = unique([
      providedEn,
      translateEducationalQuery(provided, language),
      language === "en" ? provided : ""
    ]).filter(Boolean);

    const original = unique([provided]).filter(Boolean);

    if (!english.length && !original.length && fromQuestion) {
      english.push(translateEducationalQuery(fromQuestion, language));
      original.push(fromQuestion);
    }

    return {
      language,
      original,
      english: english.length ? english : original
    };
  }

  function containsAny(text, hints) {
    const hay = normalizeText(text);

    return hints.some((hint) => hay.includes(normalizeText(hint)));
  }

  function inferImageKind(question) {
    const kind = String(question?.imageKind || "").trim().toLowerCase();

    if (IMAGE_KINDS.includes(kind) && kind !== "none") {
      return kind;
    }

    const text = [
      question?.question,
      question?.imageSearchQuery,
      question?.imageAlt,
      ...(Array.isArray(question?.answers) ? question.answers : [])
    ].join(" ");

    if (containsAny(text, GEOMETRY_HINTS)) {
      if (/рівнян|equation|simplify|розв.?яж/i.test(text) && !/трикутник|triangle|графік|graph/i.test(text)) {
        return "equation";
      }

      return "geometry";
    }

    if (/таблиц|\btable\b|заповн/i.test(text) && /пропуск|blank|___|заповн/i.test(text)) {
      return "table";
    }

    if (/підпиш|познач|label the|назви частини|fill in the blank|пропуск/i.test(text)) {
      return "labeling";
    }

    if (containsAny(text, PHOTO_HINTS) || question?.needsImage) {
      return "photo";
    }

    return "none";
  }

  function parseJsonSpec(value) {
    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value;
    }

    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function escapeXml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function svgToDataUrl(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function wrapSvg(body, width, height, language) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" lang="${language}">
  <rect width="100%" height="100%" fill="#ffffff" stroke="#d7dee8"/>
  ${body}
</svg>`;
  }

  function defaultTrianglePoints(spec) {
    if (Array.isArray(spec.points) && spec.points.length >= 3) {
      return spec.points.slice(0, 8).map((point, index) => ({
        id: String(point.id || ["A", "B", "C"][index] || index + 1),
        x: Number(point.x),
        y: Number(point.y)
      }));
    }

    if (spec.rightAngle || spec.figure === "right_triangle") {
      return [
        { id: "C", x: 80, y: 230 },
        { id: "B", x: 330, y: 230 },
        { id: "A", x: 80, y: 50 }
      ];
    }

    return [
      { id: "A", x: 70, y: 230 },
      { id: "B", x: 330, y: 230 },
      { id: "C", x: 200, y: 50 }
    ];
  }

  function pointMap(points) {
    return new Map(points.map((point) => [point.id, point]));
  }

  function renderGeometrySvg(spec, language) {
    const figure = String(spec?.figure || "triangle").toLowerCase();
    const width = 420;
    const height = 300;
    const parts = [];

    if (figure === "equation") {
      return renderEquationSvg(spec, language);
    }

    if (figure === "graph" || figure === "coordinate") {
      return renderGraphSvg(spec, language);
    }

    if (figure === "angle") {
      const vertex = { x: 80, y: 220 };
      const left = { x: 300, y: 220 };
      const angle = Number(spec.angle || spec.angleLabels?.[0]?.degrees || 40);
      const rad = (Math.PI / 180) * Math.min(170, Math.max(10, angle));
      const ray = {
        x: vertex.x + 220 * Math.cos(rad),
        y: vertex.y - 220 * Math.sin(rad)
      };
      const label = spec.angleLabels?.[0]?.text || `${angle}°`;

      parts.push(`<line x1="${vertex.x}" y1="${vertex.y}" x2="${left.x}" y2="${left.y}" stroke="#1f4b99" stroke-width="3"/>`);
      parts.push(`<line x1="${vertex.x}" y1="${vertex.y}" x2="${ray.x.toFixed(1)}" y2="${ray.y.toFixed(1)}" stroke="#1f4b99" stroke-width="3"/>`);
      parts.push(`<path d="M ${vertex.x + 36} ${vertex.y} A 36 36 0 0 0 ${(vertex.x + 36 * Math.cos(rad)).toFixed(1)} ${(vertex.y - 36 * Math.sin(rad)).toFixed(1)}" fill="none" stroke="#c0392b" stroke-width="2"/>`);
      parts.push(`<text x="${vertex.x + 54}" y="${vertex.y - 18}" font-size="18" fill="#c0392b">${escapeXml(label)}</text>`);
      parts.push(`<text x="${vertex.x - 18}" y="${vertex.y + 22}" font-size="16">${escapeXml(spec.points?.[0]?.id || "O")}</text>`);

      return wrapSvg(parts.join("\n  "), width, height, language);
    }

    const points = defaultTrianglePoints(spec);
    const map = pointMap(points);

    for (let index = 0; index < points.length; index++) {
      const from = points[index];
      const to = points[(index + 1) % points.length];
      parts.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#1f4b99" stroke-width="3"/>`);
    }

    const rightVertex = spec.rightAngle || (figure === "right_triangle" ? "C" : "");
    const rightPoint = map.get(rightVertex);

    if (rightPoint) {
      parts.push(`<rect x="${rightPoint.x}" y="${rightPoint.y - 16}" width="16" height="16" fill="none" stroke="#1f4b99" stroke-width="2"/>`);
    }

    (spec.sideLabels || []).forEach((label) => {
      const side = String(label.side || "");
      const fromId = label.from || side.charAt(0);
      const toId = label.to || side.charAt(1);
      const from = map.get(String(fromId || ""));
      const to = map.get(String(toId || ""));

      if (!from || !to) {
        return;
      }

      const x = (from.x + to.x) / 2;
      const y = (from.y + to.y) / 2;
      parts.push(`<text x="${x + 8}" y="${y - 8}" font-size="16" fill="#1b4332">${escapeXml(label.text || "")}</text>`);
    });

    (spec.angleLabels || []).forEach((label) => {
      const point = map.get(String(label.vertex || ""));

      if (!point) {
        return;
      }

      parts.push(`<text x="${point.x + 14}" y="${point.y - 14}" font-size="16" fill="#c0392b">${escapeXml(label.text || "")}</text>`);
    });

    points.forEach((point) => {
      parts.push(`<circle cx="${point.x}" cy="${point.y}" r="4" fill="#1f4b99"/>`);
      parts.push(`<text x="${point.x - 14}" y="${point.y - 10}" font-size="16" font-weight="700">${escapeXml(point.id)}</text>`);
    });

    if (spec.caption) {
      parts.push(`<text x="210" y="285" text-anchor="middle" font-size="14">${escapeXml(spec.caption)}</text>`);
    }

    return wrapSvg(parts.join("\n  "), width, height, language);
  }

  // Обчислює y за описом функції. Підтримуються типи, які трапляються
  // в алгебрі: пряма, парабола, гіпербола, модуль, кубічна, корінь.
  function evaluateFunction(spec, x) {
    const type = String(spec?.type || "line").toLowerCase();
    const a = Number(spec?.a ?? 1);
    const b = Number(spec?.b ?? 0);
    const c = Number(spec?.c ?? 0);
    const k = Number(spec?.k ?? 0);

    if (type === "parabola" || type === "quadratic") {
      return a * x * x + b * x + c;
    }

    if (type === "hyperbola") {
      // y = k / x — у нулі функція не визначена.
      return Math.abs(x) < 0.001 ? NaN : (k || a) / x;
    }

    if (type === "abs" || type === "modulus") {
      return a * Math.abs(x) + b;
    }

    if (type === "cubic") {
      return a * x * x * x + b * x + c;
    }

    if (type === "sqrt") {
      return x < 0 ? NaN : a * Math.sqrt(x) + b;
    }

    // За замовчуванням — пряма y = ax + b.
    return a * x + b;
  }

  function renderGraphSvg(spec, language) {
    const width = 420;
    const height = 300;
    const origin = { x: 210, y: 150 };
    const unit = Number(spec.unit || 22);
    const parts = [];

    // Необов'язкова координатна сітка.
    if (spec.grid) {
      for (let step = -8; step <= 8; step++) {
        const x = origin.x + step * unit;
        const y = origin.y + step * unit;

        if (x > 20 && x < 400) {
          parts.push(`<line x1="${x}" y1="20" x2="${x}" y2="280" stroke="#e2e8f0" stroke-width="1"/>`);
        }

        if (y > 20 && y < 280) {
          parts.push(`<line x1="30" y1="${y}" x2="400" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`);
        }
      }
    }

    parts.push(`<line x1="30" y1="${origin.y}" x2="400" y2="${origin.y}" stroke="#333" stroke-width="2"/>`);
    parts.push(`<line x1="${origin.x}" y1="20" x2="${origin.x}" y2="280" stroke="#333" stroke-width="2"/>`);
    parts.push(`<text x="390" y="${origin.y - 8}" font-size="14">${escapeXml(spec.xLabel || "x")}</text>`);
    parts.push(`<text x="${origin.x + 8}" y="32" font-size="14">${escapeXml(spec.yLabel || "y")}</text>`);

    // Підписи одиничних поділок.
    parts.push(`<text x="${origin.x + 4}" y="${origin.y + 14}" font-size="10">0</text>`);
    parts.push(`<text x="${origin.x + unit - 2}" y="${origin.y + 14}" font-size="10">1</text>`);
    parts.push(`<text x="${origin.x - 12}" y="${origin.y - unit + 4}" font-size="10">1</text>`);

    // Криві: пробігаємо діапазон x і малюємо ламану.
    (spec.functions || []).forEach((fn) => {
      const from = Number(fn.from ?? -8);
      const to = Number(fn.to ?? 8);
      const steps = 160;
      const commands = [];
      let penDown = false;

      for (let index = 0; index <= steps; index++) {
        const x = from + ((to - from) * index) / steps;
        const y = evaluateFunction(fn, x);

        if (!Number.isFinite(y) || Math.abs(y) > 30) {
          penDown = false;
          continue;
        }

        const px = origin.x + x * unit;
        const py = origin.y - y * unit;

        commands.push(`${penDown ? "L" : "M"} ${px.toFixed(1)} ${py.toFixed(1)}`);
        penDown = true;
      }

      if (commands.length > 1) {
        parts.push(
          `<path d="${commands.join(" ")}" fill="none" stroke="${escapeXml(fn.color || "#1f4b99")}" stroke-width="2"/>`
        );
      }
    });

    // Точки з підписами.
    (spec.points || []).forEach((point) => {
      const x = origin.x + Number(point.x) * unit;
      const y = origin.y - Number(point.y) * unit;

      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#c0392b"/>`);

      if (point.label) {
        parts.push(`<text x="${(x + 8).toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="14">${escapeXml(point.label)}</text>`);
      }
    });

    if (spec.caption) {
      parts.push(`<text x="210" y="292" text-anchor="middle" font-size="13">${escapeXml(spec.caption)}</text>`);
    }

    return wrapSvg(parts.join("\n  "), width, height, language || spec.language || "uk");
  }

  function renderEquationSvg(spec, language) {
    const text = String(spec?.equation || spec?.latex || spec?.text || "").trim();
    const body = `<text x="210" y="160" text-anchor="middle" font-size="28" font-family="Georgia, serif">${escapeXml(text)}</text>`;

    return wrapSvg(body, 420, 220, language);
  }

  function renderTableSvg(spec, language) {
    const headers = Array.isArray(spec?.headers) ? spec.headers : [];
    const rows = Array.isArray(spec?.rows) ? spec.rows : [];
    const cols = Math.max(headers.length, ...rows.map((row) => row.length), 1);
    const width = Math.max(420, cols * 140);
    const rowHeight = 36;
    const height = 70 + (rows.length + 1) * rowHeight;
    const parts = [];

    const drawRow = (cells, y, header) => {
      cells.forEach((cell, index) => {
        const x = 20 + index * ((width - 40) / cols);
        const w = (width - 40) / cols;
        const value = String(cell ?? "");
        const isBlank = value === "" || value === "___" || value === "…";
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${rowHeight}" fill="${header ? "#eef3fb" : "#fff"}" stroke="#7b8aa0"/>`);
        parts.push(
          `<text x="${x + 10}" y="${y + 24}" font-size="14">${escapeXml(isBlank ? "" : value)}</text>`
        );
      });
    };

    if (spec?.title) {
      parts.push(`<text x="20" y="28" font-size="16" font-weight="700">${escapeXml(spec.title)}</text>`);
    }

    if (headers.length) {
      drawRow(headers, 44, true);
    }

    rows.forEach((row, index) => {
      drawRow(row, 44 + (headers.length ? rowHeight : 0) + index * rowHeight, false);
    });

    return wrapSvg(parts.join("\n  "), width, height, language);
  }

  function renderLabelingSvg(spec, language) {
    const parts = Array.isArray(spec?.parts) ? spec.parts : [];
    const width = 420;
    const height = 300;
    const body = [
      `<ellipse cx="160" cy="150" rx="90" ry="110" fill="#f8fbff" stroke="#1f4b99" stroke-width="3"/>`,
      `<circle cx="160" cy="150" r="34" fill="#dbeafe" stroke="#1f4b99" stroke-width="2"/>`
    ];

    parts.forEach((part, index) => {
      const y = 50 + index * 44;
      const label = part.showName ? part.name : String(part.id || index + 1);
      body.push(`<line x1="210" y1="${Math.min(220, 80 + index * 30)}" x2="280" y2="${y}" stroke="#555"/>`);
      body.push(`<rect x="280" y="${y - 16}" width="110" height="28" fill="#fff" stroke="#1f4b99"/>`);
      body.push(`<text x="335" y="${y + 4}" text-anchor="middle" font-size="16">${escapeXml(label)}</text>`);
    });

    if (spec?.caption) {
      body.push(`<text x="210" y="285" text-anchor="middle" font-size="14">${escapeXml(spec.caption)}</text>`);
    }

    return wrapSvg(body.join("\n  "), width, height, language);
  }

  function inferGeometrySpec(question) {
    const spec = parseJsonSpec(question?.geometrySpec) || {};
    const text = String(question?.question || "");
    const language = detectQuestionLanguage(text);

    if (!spec.figure) {
      if (/графік|coordinate|plot/i.test(text)) {
        spec.figure = "graph";
      } else if (/рівнян|equation/i.test(text)) {
        spec.figure = "equation";
      } else if (/кут|angle/i.test(text) && !/трикутник|triangle/i.test(text)) {
        spec.figure = "angle";
      } else if (/прямокутн(ий)? трикутник|right triangle/i.test(text)) {
        spec.figure = "right_triangle";
        spec.rightAngle = spec.rightAngle || "C";
      } else {
        spec.figure = "triangle";
      }
    }

    const angleMatch = text.match(/(\d{1,3})\s*°/);

    if (angleMatch && !spec.angleLabels) {
      spec.angle = Number(angleMatch[1]);
      spec.angleLabels = [{ vertex: "A", text: `${angleMatch[1]}°`, degrees: Number(angleMatch[1]) }];
    }

    const equationMatch = text.match(/([0-9xXуУyY+\-*/=()\s]{3,})$/);

    if (spec.figure === "equation" && !spec.equation) {
      spec.equation = String(question?.imageAlt || equationMatch?.[1] || "").trim();
    }

    spec.language = spec.language || language;

    return spec;
  }

  function inferDiagramSpec(question) {
    const spec = parseJsonSpec(question?.diagramSpec) || {};
    const answers = Array.isArray(question?.answers) ? question.answers : [];
    const language = detectQuestionLanguage(question?.question || "");

    if (!spec.type) {
      spec.type = inferImageKind(question) === "table" ? "table" : "labeling";
    }

    if (spec.type === "table") {
      spec.headers = spec.headers || (language === "en"
        ? ["Item", "Value"]
        : ["Об'єкт", "Значення"]);
      spec.rows = spec.rows || answers.slice(0, 3).map((answer, index) => [
        `${index + 1}`,
        "___"
      ]);
    } else {
      spec.parts = Array.isArray(spec.parts) && spec.parts.length
        ? spec.parts.map((part, index) => ({
            id: String(part.id || index + 1),
            name: String(part.name || answers[index] || ""),
            showName: Boolean(part.showName)
          }))
        : answers.slice(0, 4).map((answer, index) => ({
            id: String(index + 1),
            name: String(answer),
            showName: false
          }));
    }

    spec.language = language;

    return spec;
  }

  // Малює многогранник у перспективі: куб, прямокутний паралелепіпед,
  // призму або піраміду. Потрібно для стереометрії (10–11 клас), де
  // пласка фігура у відповіді виглядає безглуздо.
  function renderPolyhedronSvg(spec, language) {
    const width = 420;
    const height = 300;
    const parts = [];
    const kind = String(spec?.figure || "cube").toLowerCase();
    const stroke = "#1f4b99";
    const labels = Array.isArray(spec?.points) && spec.points.length
      ? spec.points.map((point) => String(point?.id ?? point))
      : ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"];

    const line = (from, to, dashed) => {
      return (
        `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ` +
        `stroke="${stroke}" stroke-width="2"${dashed ? ' stroke-dasharray="6 5"' : ""}/>`
      );
    };

    const dot = (point, label) => {
      const circle = `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${stroke}"/>`;

      if (!label) {
        return circle;
      }

      return (
        circle +
        `<text x="${point.x - 18}" y="${point.y + 6}" font-size="16" font-weight="700">${escapeXml(label)}</text>`
      );
    };

    if (kind === "pyramid" || kind === "tetrahedron") {
      const apex = { x: 210, y: 50 };
      const base = [
        { x: 90, y: 235 },
        { x: 310, y: 235 },
        { x: 350, y: 170 },
        { x: 130, y: 170 }
      ];

      base.forEach((point, index) => {
        parts.push(line(point, base[(index + 1) % base.length], index >= 2));
      });

      base.forEach((point, index) => {
        parts.push(line(point, apex, index >= 2));
      });

      parts.push(dot(apex, "S"));
      base.forEach((point, index) => parts.push(dot(point, labels[index] || "")));
    } else if (kind === "prism" || kind === "parallelepiped") {
      const top = [
        { x: 80, y: 120 },
        { x: 270, y: 120 },
        { x: 335, y: 60 },
        { x: 145, y: 60 }
      ];
      const bottom = top.map((point) => ({ x: point.x, y: point.y + 140 }));

      top.forEach((point, index) => parts.push(line(point, top[(index + 1) % top.length])));
      bottom.forEach((point, index) => {
        parts.push(line(point, bottom[(index + 1) % bottom.length], index >= 2));
      });
      top.forEach((point, index) => parts.push(line(point, bottom[index], index === 2)));

      [...top, ...bottom].forEach((point, index) => {
        parts.push(dot(point, labels[index] || ""));
      });
    } else {
      // Куб: передня й задня грані зі зсувом.
      const front = [
        { x: 110, y: 230 },
        { x: 300, y: 230 },
        { x: 300, y: 110 },
        { x: 110, y: 110 }
      ];
      const back = front.map((point) => ({ x: point.x + 55, y: point.y - 45 }));

      front.forEach((point, index) => parts.push(line(point, front[(index + 1) % front.length])));
      back.forEach((point, index) => parts.push(line(point, back[(index + 1) % back.length])));
      front.forEach((point, index) => parts.push(line(point, back[index], index === 3)));

      [...front, ...back].forEach((point, index) => {
        parts.push(dot(point, labels[index] || ""));
      });
    }

    if (spec?.caption) {
      parts.push(
        `<text x="210" y="292" text-anchor="middle" font-size="13">${escapeXml(spec.caption)}</text>`
      );
    }

    return wrapSvg(parts.join("\n  "), width, height, language || spec?.language || "uk");
  }

  // Визначає многогранник за текстом питання, коли модель не дала geometrySpec.
  // Без цього питання про паралелепіпед отримувало плаский трикутник.
  // Українські підказки перевіряємо через containsAny (normalizeText лишає
  // тільки латиницю, тому кириличні шаблони там не спрацюють).
  function inferFigureFromText(text) {
    const value = String(text || "");
    const latin = normalizeText(value);

    if (containsAny(value, ["паралелепіпед", "параллелепипед"])) {
      return "parallelepiped";
    }

    if (containsAny(value, ["пірамід", "пирамид", "тетраедр"])) {
      return "pyramid";
    }

    if (containsAny(value, ["призм"])) {
      return "prism";
    }

    if (containsAny(value, ["куб", "куба", "кубі", "кубом"])) {
      return "cube";
    }

    if (/parallelepiped/.test(latin)) {
      return "parallelepiped";
    }

    if (/pyramid|tetrahedron/.test(latin)) {
      return "pyramid";
    }

    if (/prism/.test(latin)) {
      return "prism";
    }

    if (/cube/.test(latin)) {
      return "cube";
    }

    return "";
  }

  // Слова, які означають, що питання вже посилається на ілюстрацію.
  const IMAGE_REFERENCE_WORDS = [
    "рисун", "малюн", "схем", "графік", "таблиц", "діаграм", "зображен",
    "позначен", "показан", "наведен", "креслен", "фігур",
    "figure", "diagram", "graph", "table", "chart", "shown", "picture", "image"
  ];

  // Чи згадує питання ілюстрацію.
  function questionReferencesImage(question) {
    return containsAny(String(question?.question || ""), IMAGE_REFERENCE_WORDS);
  }

  // Додає посилання на ілюстрацію, якщо питання її має, але не згадує.
  // Без цього учень бачить малюнок і питання, яке з нього не випливає.
  function ensureImageReference(question, kind, language) {
    const text = String(question?.question || "").trim();

    if (!text || questionReferencesImage(question)) {
      return text;
    }

    const prefixByKind = {
      geometry: language === "en"
        ? "Look at the diagram. "
        : "Скористайтеся рисунком. ",
      equation: language === "en"
        ? "Look at the formula. "
        : "Скористайтеся формулою. ",
      table: language === "en"
        ? "Use the table. "
        : "Скористайтеся таблицею. ",
      labeling: language === "en"
        ? "Look at the diagram. "
        : "Розгляньте схему. ",
      diagram: language === "en"
        ? "Look at the diagram. "
        : "Розгляньте схему. "
    };

    const prefix = prefixByKind[kind] || (language === "en"
      ? "Look at the image. "
      : "Скористайтеся зображенням. ");

    // Текст питання не змінюємо — лише додаємо речення-посилання попереду,
    // щоб не зламати великі літери й власні назви.
    return prefix + text;
  }

  function renderQuestionIllustration(question) {
    const kind = inferImageKind(question);
    const language = detectQuestionLanguage(
      `${question?.question || ""} ${question?.imageAlt || ""}`
    );

    if (kind === "geometry" || kind === "equation") {
      const spec = inferGeometrySpec(question);

      // Якщо модель не дала figure у geometrySpec, але в тексті прямо названо
      // многогранник — малюємо саме його. Інакше питання про паралелепіпед
      // отримувало плаский трикутник або кут.
      let explicitFigure = "";

      try {
        const parsed = JSON.parse(String(question?.geometrySpec || ""));

        explicitFigure = String(parsed?.figure || "").toLowerCase();
      } catch (_) {
        explicitFigure = "";
      }

      if (!explicitFigure && String(spec.figure).toLowerCase() !== "equation") {
        const fromText = inferFigureFromText(
          [
            question?.question,
            question?.imageAlt,
            ...(Array.isArray(question?.answers) ? question.answers : [])
          ].join(" ")
        );

        if (fromText) {
          spec.figure = fromText;
        }
      }

      const isPolyhedron = ["cube", "prism", "parallelepiped", "pyramid", "tetrahedron"]
        .includes(String(spec.figure).toLowerCase());

      if (isPolyhedron) {
        const svg = renderPolyhedronSvg(spec, language);

        return {
          kind: "geometry",
          svg,
          dataUrl: svgToDataUrl(svg),
          mimeType: "image/svg+xml",
          alt: String(
            question?.imageAlt ||
            spec.caption ||
            (language === "en" ? "Polyhedron" : "Многогранник")
          ),
          sourceUrl: "generated://polyhedron"
        };
      }

      // Рівняння та формули малюємо окремою гілкою.
      if (kind === "equation" || String(spec.figure).toLowerCase() === "equation") {
        const svg = renderEquationSvg(spec, language);

        return {
          kind: "equation",
          svg,
          dataUrl: svgToDataUrl(svg),
          mimeType: "image/svg+xml",
          alt: String(question?.imageAlt || spec.caption || (language === "en" ? "Formula" : "Формула")),
          sourceUrl: "generated://equation"
        };
      }

      const svg = renderGeometrySvg(spec, language);

      return {
        kind: "geometry",
        svg,
        dataUrl: svgToDataUrl(svg),
        mimeType: "image/svg+xml",
        alt: String(question?.imageAlt || spec.caption || (language === "en" ? "Geometric diagram" : "Геометрична схема")),
        sourceUrl: "generated://geometry"
      };
    }

    if (kind === "table") {
      const spec = inferDiagramSpec({ ...question, imageKind: "table" });
      const svg = renderTableSvg(spec, language);

      return {
        kind: "table",
        svg,
        dataUrl: svgToDataUrl(svg),
        mimeType: "image/svg+xml",
        alt: String(question?.imageAlt || spec.title || (language === "en" ? "Table with blanks" : "Таблиця з пропусками")),
        sourceUrl: "generated://table"
      };
    }

    if (kind === "labeling" || kind === "diagram") {
      const spec = inferDiagramSpec(question);
      const svg = spec.type === "table"
        ? renderTableSvg(spec, language)
        : renderLabelingSvg(spec, language);

      return {
        kind: spec.type === "table" ? "table" : "labeling",
        svg,
        dataUrl: svgToDataUrl(svg),
        mimeType: "image/svg+xml",
        alt: String(question?.imageAlt || spec.caption || (language === "en" ? "Diagram with blanks" : "Схема з пропусками")),
        sourceUrl: "generated://diagram"
      };
    }

    return null;
  }

  function scoreCandidateRelevance({ question, queries, title, description, tags }) {
    const hay = tokenize([title, description, ...(tags || [])].join(" "));
    const queryNeedles = unique([
      ...tokenize(queries?.english?.join(" ") || ""),
      ...tokenize(queries?.original?.join(" ") || ""),
      ...tokenize(question?.imageSearchQueryEn || ""),
      ...tokenize(question?.imageSearchQuery || "")
    ]);
    const questionNeedles = tokenize(question?.question || "");
    const needles = queryNeedles.length ? queryNeedles : questionNeedles;

    if (!needles.length) {
      return 0;
    }

    const haySet = new Set(hay);
    const matches = (token) => haySet.has(token) || hay.some((item) => item.includes(token) || token.includes(item));
    const hits = needles.filter(matches);
    const rejectHay = normalizeText(`${title} ${description}`);

    if (REJECT_HINTS.some((hint) => rejectHay.includes(hint)) && !needles.includes("flag")) {
      return 0;
    }

    const queryScore = hits.length / Math.max(needles.length, 1);
    const questionHits = questionNeedles.filter(matches).length;
    const questionScore = questionNeedles.length
      ? questionHits / questionNeedles.length
      : 0;

    return Math.min(1, queryScore * 0.85 + questionScore * 0.15);
  }

  function isRelevantCandidate(score, title, description, question) {
    if (score < MIN_RELEVANCE_SCORE) {
      return false;
    }

    const kind = inferImageKind(question);

    if (kind === "geometry" || kind === "equation") {
      return false;
    }

    const hay = normalizeText(`${title} ${description}`);
    const query = normalizeText(`${question?.imageSearchQuery || ""} ${question?.imageSearchQueryEn || ""} ${question?.question || ""}`);

    if (/map of the world|political map/.test(hay) && !/map|карта/.test(query)) {
      return false;
    }

    return true;
  }

  function allowedImageUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      return (
        parsed.protocol === "https:" &&
        (
          host === "upload.wikimedia.org" ||
          host.endsWith(".wikimedia.org") ||
          host === "api.openverse.org" ||
          host === "live.staticflickr.com" ||
          host.endsWith(".staticflickr.com")
        )
      );
    } catch (_) {
      return false;
    }
  }

  async function searchWikimediaCommons(query, fetchImpl) {
    const searchUrl = new URL("https://commons.wikimedia.org/w/api.php");
    searchUrl.search = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      list: "search",
      srsearch: query,
      srnamespace: "6",
      srlimit: "8",
      srprop: "snippet"
    }).toString();

    const searchResponse = await fetchImpl(searchUrl.toString(), {
      headers: { Accept: "application/json" }
    });
    const searchData = await searchResponse.json();
    const titles = (searchData.query?.search || [])
      .map((item) => item?.title)
      .filter(Boolean);

    if (!titles.length) {
      return [];
    }

    const infoUrl = new URL("https://commons.wikimedia.org/w/api.php");
    infoUrl.search = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "imageinfo",
      titles: titles.join("|"),
      iiprop: "url|mime|size|extmetadata",
      iiurlwidth: "1200"
    }).toString();

    const infoResponse = await fetchImpl(infoUrl.toString(), {
      headers: { Accept: "application/json" }
    });
    const infoData = await infoResponse.json();
    const pages = Object.values(infoData.query?.pages || {});
    const pageByTitle = new Map(pages.map((page) => [page?.title, page]));

    return titles.map((title) => {
      const page = pageByTitle.get(title);
      const info = page?.imageinfo?.[0];
      const meta = info?.extmetadata || {};

      return {
        provider: "wikimedia",
        title,
        description: String(
          meta.ImageDescription?.value ||
          meta.ObjectName?.value ||
          ""
        ).replace(/<[^>]+>/g, " "),
        tags: String(meta.Categories?.value || "")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean),
        url: info?.thumburl || info?.url || "",
        mimeType: String(info?.mime || "").toLowerCase(),
        sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
      };
    }).filter((item) => item.url && item.mimeType.startsWith("image/"));
  }

  async function searchOpenverse(query, fetchImpl) {
    const url = new URL("https://api.openverse.org/v1/images/");
    url.search = new URLSearchParams({
      q: query,
      page_size: "8",
      mature: "false"
    }).toString();

    const response = await fetchImpl(url.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return (data.results || []).map((item) => ({
      provider: "openverse",
      title: item.title || "",
      description: item.description || "",
      tags: (item.tags || []).map((tag) => tag.name || tag).filter(Boolean),
      url: item.url || item.thumbnail || "",
      thumbnail: item.thumbnail || "",
      mimeType: String(item.filetype ? `image/${item.filetype}` : "image/jpeg"),
      sourceUrl: item.foreign_landing_url || item.url || ""
    })).filter((item) => item.url || item.thumbnail);
  }

  async function findRelevantPhoto(question, fetchImpl, onDiagnostics) {
    const queries = buildSearchQueries(question);
    const searchTerms = unique([...queries.english, ...queries.original]).slice(0, 3);
    const rankedAll = [];

    for (const term of searchTerms) {
      const wikimedia = await searchWikimediaCommons(term, fetchImpl).catch(() => []);
      const openverse = await searchOpenverse(term, fetchImpl).catch(() => []);
      const ranked = [...wikimedia, ...openverse]
        .map((candidate) => ({
          ...candidate,
          score: scoreCandidateRelevance({
            question,
            queries,
            title: candidate.title,
            description: candidate.description,
            tags: candidate.tags
          })
        }))
        .sort((a, b) => b.score - a.score);

      rankedAll.push(...ranked);

      const relevant = ranked.filter((candidate) => isRelevantCandidate(
        candidate.score,
        candidate.title,
        candidate.description,
        question
      ));

      const chosen = relevant.find((candidate) => allowedImageUrl(candidate.url) || allowedImageUrl(candidate.thumbnail));

      if (chosen) {
        notifyPhotoDiagnostics(onDiagnostics, {
          queries,
          searchTerm: term,
          candidatesFound: ranked.length,
          ranked,
          chosen,
          outcome: "chosen"
        });

        return {
          ...chosen,
          downloadUrl: allowedImageUrl(chosen.url) ? chosen.url : chosen.thumbnail
        };
      }
    }

    notifyPhotoDiagnostics(onDiagnostics, {
      queries,
      searchTerm: searchTerms[searchTerms.length - 1] || "",
      candidatesFound: rankedAll.length,
      ranked: rankedAll,
      chosen: null,
      outcome: rankedAll.length ? "rejected" : "not_found"
    });

    return null;
  }

  function notifyPhotoDiagnostics(onDiagnostics, payload) {
    if (typeof onDiagnostics !== "function") {
      return;
    }

    try {
      onDiagnostics(payload);
    } catch (_) {
      // діагностика не повинна ламати основний сценарій
    }
  }

  function questionTextForIntent(question) {
    return [
      question?.question,
      question?.imageSearchQuery,
      question?.imageAlt,
      ...(Array.isArray(question?.answers) ? question.answers : [])
    ].join(" ");
  }

  function hasGeneratedIntent(question) {
    return containsAny(questionTextForIntent(question), GENERATED_INTENT_HINTS);
  }

  // Запитання з предметів, де фотографія не є навчальною ілюстрацією.
  function isNonPhotoSubject(question) {
    if (isGrammarTask(question)) {
      return true;
    }

    return containsAny(questionTextForIntent(question), NON_PHOTO_SUBJECT_HINTS);
  }

  // Чи є в запитанні реальна ознака предмета, для якого фото доречне.
  // imageKind навмисно не враховується: поле imageKind часто виставляє модель
  // і воно може бути помилковим.
  //
  // Порядок перевірок визначає пріоритети:
  //   1) граматика/правопис — фото заборонено завжди;
  //   2) карта — фото дозволено завжди;
  //   3) математика й формули — тільки схема;
  //   4) конкретний англійський запит від моделі — фото дозволено;
  //   5) словники предметів.
  function hasGenuinePhotoUse(question) {
    const text = questionTextForIntent(question);
    const usableQuery = hasUsableEnglishQuery(question);

    // 1. Мовні завдання на граматику та правопис: ілюстрація не потрібна,
    //    навіть якщо модель дала гарний англійський запит.
    if (isNonPhotoSubject(question)) {
      return false;
    }

    // 2. Карта — це завжди реальне зображення, а не схема.
    if (hasMapIntent(question)) {
      return true;
    }

    const withoutExplicitKind = {
      ...(question || {}),
      imageKind: "",
      needsImage: false
    };

    // 3. Математика, фізичні та хімічні формули мають бути схемою, навіть
    //    якщо модель дала запит на кшталт «difference of squares formula».
    if (GENERATED_KINDS.has(inferImageKind(withoutExplicitKind))) {
      return false;
    }

    if (hasGeneratedIntent(question)) {
      return false;
    }

    // 4. Готова англійська пошукова фраза — найнадійніша ознака для лексики
    //    іноземних мов, мистецтва, історії та географії.
    if (usableQuery) {
      return true;
    }

    // 5. Словники предметів.
    if (containsAny(text, PHOTO_HINTS)) {
      return true;
    }

    if (
      containsAny(text, HISTORY_HINTS) ||
      containsAny(text, GEO_HINTS) ||
      containsAny(text, LANGUAGE_HINTS) ||
      containsAny(text, ART_HINTS)
    ) {
      return true;
    }

    const hintedKind = inferImageKind(withoutExplicitKind);

    return hintedKind === "photo" || hintedKind === "labeling";
  }

  // Чи дав модель придатний англійський пошуковий запит.
  // Кирилиця у запиті означає, що переклад не відбувся, і шукати небезпечно.
  function hasUsableEnglishQuery(question) {
    const query = String(question?.imageSearchQueryEn || "").trim();

    if (query.length < 3) {
      return false;
    }

    if (/[А-Яа-яІіЇїЄєҐґ]/.test(query)) {
      return false;
    }

    // Запит має містити хоч одне слово з 3+ літер.
    return query.split(/\s+/).some((word) => /[A-Za-z]{3,}/.test(word));
  }

  // Єдина точка ухвалення рішення про тип зображення.
  // Повертає остаточний тип і причину, щоб pipeline міг їх залогувати
  // і не покладатися сліпо на поля від AI-моделі.
  function detectImageIntent(question) {
    const explicitKind = String(question?.imageKind || "").trim().toLowerCase();

    // Тип за змістом запитання, без урахування поля imageKind від моделі:
    // саме воно буває помилковим (наприклад, "photo" для задачі про трикутник).
    const inferredKind = inferImageKind({
      ...(question || {}),
      imageKind: "",
      needsImage: false
    });

    const generatedIntent = hasGeneratedIntent(question);
    const photoUse = hasGenuinePhotoUse(question);
    const needsImage = Boolean(question?.needsImage);

    // Карта — це завжди реальне зображення. Без цієї перевірки питання
    // «яку річку позначено на карті?» отримувало програмну схему-заглушку
    // замість справжньої карти.
    if (hasMapIntent(question)) {
      return {
        kind: "photo",
        reason: "запитання стосується карти — потрібне реальне зображення"
      };
    }

    if (GENERATED_KINDS.has(inferredKind) && inferredKind !== "photo") {
      return {
        kind: inferredKind,
        reason: `зміст запитання вказує на програмну ілюстрацію (${inferredKind})`
      };
    }

    if (generatedIntent && !photoUse) {
      return {
        kind: inferredKind === "none" ? "diagram" : inferredKind,
        reason: "зміст запитання математичний, але точний тип не визначено"
      };
    }

    // Готова англійська пошукова фраза від моделі перемагає слабкий
    // або помилковий imageKind — саме це дає змогу працювати лексиці
    // іноземних мов, мистецтву, історії та географії.
    // Але не для предметів із блокуванням (граматика, правопис, література).
    if (hasUsableEnglishQuery(question) && !isNonPhotoSubject(question)) {
      return {
        kind: "photo",
        reason: "модель дала конкретний англійський пошуковий запит"
      };
    }

    if (IMAGE_KINDS.includes(explicitKind) && explicitKind !== "none") {
      if (explicitKind === "photo" && !photoUse) {
        return {
          kind: "none",
          reason: "модель вказала photo, але запитання не стосується предмета з реальними зображеннями"
        };
      }

      return {
        kind: explicitKind,
        reason: "тип визначено за полем imageKind від моделі"
      };
    }

    if (photoUse) {
      return {
        kind: "photo",
        reason: "зміст запитання стосується предмета з реальними зображеннями"
      };
    }

    if (needsImage && inferredKind !== "none") {
      return {
        kind: inferredKind,
        reason: "тип уточнено за змістом запитання"
      };
    }

    return {
      kind: "none",
      reason: needsImage
        ? "модель позначила потребу в зображенні, але надійний тип визначити не вдалося"
        : "запитання не потребує зображення"
    };
  }

  function applyBlankAnswers(question) {
    const kind = inferImageKind(question);
    const text = String(question?.question || "");

    if (kind !== "labeling" && kind !== "table" && !/___|пропуск|blank/i.test(text)) {
      return question;
    }

    const answers = Array.isArray(question.answers) ? question.answers.map((item) => String(item || "").trim()) : [];

    if (!/___/.test(text) && !/позначен|labeled|підпиш/i.test(text) && answers.length && kind === "labeling") {
      const language = detectQuestionLanguage(text);
      const prefix = language === "en"
        ? "Look at the diagram. What is labeled"
        : "Розгляньте схему. Що позначено цифрою";
      question.question = `${text} ${prefix} 1?`.trim();
    }

    return question;
  }

  return {
    IMAGE_KINDS,
    GENERATED_KINDS,
    MIN_RELEVANCE_SCORE,
    detectQuestionLanguage,
    translateEducationalQuery,
    buildSearchQueries,
    inferImageKind,
    detectImageIntent,
    hasGenuinePhotoUse,
    hasGeneratedIntent,
    hasMapIntent,
    hasUsableEnglishQuery,
    isNonPhotoSubject,
    isGrammarTask,
    inferGeometrySpec,
    inferDiagramSpec,
    renderGeometrySvg,
    renderGraphSvg,
    renderPolyhedronSvg,
    inferFigureFromText,
    questionReferencesImage,
    ensureImageReference,
    renderEquationSvg,
    renderTableSvg,
    renderLabelingSvg,
    renderQuestionIllustration,
    scoreCandidateRelevance,
    isRelevantCandidate,
    allowedImageUrl,
    searchWikimediaCommons,
    searchOpenverse,
    findRelevantPhoto,
    applyBlankAnswers,
    svgToDataUrl,
    tokenize
  };
});
