// material.js — підготовка навчальних матеріалів для AI.
//
// Дві задачі:
// 1. cleanMaterialText — безпечне прибирання дефектів PDF-витягу:
//    зайві пробіли, розриви слів переносом, порожні рядки. Символьні
//    підстановки вбудованих шрифтів НЕ «дешифруються»: без CMap шрифту
//    це неможливо й лише псує текст (перевірено на реальному підручнику).
// 2. buildChunks / selectChunksForPrompt — розбиття матеріалу на частини
//    зі збереженням номерів сторінок і вибір тих частин, які стосуються
//    запиту користувача (наприклад, «тема 1.2»).
//
// Працює і в service worker, і в Node-тестах.

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.QuizGenMaterial = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_CHUNK_CHARS = 12000;

  // Частка символів, які схожі на підстановку зі вбудованого шрифту.
  // Використовується лише для діагностики: у зіпсованих підручниках
  // значення сягає 0.8, у нормальному тексті — близько 0.
  function mojibakeRatio(text) {
    const letters = String(text || "").match(/[A-Za-zА-Яа-яІіЇїЄєҐґ\u00c0-\u00ff]/g) || [];

    if (letters.length < 20) {
      return 0;
    }

    const suspicious = letters.filter((character) => {
      const code = character.charCodeAt(0);

      return (code >= 0xc0 && code <= 0xff) || /[A-Za-z]/.test(character);
    }).length;

    return suspicious / letters.length;
  }

  // Безпечне очищення: прибираємо дефекти пробілів і переносів,
  // не змінюючи жодної літери.
  function cleanMaterialText(text) {
    let value = String(text || "");

    if (!value) {
      return "";
    }

    // «за кладки» / «дослі- дження» — склеюємо розірвані слова,
    // якщо після дефіса йде рядок або зайвий пробіл.
    value = value.replace(/([А-Яа-яІіЇїЄєҐґA-Za-z])-\s*\n\s*([А-Яа-яІіЇїЄєҐґa-z])/g, "$1$2");
    value = value.replace(/\s+([.,;:!?)\]»])/g, "$1");
    value = value.replace(/([«(\[])\s+/g, "$1");
    value = value.replace(/[ \t\u00a0]+/g, " ");
    value = value.replace(/ ?\n ?/g, "\n");
    value = value.replace(/\n{3,}/g, "\n\n");

    return value.trim();
  }

  // Розбиває сторінки на частини, не розриваючи сторінку посередині
  // й не змішуючи різні файли в одній частині.
  //
  // page.number — внутрішній наскрізний номер (для унікальності частин),
  // page.sourcePage — номер сторінки в межах книги (те, що бачить користувач).
  function buildChunks(pages, options) {
    const maxChars = Number(options?.maxChars || DEFAULT_CHUNK_CHARS);
    const source = Array.isArray(pages) ? pages : [];
    const chunks = [];
    let current = null;

    source.forEach((page, index) => {
      const number = Number(page?.number || index + 1);
      const sourcePage = Number(page?.sourcePage || number);
      const fileIndex = Number(page?.fileIndex || 0);
      const text = cleanMaterialText(page?.text || "");

      if (!text) {
        return;
      }

      const block = `[Сторінка ${sourcePage}]\n${text}`;
      const start = () => ({
        pages: [sourcePage],
        text: block,
        fileName: page?.fileName || "",
        fileIndex
      });

      if (!current) {
        current = start();
        return;
      }

      // Сторінки різних книг ніколи не потрапляють в одну частину.
      const isSameFile = current.fileIndex === fileIndex;

      if (!isSameFile || current.text.length + block.length + 2 > maxChars) {
        chunks.push(finalizeChunk(current, chunks.length));

        current = isSameFile
          ? {
              pages: [sourcePage],
              text: block,
              fileName: current.fileName,
              fileIndex: current.fileIndex
            }
          : start();

        return;
      }

      current.pages.push(sourcePage);
      current.text += `\n\n${block}`;
    });

    if (current) {
      chunks.push(finalizeChunk(current, chunks.length));
    }

    return chunks;
  }

  function finalizeChunk(current, index) {
    return {
      index,
      pages: current.pages,
      pageFrom: current.pages[0],
      pageTo: current.pages[current.pages.length - 1],
      text: current.text,
      chars: current.text.length,
      fileName: current.fileName || "",
      fileIndex: Number(current.fileIndex || 0)
    };
  }

  function formatPageRange(chunk) {
    if (!chunk) {
      return "";
    }

    return chunk.pageFrom === chunk.pageTo
      ? `с. ${chunk.pageFrom}`
      : `с. ${chunk.pageFrom}–${chunk.pageTo}`;
  }

  function stripSpacesAroundPunctuation(value) {
    return String(value || "").replace(/\s*([.,])\s*/g, "$1");
  }

  // Слова-інструкції не допомагають визначити, про яку книгу йдеться,
  // тому не враховуються як ключові слова для вибору файлу.
  // Зіставляємо за префіксом (перші 5 літер), щоб покрити відмінки.
  const PROMPT_STOPWORD_STEMS = new Set([
    "зроби", "створ", "згене", "підго", "напиш", "склад", "потріб", "треба",
    "питан", "запит", "тест", "матер", "текст", "тема:", "теми", "темою",
    "розді", "параг", "пункт", "урок", "сторі", "файл", "книга", "книги",
    "книзі", "книжк", "підру", "будь", "ласка", "хочу", "можна", "який",
    "яка:", "які:", "цього", "цьому", "яких", "якому", "мені", "дуже", "щоб",
    "щодо", "рівен", "склад", "варіа", "відпо", "прави", "почин", "дайте"
  ]);

  function isPromptStopword(word) {
    if (!word) {
      return true;
    }

    const stem = word.slice(0, 5);

    return PROMPT_STOPWORD_STEMS.has(stem);
  }

  // Витягує з запиту посилання на розділ/тему/сторінку.
  function extractRequestedSections(prompt) {
    const text = String(prompt || "");
    const sections = [];
    const pages = [];
    const sectionPattern = /(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/g;
    let match;

    while ((match = sectionPattern.exec(text)) !== null) {
      sections.push(`${match[1]}.${match[2]}`);
    }

    // «§ 3», «параграф 12», «урок 5» — тема задана одним числом.
    // У підручниках алгебри, хімії, фізики це основний спосіб.
    //
    // Слова-вказівники записані основами з закінченнями: у запитах
    // трапляються всі відмінки — «за темою 14», «з теми 12»,
    // «за параграфом 13». Без цього такі запити не розпізнавались узагалі.
    const singleNumberPattern =
      /(?:§|парагр[а-яіїєґ]*|пункт[а-яіїєґ]*|тем[а-яіїєґ]*|урок[а-яіїєґ]*|занятт[а-яіїєґ]*)\s*(\d{1,2})\b/gi;

    while ((match = singleNumberPattern.exec(text)) !== null) {
      const after = text.slice(match.index + match[0].length);

      // «параграф 1 4» — це параграф 1.4, а не параграф 1.
      if (/^\s+\d/.test(after)) {
        continue;
      }

      // «тема 1.2» — це параграф 1.2, уже врахований вище.
      if (/^\s*[.,]\s*\d/.test(after)) {
        continue;
      }

      sections.push(String(Number(match[1])));
    }

    // Номер, розділений пробілом: «параграф 1 4», «з теми 2 3».
    // Пробіл допустимий ЛИШЕ коли поруч є слово-вказівник, інакше
    // «10 питань» помилково стало б параграфом «1.0».
    const spacedPattern = /(\d{1,2})\s+(\d{1,2})(?!\d)/g;

    while ((match = spacedPattern.exec(text)) !== null) {
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      const after = text.slice(
        match.index + match[0].length,
        match.index + match[0].length + 12
      );
      const hint =
        /(?:параг|пункт|тема|теми|темою|темах|урок|§)/i.test(before) ||
        /(?:параг|пункт)/i.test(after);

      if (hint) {
        sections.push(`${match[1]}.${match[2]}`);
      }
    }

    // \w у JS не охоплює кирилицю, тому явно перелічуємо літери.
    const pagePattern = /(?:сторін[а-яіїєґ]*|стор\.|с\.)\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/gi;

    while ((match = pagePattern.exec(text)) !== null) {
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;

      for (let page = from; page <= to && page - from < 40; page++) {
        pages.push(page);
      }
    }

    // Явна згадка файлу/книги: «з другої книги», «у файлі 2», «другої книги».
    const fileMentions = [];
    const digitMention = /(?:файл|книг|підручник|документ)[а-яіїєґ]*\s*(?:№\s*)?(\d{1,2})/gi;

    while ((match = digitMention.exec(text)) !== null) {
      fileMentions.push(Number(match[1]));
    }
    const ordinalMentions = [
      { words: ["перш", "1-"], value: 1 },
      { words: ["друг", "2-"], value: 2 },
      { words: ["трет", "3-"], value: 3 }
    ];

    const hasFileWord = /(?:файл|книг|підручник|документ)/i.test(text);

    if (hasFileWord) {
      ordinalMentions.forEach((item) => {
        if (item.words.some((word) => text.toLowerCase().includes(word))) {
          fileMentions.push(item.value);
        }
      });
    }

    // Пробіл між номером розділу і наступною цифрою означає, що це насправді
    // параграф («розділ 1 4» = параграф 1.4), а не розділ 1.
    const chapterHasSpacedSection = /(?:розділ|частина|глава|модуль|блок)[а-яіїєґ]*\s*(?:№\s*)?\d{1,2}\s+\d{1,2}(?!\d)/i.test(text);

    // Рівень розділу: «розділ 1», «частина 2». Номер без крапки, тому не
    // плутається з параграфом «1.2».
    const chapters = [];

    if (!chapterHasSpacedSection) {
      const chapterPattern =
        /(?:розділ|частина|глава|модуль|блок)[а-яіїєґ]*\s*(?:№\s*)?(\d{1,2})(?!\s*[.,]\s*\d)/gi;

      while ((match = chapterPattern.exec(text)) !== null) {
        chapters.push(Number(match[1]));
      }
    }

    const keywords = String(text)
      .toLowerCase()
      .split(/[^\wА-Яа-яІіЇїЄєҐґ']+/u)
      .map((word) => word.trim())
      .filter((word) => word.length > 3 && !isPromptStopword(word));

    return {
      sections: [...new Set(sections)],
      chapters: [...new Set(chapters)],
      pages: [...new Set(pages)],
      fileMentions: [...new Set(fileMentions)],
      keywords: [...new Set(keywords)]
    };
  }

  // Витягує з матеріалу список параграфів і до якого розділу кожен належить.
  // Потрібно, коли підручник нумерує параграфи одним числом («§ 5»),
  // а користувач просить «розділ 2».
  //
  // Аналіз посторінковий: сторінка — природна межа, тож параграф належить
  // тому розділу, який зустрівся на цій або попередній сторінці.
  function buildSectionIndex(chunks) {
    const sections = [];
    const chapterPattern =
      /(?:розділ|частина|глава|модуль|блок)[а-яіїєґ]*\s*(?:№\s*)?(\d{1,2})\b/gi;
    const sectionPattern =
      /(?:§|параграф|парагр\.|пункт|урок|заняття)\s*(\d{1,2})(?:[.,]\s*(\d{1,2}))?/gi;

    let currentChapter = null;

    (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
      if (typeof chunk?.index !== "number" || typeof chunk?.text !== "string") {
        return;
      }

      // Розбиваємо текст частини на сторінки за маркерами «[Сторінка N]».
      const segments = String(chunk.text).split(/\[Сторінка (\d+)\]/);
      const pages = [];

      for (let i = 1; i < segments.length; i += 2) {
        pages.push({ number: Number(segments[i]), text: segments[i + 1] || "" });
      }

      // Якщо маркерів немає, працюємо з усім текстом як з однією сторінкою.
      if (!pages.length) {
        pages.push({ number: chunk.pageFrom || 0, text: String(chunk.text) });
      }

      pages.forEach((page) => {
        const text = stripSpacesAroundPunctuation(page.text);
        const chapterMatches = [];
        const sectionMatches = [];
        let match;

        chapterPattern.lastIndex = 0;

        while ((match = chapterPattern.exec(text)) !== null) {
          chapterMatches.push({ value: Number(match[1]), at: match.index });
        }

        sectionPattern.lastIndex = 0;

        while ((match = sectionPattern.exec(text)) !== null) {
          sectionMatches.push({
            value: Number(match[2] || match[1]),
            at: match.index
          });
        }

        // Розділ на цій сторінці задає контекст для наступних параграфів.
        if (chapterMatches.length) {
          currentChapter = chapterMatches[chapterMatches.length - 1].value;
        }

        sectionMatches.forEach((item) => {
          sections.push({
            section: item.value,
            chapter: currentChapter,
            index: chunk.index,
            page: page.number
          });
        });
      });
    });

    return sections;
  }

  // Знаходить перший параграф заданого розділу: «розділ 2» → «§ 5».
  function sectionsOfChapter(chunks, chapter) {
    const index = buildSectionIndex(chunks);
    const found = index.filter((item) => item.chapter === Number(chapter));

    return [...new Set(found.map((item) => String(item.section)))];
  }

  // Перетворює згадку розділу на номер першого параграфа цього розділу.
  // Працює для обох схем нумерації:
  //   • з підрозділами — «розділ 1» → «1.1»;
  //   • з параграфами § — «розділ 2» → «5».
  function expandChaptersToSections(chunks, chapters) {
    const result = [];

    (Array.isArray(chapters) ? chapters : []).forEach((chapter) => {
      // Спершу шукаємо підрозділи вигляду «N.M».
      for (let section = 1; section <= 30; section++) {
        const candidate = `${chapter}.${section}`;

        if (findHeadingOccurrences(chunks, candidate).length) {
          result.push(candidate);
          return;
        }
      }

      // Потім — параграфи, задані одним числом (§ 5).
      const numbered = sectionsOfChapter(chunks, chapter);

      if (numbered.length) {
        result.push(numbered[0]);
      }
    });

    return [...new Set(result)];
  }

  // Чи згадує частина цю тему. Працює навіть коли заголовок зіпсований
  // шрифтом: номер теми зазвичай збережений, а пробіли навколо крапки
  // у витягнутому тексті трапляються як «1 .2».
  function chunkMentionsSection(chunk, section) {
    const normalizedNeedle = stripSpacesAroundPunctuation(section);
    const normalizedHaystack = stripSpacesAroundPunctuation(chunk?.text || "");
    const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^\\d])${escaped}(?![\\d])`, "m");

    return pattern.test(normalizedHaystack);
  }

  // Вибір частин під запит користувача.
  // Пріоритет: явно названа тема → названі сторінки → ключові слова → початок.
  function selectChunksForPrompt(chunks, prompt, options) {
    const maxChunks = Math.max(1, Number(options?.maxChunks || 1));
    const maxChars = Number(options?.maxChars || DEFAULT_CHUNK_CHARS * 2);
    const list = Array.isArray(chunks) ? chunks : [];
    const requested = extractRequestedSections(prompt);

    if (!list.length) {
      return { selected: [], strategy: "empty", requested };
    }

    const picked = [];
    const used = new Set();
    let usedChars = 0;

    const take = (chunk) => {
      if (!chunk || used.has(chunk.index) || picked.length >= maxChunks) {
        return false;
      }

      if (picked.length && usedChars + chunk.chars > maxChars) {
        return false;
      }

      used.add(chunk.index);
      picked.push(chunk);
      usedChars += chunk.chars;

      return true;
    };

    // Тема може займати кілька частин: після знайденого заголовка додаємо
    // наступні частини, доки вистачає бюджету символів.
    const takeWithContinuation = (chunk) => {
      if (!take(chunk)) {
        return;
      }

      let next = list.find((item) => item.index === chunk.index + 1);

      while (next && take(next)) {
        next = list.find((item) => item.index === next.index + 1);
      }
    };

    if (requested.sections.length || requested.chapters.length) {
      const sections = [
        ...requested.sections,
        ...expandChaptersToSections(list, requested.chapters)
      ];
      const headings = [];

      sections.forEach((section) => {
        headings.push(...findHeadingOccurrences(list, section));
      });

      // Підручники, де параграф задано простим числом: «§ 12. Кислоти»,
      // «Урок 5». Нумерація буває двох видів:
      //   • з розділами — «§ 1.2» означає другий параграф першого розділу;
      //   • наскрізна — «Урок 5» означає п'ятий урок книги.
      // Перевіряємо обидві відповідності й беремо ту, що справді є в тексті.
      const numbered = findNumberedSectionHeadings(list);
      const byNumberMap = new Map(numbered.map((item) => [item.number, item]));
      const wantedVariants = [];
      const addVariant = (value) => {
        const number = Number(value);

        if (Number.isFinite(number) && number > 0) {
          wantedVariants.push(number);
        }
      };

      // «2.4» → «4» — це лише здогад. У книзі, де всі параграфи задані
      // одним числом, підрозділів «2.4» не існує, тож здогад приводить
      // до випадкового параграфа. Застосовуємо його тільки коли книга
      // справді використовує нумерацію вигляду «N.M».
      const dottedAllowed = bookUsesDottedSections(list);

      // Номери, отримані з розділів («розділ 2» → «4»), теж треба врахувати.
      new Set([
        ...requested.sections,
        ...expandChaptersToSections(list, requested.chapters)
      ]).forEach((section) => {
        const parts = String(section).split(".");
        const chapter = Number(parts[0]);
        const item = Number(parts[1]);

        // Тема задана одним числом («§ 3»).
        if (isSingleNumberSection(section)) {
          addVariant(section);
          return;
        }

        if (!dottedAllowed) {
          return;
        }

        // Підрозділ «1.2»: другий параграф першого розділу.
        if (chapter === 1 || !chapter) {
          addVariant(item);
        }

        // Наскрізна нумерація: «тема 1.4» → параграф 4.
        addVariant(item);
      });

      new Set(wantedVariants).forEach((number) => {
        const item = byNumberMap.get(number);
        const chunk = item && list.find((entry) => entry.index === item.index);

        if (chunk) {
          headings.push({ ...item, kind: "number", index: chunk.index });
        }
      });

      // Серед знайдених згадок номера берёмo найкращу (справжній заголовок),
      // а не першу-ліпшу: номер теми часто згадується і в підписах рисунків,
      // і в назвах практичних завдань.
      const rankedHeadings = [...headings].sort((a, b) => {
        return Number(b.score || 0) - Number(a.score || 0);
      });

      rankedHeadings.forEach((heading) => {
        const chunk = list.find((item) => item.index === heading.index);
        takeWithContinuation(chunk);
      });

      if (picked.length) {
        const onlySingleNumbers =
          requested.sections.length > 0 &&
          requested.sections.every((section) => isSingleNumberSection(section));

        if (onlySingleNumbers) {
          // Звужуємо текст до самого параграфа, щоб модель не бачила
          // сусідній параграф у тій самій частині.
          const scoped = scopeSelectedSections(list, picked, requested.sections);
          const scopedChunks = scoped.filter((chunk) => chunk.source === "section-range");

          // Якщо діапазон параграфа визначено точно, працюємо тільки з ним:
          // сусідні частини містять уже інший параграф.
          if (scopedChunks.length) {
            picked.splice(0, picked.length, ...scopedChunks);

            return {
              selected: sortByIndex(picked),
              strategy: "paragraph",
              requested,
              headings: rankedHeadings
            };
          }

          picked.splice(0, picked.length, ...scoped);
        }

        return {
          selected: sortByIndex(picked),
          strategy: requested.chapters.length && !requested.sections.length
            ? "chapter"
            : onlySingleNumbers
              ? "paragraph"
              : "section",
          requested,
          headings: rankedHeadings
        };
      }
      // Заголовок не вдалося розпізнати (наприклад, шрифт зіпсував регістр) —
      // тоді беремо частини, де номер теми просто згадується.
      //
      // Зміст і відповіді не беремо: там номер згадано, але матеріалу немає.
      sections.forEach((section) => {
        list
          .filter((chunk) => {
            return !isReferenceChunk(chunk) && chunkMentionsSection(chunk, section);
          })
          .forEach(take);
      });

      if (picked.length) {
        return { selected: sortByIndex(picked), strategy: "section-mention", requested };
      }
    }

    if (requested.pages.length) {
      requested.pages.forEach((page) => {
        list
          .filter((chunk) => page >= chunk.pageFrom && page <= chunk.pageTo)
          .forEach(take);
      });

      if (picked.length) {
        return { selected: sortByIndex(picked), strategy: "page", requested };
      }
    }

    if (requested.keywords.length) {
      const scored = list
        .map((chunk) => {
          const haystack = chunk.text.toLowerCase();
          const hits = requested.keywords.filter((word) => haystack.includes(word)).length;

          return { chunk, hits };
        })
        .filter((item) => item.hits > 0)
        .sort((a, b) => b.hits - a.hits);

      scored.forEach((item) => take(item.chunk));

      if (picked.length) {
        return { selected: sortByIndex(picked), strategy: "keywords", requested };
      }
    }

    list.slice(0, maxChunks).forEach(take);

    return { selected: sortByIndex(picked), strategy: "start", requested };
  }

  function sortByIndex(chunks) {
    return [...chunks].sort((a, b) => a.index - b.index);
  }

  // Групує частини за файлом-джерелом, зберігаючи порядок файлів.
  function groupChunksByFile(chunks) {
    const groups = new Map();

    (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
      const key = Number(chunk?.fileIndex || 0);

      if (!groups.has(key)) {
        groups.set(key, {
          fileIndex: key,
          fileName: chunk?.fileName || "",
          chunks: []
        });
      }

      groups.get(key).chunks.push(chunk);
    });

    return [...groups.values()];
  }

  // Оцінює, наскільки файл відповідає запиту. Використовується, коли
  // завантажено кілька книг і треба вибрати одну, а не суміш.
  function scoreFileForPrompt(chunks, prompt) {
    const requested = extractRequestedSections(prompt);
    const list = Array.isArray(chunks) ? chunks : [];
    const headings = [];
    let headingPages = 0;
    let keywordHits = 0;

    requested.sections.forEach((section) => {
      headings.push(...findHeadingOccurrences(list, section));
    });

    headingPages = headings.length;

    if (requested.keywords.length) {
      const text = list.map((chunk) => chunk.text.toLowerCase()).join(" ");

      keywordHits = requested.keywords.filter((word) => text.includes(word)).length;
    }

    // Згадка файлу в запиті («з другої книги», «файл 2»).
    const mentioned = requested.fileMentions.includes(
      Number(list[0]?.fileIndex || 0) + 1
    );

    return {
      headings,
      headingPages,
      keywordHits,
      mentioned,
      score: headingPages * 100 + keywordHits
    };
  }

  // Чи виглядає текст після номера теми як ЗАГОЛОВОК, а не як продовження речення.
  //
  // Підручники оформлюють заголовки по-різному, тому перевіряємо кілька ознак:
  //  1) ВЕЛИКІ ЛІТЕРИ — «1.2. ЗБИРАННЯ ДАНИХ»;
  //  2) Великі Перші Літери — «2.3. Квадратні рівняння» (математика);
  //  3) явний маркер теми («§», «Тема», «Урок») перед номером;
  //  4) короткий рядок без крапки в кінці.
  function looksLikeHeadingTail(tail, options) {
    const text = String(tail || "").trim();

    if (!text) {
      return false;
    }

    // Явний маркер перед номером («§ 14», «тема 14») — але після нього
    // все одно має йти НАЗВА з великої літери, інакше це згадка номера
    // в тексті, а не заголовок.
    if (options?.hasMarker) {
      const headingStart = text.replace(/^[\s.,:)\]]+/, "");

      return /^[A-Za-zА-ЯІЇЄҐ]/.test(headingStart);
    }

    const letters = text.match(/[A-Za-zА-Яа-яІіЇїЄєҐґ\u00c0-\u00ff]/g) || [];

    if (letters.length < 4) {
      return false;
    }

    // 1. Серія великих літер на початку.
    let run = 0;

    for (const character of letters) {
      if (character === character.toUpperCase() && character !== character.toLowerCase()) {
        run++;
        continue;
      }

      break;
    }

    if (run >= 3) {
      return true;
    }

    // 2. Заголовок із великих перших літер: усі слова з великої,
    //    серед них немає звичайних маленьких слів.
    const words = text.split(/\s+/).filter((word) => word.length > 1);
    const capitalised = words.filter((word) => {
      const first = word[0] || "";
      const rest = word.slice(1);

      return (
        first === first.toUpperCase() &&
        first !== first.toLowerCase() &&
        rest === rest.toLowerCase()
      );
    });

    if (words.length >= 2 && capitalised.length >= 2) {
      return true;
    }

    // 3. Короткий рядок-назва без крапки в кінці речення.
    const firstSentence = text.split(/[.!?]/)[0].trim();

    return (
      !/^[.!?]/.test(text) &&
      /^[A-ZА-ЯІЇЄҐ]/.test(text) &&
      firstSentence.length > 0 &&
      !/[.!?]$/.test(firstSentence) &&
      text.length < 80
    );
  }

  // Маркери, після яких номер майже напевно означає тему.
  const SECTION_MARKERS = /(?:§|параграф|парагр\.|пункт|тема|урок|заняття|зміст|модуль)/i;

  // Слова, після яких номер — це посилання, а не заголовок:
  // «мал. 1.6», «табл. 2.1», «на рис. 3.2», «завдання 1.6», «с. 12».
  const REFERENCE_BEFORE =
    /(?:мал|рис|табл|таблиц|завданн|вправ|стор|див|fig|tab|ex)\s*\.?\s*$/i;

  // Чи стоїть номер після слова-посилання («мал. 1.2», «завдання 1.6»).
  function isReferenceNumber(text, index) {
    const before = text
      .slice(Math.max(0, index - 24), index)
      .replace(/[\s\u00a0]+/g, " ");

    if (REFERENCE_BEFORE.test(before)) {
      return true;
    }

    // «завдання 1.6.1», «вправа 2.3.4» — номер є частиною довшого номера.
    const after = text.slice(index, index + 12);

    return /^\d{1,2}\.\d{1,2}\.\d/.test(after);
  }

  // Чи стоять маркери безпосередньо перед номером.
  function hasSectionMarkerBefore(text, index) {
    return SECTION_MARKERS.test(text.slice(Math.max(0, index - 16), index));
  }

  // Маркер впритул перед номером («§ 14», «§14») — це заголовок параграфа,
  // незалежно від того, де він стоїть у рядку: у витягнутому з PDF тексті
  // заголовок часто опиняється в кінці рядка («… | c|? § 14. Множення…»).
  function hasDirectSectionMarker(text, index) {
    return /(?:§|параграф|парагр\.)\s*$/.test(
      text.slice(Math.max(0, index - 12), index)
    );
  }

  // Чи означає номер-число (без крапки) тему: «§ 12. Кислоти», «Урок 5».
  function isNumberedSectionHeading(text, index, numberText) {
    const before = text.slice(Math.max(0, index - 16), index);
    const after = text.slice(index + numberText.length, index + numberText.length + 80);

    if (!SECTION_MARKERS.test(before)) {
      return false;
    }

    return /^[\s.,:]*(?:[A-ZА-ЯІЇЄҐA-Za-z])/.test(after) && after.trim().length > 3;
  }

  // Витягує з частини текст одного параграфа: від заголовка «§ 14. …»
  // до наступного заголовка параграфа.
  //
  // Потрібно, коли користувач просить конкретну тему: інакше в одну частину
  // потрапляють два сусідні параграфи (наприклад § 14 і § 15), і модель
  // складає половину питань не з тієї теми.
  function extractSectionRangeText(chunk, section) {
    const source = String(chunk?.text || "");

    if (!source || !isSingleNumberSection(section)) {
      return null;
    }

    // Заголовок параграфа: «§ 14.», «§14.», «Параграф 14.»
    const startPattern = new RegExp(
      `§\\s*${Number(section)}\\s*\\.\\s*(?=[A-ZА-ЯІЇЄҐA-Z])|` +
      `(?:параграф|парагр\\.)\\s*${Number(section)}\\s*\\.\\s*(?=[A-ZА-ЯІЇЄҐA-Z])`,
      "i"
    );

    const startMatch = startPattern.exec(source);

    if (!startMatch) {
      return null;
    }

    // Наступний заголовок будь-якого параграфа після початку.
    const nextPattern = /§\s*(\d{1,2})\s*\.\s*(?=[A-ZА-ЯІЇЄҐA-Z])/g;
    nextPattern.lastIndex = startMatch.index + startMatch[0].length;

    const nextMatch = nextPattern.exec(source);
    const end = nextMatch ? nextMatch.index : source.length;
    const text = source.slice(startMatch.index, end).trim();

    if (!text) {
      return null;
    }

    // Номери сторінок, які потрапили в діапазон.
    const pages = [];
    const pagePattern = /\[Сторінка (\d+)\]/g;
    let pageMatch;

    while ((pageMatch = pagePattern.exec(text)) !== null) {
      pages.push(Number(pageMatch[1]));
    }

    return {
      text,
      pages,
      pageFrom: pages[0] || chunk.pageFrom,
      pageTo: pages[pages.length - 1] || chunk.pageTo,
      chars: text.length,
      fileName: chunk.fileName || "",
      fileIndex: Number(chunk.fileIndex || 0),
      source: "section-range"
    };
  }

  // Замінює вибрані частини на точний діапазон параграфів, якщо його
  // вдалося визначити. Так модель бачить лише потрібну тему.
  function scopeSelectedSections(chunks, selected, sections) {
    const singleNumbers = (Array.isArray(sections) ? sections : [])
      .filter((section) => isSingleNumberSection(section));

    if (!singleNumbers.length || !Array.isArray(selected)) {
      return selected;
    }

    return selected.map((chunk, position) => {
      const section = singleNumbers[position] || singleNumbers[0];
      const scoped = extractSectionRangeText(chunk, section);

      if (!scoped) {
        return chunk;
      }

      // Зберігаємо індекс і порядок, щоб подальша логіка працювала як раніше.
      return { ...chunk, ...scoped, index: chunk.index };
    });
  }

  // Чи задано тему одним числом («§ 3», «параграф 12») без крапки.
  function isSingleNumberSection(section) {
    return /^\d{1,2}$/.test(String(section || "").trim());
  }

  // Чи є частина довідковою (зміст, покажчик, відповіді).
  //
  // Такі сторінки містять багато номерів параграфів із номерами сторінок,
  // тому вони «виграють» у пошуку заголовків, хоча заголовками не є.
  // Саме через це «тема 2.4» у підручнику з геометрії вибирала сторінки
  // 364–368 (ЗМІСТ) замість змістовної частини книги.
  //
  // Ознака навмисно вузька: довідкові сторінки впізнаємо за рядками
  // «§ N …… стор.» або за заголовком «ЗМІСТ». Ширші правила (напр. «багато
  // згадок § N») помилково відкидають справжні сторінки з вправами
  // («До § 2», «§ 4 1 16. …», «§ 7 2 65. …»), тому вони не використані.
  function isReferenceChunk(chunk) {
    const text = String(chunk?.text || "");

    if (text.length < 200) {
      return false;
    }

    // «§ 4. Назва ........ 21» — рядок змісту. Крапки-виноски обов'язкові
    // саме всередині рядка, інакше це не зміст.
    const tocEntries =
      text.match(/§\s*\d{1,2}[^\n]{0,120}?\.{3,}\s*\d{1,3}/g) || [];

    if (tocEntries.length >= 5) {
      return true;
    }

    // Заголовок «ЗМІСТ»/«CONTENTS» разом із кількома рядками з виносками.
    const hasTitle = /(?:^|[\s\]])(?:ЗМІСТ|CONTENTS|Покажчик|ПОКАЖЧИК)(?:[\s:]|$)/.test(text);

    if (hasTitle && tocEntries.length >= 2) {
      return true;
    }

    // Розділ відповідей: багато коротких «N.M. відповідь» у щільному тексті.
    const answers = text.match(/\d{1,2}\.\d{1,2}\.\s*\d/g) || [];

    return answers.length >= 25 && text.length < 12000;
  }

  // Чи використовує книга нумерацію підрозділів вигляду «N.M».
  // Потрібно, щоб «тема 2.4» не перетворювалась на «тема 4» у книзі,
  // де всі параграфи задані одним числом («§ 4»), бо там такого
  // підрозділу просто не існує.
  //
  // Перевіряти простим регексом не можна: у «§ 1. ОСНОВНІ … 2.4» шаблон
  // знаходить «1.» + перше-ліпше число далі й хибно оголошує книгу
  // «N.M»-книгою. Тому дивимось на ЗАГОЛОВКИ: «§ 1.2. Назва», «1.2. НАЗВА».
  //
  // Друга частина — одна цифра: «2.40.» у збірнику вправ це номер задачі,
  // а не підрозділ, і не має вводити в оману.
  function bookUsesDottedSections(chunks) {
    const markerPattern =
      /(?:§|параграф|парагр\.|пункт|урок|заняття|тема)\s*(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/i;
    const plainPattern = /(?:^|[\n\]])\s*(\d{1,2})\s*[.,]\s*(\d)(?!\d)\s*[.)]?\s*[A-ZА-ЯІЇЄҐ]/;

    return (Array.isArray(chunks) ? chunks : []).some((chunk) => {
      if (isReferenceChunk(chunk)) {
        return false;
      }

      const text = String(chunk?.text || "");

      return markerPattern.test(text) || plainPattern.test(text);
    });
  }

  // Знаходить у матеріалі згадки номера теми, які виглядають як заголовок.
  //
  // Підтримуються формати: «1.2. НАЗВА», «1.2. Назва», «1 .2. НАЗВА»,
  // «Тема 1.2. Назва», «Параграф 3.1 Назва». Для кожної теми в межах
  // частини лишається найкраща згадка, щоб не дублювати вибір.
  function findHeadingOccurrences(chunks, section) {
    const normalized = stripSpacesAroundPunctuation(section);
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^\\d])${escaped}(?![\\d])`, "g");
    const best = new Map();

    (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
      if (typeof chunk?.index !== "number") {
        return;
      }

      // Зміст і покажчик містять усі номери параграфів, але це не заголовки.
      if (isReferenceChunk(chunk)) {
        return;
      }

      const text = stripSpacesAroundPunctuation(chunk?.text || "");
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const tailStart = match.index + match[0].length;
        const tail = text.slice(tailStart, tailStart + 80);

        // «мал. 1.6», «завдання 1.6.1» — це посилання, а не заголовок теми.
        if (isReferenceNumber(text, match.index)) {
          continue;
        }

        const hasMarker = hasSectionMarkerBefore(text, match.index);
        const directMarker = hasDirectSectionMarker(text, match.index);

        if (hasMarker && !directMarker) {
          const tailWork = tail.replace(/^[\s.,:)\]]+/, "");

          // Маркер без § приймаємо, тільки якщо після нього йде назва
          // з великої літери — інакше це стороннє число в тексті.
          if (!/^[A-ZА-ЯІЇЄҐ]/.test(tailWork)) {
            continue;
          }
        }

        if (!looksLikeHeadingTail(tail, { hasMarker })) {
          continue;
        }

        // Заголовок зазвичай починається з великих літер і стоїть на початку
        // рядка/абзацу або після маркера. Збираємо бали, щоб серед кількох
        // згадок номера вибрати саме заголовок.
        // Після номера може стояти крапка («1.6. НАЗВА») — прибираємо її,
        // інакше перевірка великих літер не спрацює.
        const headingStart = tail.replace(/^[\s.,:)\]]+/, "");
        const upperHead = headingStart.match(/^([A-ZА-ЯІЇЄҐ\u00c0-\u00ff]{3,})/);
        const lineStart = /(?:^|\n|\])\s*$/.test(text.slice(0, match.index));
        const sentenceStart = /(?:^|[.!?]\s|\n)\s*$/.test(text.slice(0, match.index));

        // Маркер «§» — найсильніша ознака справжнього заголовка.
        const score =
          (directMarker ? 100 : 0) +
          (hasMarker && !directMarker ? 40 : 0) +
          (upperHead ? 8 : 0) +
          (sentenceStart && !hasMarker ? 2 : 0) +
          (lineStart && !hasMarker ? 1 : 0);

        const key = `${chunk.index}:${normalized}`;
        const existing = best.get(key);

        if (!existing || score > existing.score) {
          best.set(key, {
            section: normalized,
            kind: "heading",
            page: findPageAt(chunk, match.index),
            index: chunk.index,
            score,
            marker: directMarker || hasMarker
          });
        }
      }
    });

    return [...best.values()];
  }

  // Знаходить теми, задані простим числом: «§ 12. Кислоти», «Урок 5. Додавання».
  // Потрібно для підручників, де параграфи не мають вигляду «1.2».
  //
  // Заголовком вважаємо лише той номер, після якого йде НАЗВА з великої літери
  // (через крапку або пробіл). Це відсіює згадки номера всередині тексту,
  // як-от «§ 14 931. Виконайте множення» у збірнику вправ.
  function findNumberedSectionHeadings(chunks) {
    const best = new Map();
    const pattern =
      /(?:§|параграф|парагр\.|пункт|урок|заняття|тема)\s*(\d{1,2})\s*(?:[.)]\s*)?([^\n]{0,70})/gi;

    (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
      if (typeof chunk?.index !== "number") {
        return;
      }

      // Зміст і покажчик перелічують усі параграфи з номерами сторінок —
      // брати їх за заголовок означає складати тест зі змісту.
      if (isReferenceChunk(chunk)) {
        return;
      }

      const text = stripSpacesAroundPunctuation(chunk?.text || "");
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const tail = String(match[2] || "").trim();

        // Має бути назва, а не номер вправи.
        if (!/^[A-ZА-ЯІЇЄҐ]/.test(tail)) {
          continue;
        }

        if (!looksLikeHeadingTail(tail, { hasMarker: true })) {
          continue;
        }

        const number = Number(match[1]);
        const key = `${chunk.index}:${number}`;

        if (best.has(key)) {
          continue;
        }

        best.set(key, {
          section: String(number),
          number,
          kind: "number",
          page: findPageAt(chunk, match.index),
          index: chunk.index,
          score: 2
        });
      }
    });

    return [...best.values()];
  }

  // Визначає номер сторінки за позицією символу в нормалізованому тексті
  // частини, звіряючись із маркерами сторінок.
  function findPageAt(chunk, position) {
    const pages = Array.isArray(chunk?.pages) ? chunk.pages : [];
    const source = String(chunk?.text || "");
    const markerPattern = /\[Сторінка (\d+)\]/g;
    const markers = [];
    let match;

    while ((match = markerPattern.exec(source)) !== null) {
      // Маркери в оригінальному тексті; нормалізація не чіпає «[» і цифри,
      // тому зсув маркера збігається з нормалізованим із точністю до пробілів.
      markers.push({ page: Number(match[1]), at: match.index });
    }

    if (!markers.length) {
      return pages[0] || 0;
    }

    let current = markers[0].page;

    for (const marker of markers) {
      if (marker.at <= position) {
        current = marker.page;
        continue;
      }

      break;
    }

    return current;
  }

  function describeCoverage(selected, total) {
    const pages = (selected || []).reduce((sum, chunk) => {
      return sum + (chunk.pages ? chunk.pages.length : 0);
    }, 0);

    const first = selected?.[0];
    const last = selected?.[selected.length - 1];

    return {
      selectedCount: selected?.length || 0,
      totalCount: total || 0,
      selectedPages: pages,
      pageFrom: first?.pageFrom || 0,
      pageTo: last?.pageTo || 0,
      partial: (selected?.length || 0) < (total || 0)
    };
  }

  // ─── Структура документа ──────────────────────────────────────────────────
  //
  // Завдання: для БУДЬ-ЯКОГО підручника (будь-який предмет, мова, схема
  // нумерації) скласти карту розділів, щоб модель бачила всю книгу, а не
  // перші три частини. Без цього великий PDF оброблявся на ~3%.

  // Слова-маркери розділів. ВАЖЛИВО: регістр має значення — справжній
  // заголовок починається з великої літери, а уривок речення («розділу
  // посібника Перегляньте…») — з малої. Тому окремо перелічуємо великі
  // форми замість прапорця i.
  const OUTLINE_MARKER_CAPITAL =
    "(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Модуль|МОДУЛЬ|Блок|БЛОК|" +
    "Тема|ТЕМА|Урок|УРОК|Заняття|ЗАНЯТТЯ|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|" +
    "Chapter|CHAPTER|Unit|UNIT|Section|SECTION|Topic|TOPIC|Lesson|LESSON|" +
    "Part|PART|Module|MODULE)";
  const OUTLINE_MARKER_NUMBER = new RegExp(
    `^(?:§+\\s*)?${OUTLINE_MARKER_CAPITAL}\\s*№?\\s*\\d{1,2}\\s*$`
  );

  // Ознаки службового тексту, який заголовком не є (вихідні дані книги).
  function isBibliographicLine(value) {
    return (
      /^(?:У\s*Д\s*К|УДК|ББК|ISBN|UDC|DOI)\b/i.test(value) ||
      /\(\d{3}\)\s*\d{2,}/.test(value) ||
      /©/.test(value) ||
      /^\d{4}\s*$/.test(value)
    );
  }

  // Ознаки колонтитула: номер сторінки, зліплений із текстом («51РОЗДІЛ»),
  // або короткий рядок, який додає лише шум.
  function looksLikePageFurniture(value) {
    const text = String(value || "").trim();

    // «51РОЗДІЛ», «121РОЗДІЛ» — у PDF текст колонтитула зліплюється
    // з номером сторінки без пробілу.
    if (/^\d{1,3}[А-ЯІЇЄҐA-Z]{2,}/.test(text)) {
      return true;
    }

    return false;
  }

  // Оцінка «заголовковості» рядка. Вищий бал — більше шансів бути розділом.
  // Потрібна, щоб серед сотень рядків вибрати справжній зміст книги,
  // а не пункти списків і номери задач.
  function scoreOutlineHeading(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      // Провідний номер сторінки, зліплений із заголовком: «19 1.3. НАЗВА»,
      // «101РОЗДІЛ». Без цього залишкові колонтитули тримали високий бал.
      .replace(/^\d{1,3}\s*(?=[А-ЯІЇЄҐA-Z0-9§])/, "")
      .trim();

    if (!text || text.length < 3 || text.length > 100) {
      return 0;
    }

    // Лише цифри та службові знаки — колонцифра.
    if (/^[\d\s.,:;–—-]+$/.test(text)) {
      return 0;
    }

    if (isBibliographicLine(text)) {
      return 0;
    }

    // Рядок без жодної літери — це не назва розділу.
    if (!/[\p{L}]/u.test(text)) {
      return 0;
    }

    const marker = new RegExp(`^(?:§+\\s*)?${OUTLINE_MARKER_CAPITAL}`).test(text);

    // «1.2. НАЗВА» / «1.2 Назва» — нумерований підрозділ. Друга частина
    // номера — одна-дві цифри, тому «2.40.» (номер задачі) не підходить.
    const dotted =
      /^(?:§+\s*)?\d{1,2}\s*[.,]\s*(\d{1,2})(?!\d)\s*[.)]?\s+\S/.test(text) &&
      !/^\d{1,2}\s*[.)]\s*\d/.test(text);

    const markerNumber = OUTLINE_MARKER_NUMBER.test(text);
    const letters = text.match(/[A-Za-zА-Яа-яІіЇїЄєҐґ\u00c0-\u00ff]/g) || [];

    if (letters.length < 2) {
      return 0;
    }

    const upper = letters.filter(
      (character) =>
        character === character.toUpperCase() &&
        character !== character.toLowerCase()
    ).length;
    const upperShare = upper / letters.length;
    const words = text.split(/\s+/).length;

    // Крапка в кінці рядка — ознака речення, а не заголовка. Але
    // трапляється «§ 2. ПОЧАТКОВІ УЯВЛЕННЯ ПРО МНОГОГРАННИКИ.»
    // (нумерована назва з крапкою), тому для маркерів і суцільно великих
    // рядків це не заборона.
    const endsLikeSentence = /[;:,]$/.test(text);
    const looksLikeSentence = /\.$/.test(text) && words >= 8 && upperShare < 0.5;

    let score = 0;

    // Маркер розділу — найсильніша ознака.
    if (marker) {
      score += 60;
    }

    if (dotted) {
      score += 45;
    }

    if (markerNumber) {
      score += 40;
    }

    // Назва переважно з великих літер.
    if (upperShare >= 0.8) {
      score += 30;
    } else if (upperShare >= 0.5) {
      score += 12;
    }

    // Заголовки короткі: 1–9 слів.
    if (words >= 1 && words <= 9) {
      score += 15;
    }

    // Заголовок із номером розділу заслуговує на місце в карті, навіть коли
    // назву записано звичайним регістром: «§ 5. Тиск та його вимірювання»,
    // «1.2. Будова речовини». Без цієї умови підручники з нормальним
    // регістром не давали карти взагалі (0 розділів).
    if (hasSectionNumber(text)) {
      score += 40;
    }

    // Підписи до рисунків і таблиць — не розділи.
    if (/^(?:мал|рис|табл|рисунок|таблиця|fig|figure|table)\b/i.test(text)) {
      score -= 40;
    }

    // Рядок-обчислення або службовий шлях до файлу — не назва розділу.
    const mathLike =
      /[=×÷∙⋅]/.test(text) ||
      /^\d/.test(text) && /[+\-–—*/]\s*\d/.test(text);
    const fileLike = /\.(?:docx?|xlsx?|pptx?|pdf|txt|html?|zip|png|jpe?g)\b/i.test(text) ||
      /[\\/]/.test(text);

    if (mathLike || fileLike) {
      score -= 35;
    }

    // Фрагмент речення: довгий рядок із малою часткою великих літер,
    // який до того ж закінчується як речення.
    if (looksLikeSentence) {
      score -= 30;
    } else if (endsLikeSentence && !marker && !dotted && upperShare < 0.8) {
      score -= 25;
    }

    // Дужка з цифрою (сторінка, рік) — службовий рядок.
    if (/\(\s*\d{1,4}\s*\)/.test(text)) {
      score -= 10;
    }

    return score;
  }

  // Рядок схожий на заголовок розділу? (поріг відсіює пункти списків)
  function looksLikeOutlineHeading(line, options) {
    const threshold = Number(options?.threshold ?? 30);

    return scoreOutlineHeading(line) >= threshold;
  }

  // Витягує заголовки зі сторінок матеріалу, зберігаючи позицію та бал.
  // Працює з будь-якою структурою: PDF-сторінки, суцільний текст.
  function extractOutlineHeadings(pages) {
    const headings = [];

    (Array.isArray(pages) ? pages : []).forEach((page, pageIndex) => {
      const text = cleanMaterialText(page?.text || "");

      if (!text) {
        return;
      }

      const lines = text.split(/\n+/);
      let cursor = 0;

      lines.forEach((line) => {
        const trimmed = line.trim();
        const at = cursor;

        cursor += line.length + 1;

        // Повторюваний колонтитул (номер сторінки + назва розділу) — не
        // заголовок. Без цього карта книги заповнювалась службовими рядками.
        if (looksLikePageFurniture(trimmed)) {
          return;
        }

        const score = scoreOutlineHeading(trimmed);

        if (score < 30) {
          return;
        }

        // Обрізаємо рядок до самої назви, щоб у карту не потрапляв
        // початок абзацу, який іде одразу після заголовка.
        const title = trimmed
          .replace(/\s+\d{1,4}\s*$/, "")
          .slice(0, 100)
          .trim();

        headings.push({
          label: trimmed.slice(0, 90),
          title,
          score,
          pageIndex,
          at,
          page: Number(page?.sourcePage || page?.number || pageIndex + 1)
        });
      });
    });

    return headings;
  }

  // Прибирає з карти колонтитули, які повторюються на багатьох сторінках.
  //
  // Колонтитул — це назва розділу, надрукована вгорі кожної сторінки. У PDF
  // вона виглядає як звичайний заголовок, тому єдина надійна ознака —
  // повторюваність. PDF-витяг робить кожен колонтитул трохи іншим (номер
  // сторінки, зіпсований шрифт), тому порівнюємо «скелет» рядка: цифри,
  // регістр і розділові знаки відкидаємо.
  function dropRepeatedFurniture(headings, options) {
    const list = Array.isArray(headings) ? headings : [];
    const minPages = Math.max(3, Number(options?.minPages || 4));

    const skeletonOf = (value) => {
      return String(value || "")
        .toLowerCase()
        .replace(/\d+/g, "#")
        .replace(/[^\p{L}#]+/gu, " ")
        .trim();
    };

    const pagesBySkeleton = new Map();
    const lengthBySkeleton = new Map();

    list.forEach((heading) => {
      const key = skeletonOf(heading.title);

      if (key.length < 3) {
        return;
      }

      if (!pagesBySkeleton.has(key)) {
        pagesBySkeleton.set(key, new Set());
        lengthBySkeleton.set(key, String(heading.title || "").trim().length);
      }

      pagesBySkeleton.get(key).add(heading.pageIndex);
    });

    return list.filter((heading) => {
      const key = skeletonOf(heading.title);

      if (key.length < 3) {
        return true;
      }

      const pages = pagesBySkeleton.get(key);

      if (!pages || pages.size < minPages) {
        return true;
      }

      // Повторюється на багатьох сторінках. Довгий рядок — це справжній
      // підзаголовок, який просто трапляється кілька разів. Короткий —
      // колонтитул або зіпсований шрифтом службовий рядок.
      const length = lengthBySkeleton.get(key) || 0;

      return length > 30;
    });
  }

  // Лишає першу згадку кожного розділу.
  //
  // PDF-витяг може дати той самий заголовок кілька разів (зміст, колонтитул,
  // повторення на сусідніх сторінках). У карті потрібна одна позиція — та,
  // де розділ справді починається.
  function firstOccurrenceOnly(headings) {
    const seen = new Map();
    const result = [];

    (Array.isArray(headings) ? headings : []).forEach((heading) => {
      const key = String(heading.title || "")
        .toLowerCase()
        .replace(/\d+/g, "#")
        .replace(/[^\p{L}#]+/gu, " ")
        .trim();

      if (key.length < 3) {
        result.push(heading);
        return;
      }

      const existing = seen.get(key);

      if (existing) {
        // Якщо попередня згадка мала нижчий бал, замінюємо її на кращу.
        if (heading.score > existing.score) {
          seen.set(key, heading);
          const at = result.indexOf(existing);
          result[at] = heading;
        }

        return;
      }

      seen.set(key, heading);
      result.push(heading);
    });

    return result;
  }

  // Складає карту з ВЛАСНОГО змісту книги.
  //
  // Це найточніше джерело: підручник сам перелічує свої розділи з номерами
  // сторінок. Працює для будь-якої книги, де зміст є (а в підручниках він є
  // майже завжди). Якщо змісту немає — повертаємо порожній список і
  // працюємо структурним способом.
  function extractOutlineFromContents(pages) {
    const list = Array.isArray(pages) ? pages : [];
    const entries = [];

    list.forEach((page, pageIndex) => {
      const raw = String(page?.text || "");

      if (!raw || !isReferenceChunk({ text: raw })) {
        return;
      }

      // Рядок змісту: «§ 2. Назва .......... 21» або «Розділ 1. Назва .... 6».
      const pattern =
        /((?:§+\s*)?(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Chapter|Unit|Section|Topic)\s*[\d.]*\s*[^.\n]{0,80}?)\s*\.{2,}\s*(\d{1,4})/g;
      let match;

      while ((match = pattern.exec(raw)) !== null) {
        const title = match[1].replace(/\s+/g, " ").trim();

        if (title.length < 3) {
          continue;
        }

        entries.push({
          title,
          printedPage: Number(match[2]),
          pageIndex
        });
      }

      // Другий формат: «1.2. Назва .......... 15» (нумерація підрозділів
      // без слова-маркера).
      const dottedPattern = /(\d{1,2}\s*[.,]\s*\d{1,2}\s*[.)]?\s*[^.\n]{3,70}?)\s*\.{2,}\s*(\d{1,4})/g;

      while ((match = dottedPattern.exec(raw)) !== null) {
        const title = match[1].replace(/\s+/g, " ").trim();

        if (title.length < 3) {
          continue;
        }

        entries.push({
          title,
          printedPage: Number(match[2]),
          pageIndex
        });
      }
    });

    return entries;
  }

  // Перетворює записи змісту на карту з реальними номерами сторінок PDF.
  //
  // У книзі надруковано «21», а в PDF це може бути сторінка 25 — різницю
  // визначаємо за найпростішим зсувом між надрукованим номером і тим, на
  // якій сторінці PDF реально починається відповідний заголовок.
  function outlineFromContents(pages, options) {
    const list = Array.isArray(pages) ? pages : [];
    const entries = extractOutlineFromContents(list);

    if (entries.length < 3) {
      return [];
    }

    // Шукаємо підтвердження кожного запису в тексті книги.
    const bodyPages = list.filter((page) => {
      return !isReferenceChunk({ text: String(page?.text || "") });
    });

    const confirmed = [];

    entries.forEach((entry) => {
      const needle = entry.title.slice(0, 24);

      if (needle.length < 4) {
        return;
      }

      const found = bodyPages.find((page) => {
        return String(page.text || "").includes(needle);
      });

      if (!found) {
        return;
      }

      confirmed.push({
        title: entry.title,
        printedPage: entry.printedPage,
        page: Number(found.sourcePage || found.number || 0),
        offset: Number(found.sourcePage || found.number || 0) - entry.printedPage
      });
    });

    if (confirmed.length < 3) {
      return [];
    }

    // Найчастіший зсув — це і є різниця між друкованою та PDF-сторінкою.
    const counts = new Map();

    confirmed.forEach((item) => {
      counts.set(item.offset, (counts.get(item.offset) || 0) + 1);
    });

    const dominant = [...counts.entries()]
      .filter(([, count]) => count >= Math.max(2, confirmed.length * 0.5))
      .sort((left, right) => right[1] - left[1])[0];

    const offset = dominant ? dominant[0] : 0;
    const lastPage = Number(
      list[list.length - 1]?.sourcePage || list[list.length - 1]?.number || 0
    );
    const limit = Math.max(1, Number(options?.maxHeadings || 200));
    const outline = [];

    confirmed.slice(0, limit).forEach((item, index, array) => {
      const pageFrom = item.offset === offset
        ? item.printedPage + offset
        : item.page;
      const next = array[index + 1];
      const nextPage = next
        ? next.offset === offset
          ? next.printedPage + offset
          : next.page
        : lastPage;
      const pageTo = nextPage > pageFrom ? nextPage : pageFrom;

      outline.push({
        label: item.title,
        title: item.title,
        score: 100,
        pageFrom: Math.max(1, pageFrom),
        pageTo: Math.min(pageTo, lastPage),
        pageIndex: Math.max(0, pageFrom - 1),
        at: 0
      });
    });

    return outline;
  }

  // Чи є після номера справжня назва (а не одиниці виміру чи уривок).
  //
  // «4.2. КНОПКА» — так. «4,3 ГГц 4,3 ГГц» — ні: це фрагмент тексту з
  // одиницями виміру, який випадково починається з «4,3».
  //
  // Вимагаємо слово з чотирьох і більше літер: «КНОПКА», «ПОЛЕ», «ГГц» —
  // останнє відсіюється, бо це скорочення, а не назва розділу.
  function hasRealTitleAfterNumber(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      // Прибираємо провідний номер сторінки, якщо він зліплений із заголовком.
      .replace(/^\d{1,3}\s*(?=[А-ЯІЇЄҐA-Z0-9§])/, "")
      .trim();
    const withoutNumber = text
      .replace(
        /^(?:§+\s*)?(?:\d{1,2}\s*[.,]\s*\d{1,2}|(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Chapter|CHAPTER|Unit|UNIT|Section|SECTION|Topic|TOPIC|Lesson|LESSON)\s*\d{1,2})/i,
        " "
      )
      .replace(/^[\s.,:;)\]]+/, "")
      .trim();
    const words = withoutNumber.match(/[\p{L}]{2,}/gu) || [];

    // Службовий шлях до файлу або підпис із розширенням — не назва розділу.
    // У підручниках із вправами трапляється «Розділ 5\Пункт 5.2\завдання.docx».
    if (/\.(?:docx?|xlsx?|pptx?|pdf|txt|html?|zip|png|jpe?g)\b/i.test(withoutNumber)) {
      return false;
    }

    if (/[\\/]/.test(withoutNumber)) {
      return false;
    }

    // Зіпсований вбудованим шрифтом PDF текст: кирилиця замінена символами
    // діапазону À–ÿ («¬ÐÆÕÄÂÏÏá»). Справжніх назв там немає, тому такий
    // рядок у карту не беремо.
    const mojibake = withoutNumber.match(/[\u00c0-\u00ff]/g) || [];

    if (mojibake.length >= 4) {
      return false;
    }

    // Потрібно хоч одне слово з чотирьох літер — саме назва.
    return words.some((word) => word.length >= 4);
  }

  // Чи несе рядок номер розділу («1.2.», «§ 5», «Розділ 3»).
  //
  // Це найнадійніша ознака справжнього заголовка: підручник нумерує свої
  // розділи, а колонтитули, підписи й уривки тексту — ні.
  function hasSectionNumber(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^\d{1,3}\s*(?=[А-ЯІЇЄҐA-Z0-9§])/, "")
      .trim();

    // «1.2.», «1.2 Назва», «1.10.» — нумерований підрозділ. Друга частина
    // може бути двоцифровою: у великих підручниках буває 15 параграфів
    // у розділі. Номери вправ відсіюються окремо, під час вибору карти.
    if (/^\d{1,2}\s*[.,]\s*\d{1,2}(?!\d)/.test(text)) {
      return true;
    }

    // «§ 5. Назва», «§ 5 Назва», «§5» — маркер параграфа. Крапка після номера
    // є частиною самого заголовка, а не початком підрозділу.
    if (/^§+\s*\d{1,2}(?!\d)/.test(text)) {
      return true;
    }

    // «Розділ 2», «Тема 5», «Урок 7», «Chapter 3», «Unit 4».
    // Номер до 3 цифр: у книгах буває «Розділ 12», але не «Розділ 123».
    return /^(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Урок|УРОК|Заняття|ЗАНЯТТЯ|Chapter|CHAPTER|Unit|UNIT|Section|SECTION|Topic|TOPIC|Lesson|LESSON)\s*\d{1,3}(?!\d)/i.test(
      text
    );
  }

  // Чи позначено розділ словом-маркером: «§ 12. Назва», «Розділ 3»,
  // «Тема 5», «Chapter 2». Саме маркер відрізняє справжній розділ від
  // номера вправи, який виглядає так само («1.16. Текст задачі»).
  function isMarkerHeading(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^\d{1,3}\s*(?=[А-ЯІЇЄҐA-Z0-9§])/, "")
      .trim();

    if (/^§+\s*\d{1,3}(?!\d)/.test(text)) {
      return true;
    }

    return /^(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Урок|УРОК|Заняття|ЗАНЯТТЯ|Chapter|CHAPTER|Unit|UNIT|Section|SECTION|Topic|TOPIC|Lesson|LESSON)\s*\d{1,3}(?!\d)/i.test(
      text
    );
  }

  // Чи несе рядок лише номер без підрозділу: «§ 5», «Тема 3», «Розділ 2».
  function isSingleNumberHeading(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();

    if (/^§+\s*\d{1,2}(?!\d)/.test(text)) {
      return true;
    }

    return /^(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Урок|УРОК|Заняття|ЗАНЯТТЯ|Chapter|CHAPTER|Unit|UNIT|Section|SECTION|Topic|TOPIC|Lesson|LESSON)\s*\d{1,3}(?!\d)/i.test(
      text
    );
  }

  // Номер розділу з рядка без назви: «1.2.» → «1.2», «§ 5» → «5».
  function sectionNumberOf(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const dotted = text.match(/^(?:\d{1,3}\s*)?(?:§+\s*)?(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/);

    if (dotted) {
      return `${Number(dotted[1])}.${Number(dotted[2])}`;
    }

    const marked = text.match(
      /^(?:\d{1,3}\s*)?(?:§+\s*)?(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Урок|УРОК|Заняття|ЗАНЯТТЯ|Chapter|CHAPTER|Unit|UNIT|Section|SECTION|Topic|TOPIC|Lesson|LESSON)\s*(\d{1,3})(?!\d)/i
    );

    if (marked) {
      return String(Number(marked[1]));
    }

    const single = text.match(/^(?:\d{1,3}\s*)?§+\s*(\d{1,3})(?!\d)/);

    return single ? String(Number(single[1])) : "";
  }

  // Складає карту з номерних заголовків.
  //
  // Книга нумерує свої розділи — це єдине джерело, яке не залежить від
  // шрифту, мови чи верстки. Колонтитули, підписи до рисунків і уривки
  // тексту номерів не мають, тому сюди не потрапляють.
  function outlineFromNumberedHeadings(pages, options) {
    const list = Array.isArray(pages) ? pages : [];
    const all = extractOutlineHeadings(list);
    const usable = all.filter((heading) => hasRealTitleAfterNumber(heading.title));

    // Розділ може бути позначений маркером («§ 12. Назва», «Розділ 3»,
    // «Тема 5») або лише номером («1.2. Назва»).
    //
    // Розрізняти їх принципово: у підручниках справжні розділи майже завжди
    // мають маркер, а вправи — ні, хоч виглядають так само («1.16. Чи можуть
    // пряма й площина…»). Тому коли маркерів достатньо, беремо лише їх.
    const isMarker = (title) => isMarkerHeading(title);
    const marked = usable.filter((heading) => isMarker(heading.title));
    const bare = usable.filter((heading) => {
      if (isMarker(heading.title)) {
        return false;
      }

      return /^\d{1,2}\s*[.,]\s*\d{1,2}(?!\d)/.test(
        String(heading.title || "").replace(/\s+/g, " ").trim()
      );
    });

    // Багато «N.M.» без маркера — це радше нумерація вправ, ніж розділів:
    // справжніх підрозділів у книзі буває небагато.
    const bareLimit = Math.max(2, Number(options?.maxBareHeadings || 6));
    const candidates = marked.length >= 3
      ? [...marked, ...bare.slice(0, bareLimit)]
      : usable;

    if (candidates.length < 3) {
      return [];
    }

    // Для кожного номера розділу лишаємо найкращу згадку: у книзі той самий
    // номер трапляється в колонтитулі, у змісті та в самому заголовку.
    //
    // Перевагу віддаємо «чистому» заголовку, який починається одразу з
    // номера («1.1. НАЗВА»), а не колонтитулу з номером сторінки попереду
    // («7§ 1.1. Назва»).
    const canonicalBonus = (title) => {
      const clean = String(title || "").replace(/\s+/g, " ").trim();
      const startsClean = /^(?:§+\s*)?(?:\d{1,2}\s*[.,]\s*\d{1,2}|(?:Розділ|РОЗДІЛ|Глава|ГЛАВА|Частина|ЧАСТИНА|Тема|ТЕМА|Параграф|ПАРАГРАФ|Пункт|ПУНКТ|Chapter|Unit|Section|Topic|Lesson)\s*\d)/i.test(
        clean
      );
      const upperShare = (() => {
        const letters = clean.match(/[A-Za-zА-Яа-яІіЇїЄєҐґ]/g) || [];

        if (!letters.length) {
          return 0;
        }

        return letters.filter(
          (character) =>
            character === character.toUpperCase() &&
            character !== character.toLowerCase()
        ).length / letters.length;
      })();

      return (startsClean ? 20 : 0) + Math.round(upperShare * 10);
    };

    const rank = (heading) => heading.score + canonicalBonus(heading.title);
    const best = new Map();

    candidates.forEach((heading) => {
      const number = sectionNumberOf(heading.title);

      if (!number) {
        return;
      }

      const existing = best.get(number);

      if (!existing || rank(heading) > rank(existing)) {
        best.set(number, { ...heading, number });
      }
    });

    const items = [...best.values()].sort((left, right) => {
      return left.page - right.page || left.at - right.at;
    });

    if (items.length < 3) {
      return [];
    }

    const lastPage = Number(
      list[list.length - 1]?.sourcePage || list[list.length - 1]?.number || 0
    );
    const limit = Math.max(1, Number(options?.maxHeadings || 200));

    return items.slice(0, limit).map((item, index, array) => {
      const next = array[index + 1];
      const pageFrom = item.page;
      const pageTo = next && next.page > pageFrom ? next.page : lastPage;

      return {
        label: item.title,
        title: item.title,
        score: item.score,
        pageFrom,
        pageTo,
        pageIndex: item.pageIndex,
        at: item.at
      };
    });
  }

  // Відкат: карта за назвами, записаними великими літерами.
  //
  // Потрібен для книг, де PDF розриває «§ 12. НАЗВА» на різні рядки — номер
  // губиться, лишається сама назва. У підручниках такі назви верстають
  // великими літерами, тому вони надійно відрізняються від тексту.
  function outlineFromStructuralHeadings(pages, options) {
    const list = Array.isArray(pages) ? pages : [];
    const all = extractOutlineHeadings(list);

    // Спершу об'єднуємо назви, розірвані на сусідні рядки: у підручниках
    // заголовок часто займає два-три рядки, і кожен рядок окремо виглядає
    // як окремий «розділ».
    const merged = [];

    all.forEach((heading) => {
      const previous = merged[merged.length - 1];

      if (
        previous &&
        previous.pageIndex === heading.pageIndex &&
        heading.at - previous.at <= 120
      ) {
        previous.title = `${previous.title} ${heading.title}`.slice(0, 140).trim();
        previous.at = heading.at;
        previous.score = Math.max(previous.score, heading.score);
        return;
      }

      merged.push({ ...heading });
    });

    const titles = merged.filter((heading) => {
      const text = String(heading.title || "").trim();
      const words = text.match(/[\p{L}]{2,}/gu) || [];
      const letters = text.match(/[\p{L}]/gu) || [];
      const upper = letters.filter(
        (character) =>
          character === character.toUpperCase() &&
          character !== character.toLowerCase()
      ).length;

      if (letters.length < 5 || upper / letters.length < 0.85) {
        return false;
      }

      if (!/^[\p{Lu}]/u.test(text)) {
        return false;
      }

      // Назва розділу — це слова, а не послідовність літер чи символів.
      // «А Б В Г Д» і «МАГ, ВВ, АВ» відсіюються: у них замало довгих слів.
      const longWords = words.filter((word) => word.length >= 4);

      if (longWords.length < 2) {
        return false;
      }

      // Розділовий знак у кінці речення — ознака тексту, а не заголовка.
      if (/[;:]$/.test(text)) {
        return false;
      }

      return text.split(/\s+/).length <= 14;
    });

    if (titles.length < 3) {
      return [];
    }

    // У книзі назва розділу часто займає кілька рядків і повторюється
    // в колонтитулах, тому лишаємо найкращу згадку кожного «скелета».
    const best = new Map();

    titles.forEach((heading) => {
      const key = String(heading.title || "")
        .toLowerCase()
        .replace(/\d+/g, "#")
        .replace(/[^\p{L}#]+/gu, " ")
        .trim();

      if (key.length < 4) {
        return;
      }

      const existing = best.get(key);

      if (!existing || heading.score > existing.score) {
        best.set(key, heading);
      }
    });

    const items = [...best.values()].sort((left, right) => {
      return left.page - right.page || left.at - right.at;
    });

    if (items.length < 3) {
      return [];
    }

    const lastPage = Number(
      list[list.length - 1]?.sourcePage || list[list.length - 1]?.number || 0
    );
    const limit = Math.max(1, Number(options?.maxHeadings || 200));

    return items.slice(0, limit).map((item, index, array) => {
      const next = array[index + 1];
      const pageFrom = item.page;
      const pageTo = next && next.page > pageFrom ? next.page : lastPage;

      return {
        label: item.title,
        title: item.title,
        score: item.score,
        pageFrom,
        pageTo,
        pageIndex: item.pageIndex,
        at: item.at
      };
    });
  }

  // Чи справді карта спирається на сторінки з матеріалом, а не на зміст.
  //
  // Якщо більшість пунктів узято зі сторінок змісту, така карта марна:
  // номери розділів є, але назв і тексту за ними немає.
  function numberedCoversContent(outline, pages) {
    const items = Array.isArray(outline) ? outline : [];
    const list = Array.isArray(pages) ? pages : [];

    if (!items.length) {
      return false;
    }

    const referencePages = new Set();

    list.forEach((page, index) => {
      if (isReferenceChunk({ text: String(page?.text || "") })) {
        referencePages.add(Number(page?.sourcePage || page?.number || index + 1));
      }
    });

    if (!referencePages.size) {
      return true;
    }

    const fromContent = items.filter((item) => !referencePages.has(item.pageFrom)).length;

    return fromContent / items.length >= 0.5;
  }

  // Складає карту документа: заголовок → сторінки, на яких він діє.
  // Це «зміст», який система будує сама, тому він є для будь-якого PDF.
  function buildDocumentOutline(pages, options) {
    const list = Array.isArray(pages) ? pages : [];

    // 1. Найточніше джерело — власний зміст книги.
    const fromContents = outlineFromContents(list, options);

    if (fromContents.length >= 3) {
      return fromContents;
    }

    // 2. Друге за точністю — номерні заголовки. Підручник нумерує розділи,
    //    тому цей шлях дає справжній зміст навіть коли власний зміст
    //    нечитабельний або його немає.
    //
    //    Поріг 8, а не 3: у частині книг PDF розриває «§ 12. НАЗВА» на різні
    //    рядки, і тоді номерних заголовків лишається кілька випадкових.
    const fromNumbers = outlineFromNumberedHeadings(list, options);
    const structural = outlineFromStructuralHeadings(list, options);

    const numberedGood = fromNumbers.length >= 8;
    const structuralGood = structural.length >= 3;

    if (numberedGood) {
      // Номерні заголовки можуть узятися лише зі змісту книги: у частині
      // підручників шрифт заголовків у контенті зіпсовано, і номери
      // лишаються тільки на сторінках змісту. Така карта гірша за
      // структурну, яка спирається на самі назви розділів.
      if (!structuralGood || numberedCoversContent(fromNumbers, list)) {
        return fromNumbers;
      }
    }

    // 3. Назви розділів великими літерами — працює навіть коли номери
    //    втрачено, і саме тому це надійніший шлях для таких книг.
    if (structuralGood) {
      return structural;
    }

    if (fromNumbers.length >= 3) {
      return fromNumbers;
    }

    return [];
    const cleaned = dropRepeatedFurniture(extractOutlineHeadings(list), options);
    const headings = firstOccurrenceOnly(cleaned);

    if (!headings.length) {
      return [];
    }

    // Назва розділу часто займає два рядки («Розділ 1.» + «ВСТУП ДО КУРСУ»).
    // Зливаємо лише такі випадки: та сама сторінка і дуже близька позиція.
    // Широке правило «та сама сторінка» помилково з'їдало сусідні параграфи.
    const merged = [];

    headings.forEach((heading) => {
      const previous = merged[merged.length - 1];

      if (
        previous &&
        previous.pageIndex === heading.pageIndex &&
        heading.at - previous.at <= 160
      ) {
        previous.title = `${previous.title} ${heading.label}`.slice(0, 160);
        previous.score = Math.max(previous.score, heading.score);
        previous.at = heading.at;
        return;
      }

      merged.push({ ...heading });
    });

    // Зміст книги перелічує ті самі назви — лишаємо першу згадку,
    // бо саме вона є початком розділу, а не посиланням у змісті.
    const seen = new Set();
    const unique = [];

    merged.forEach((heading) => {
      const key = heading.title
        .toLowerCase()
        .replace(/[\s.]+/g, " ")
        .trim();

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      unique.push(heading);
    });

    // Справжніх розділів у книзі десятки, а «заголовкових» рядків бувають
    // сотні (пункти списків, номери задач, уривки речень). Лишаємо найсильніші:
    // маркер розділу, нумерований підрозділ або назва великими літерами.
    // Поріг 45 відсікає уривки речень і номери задач.
    const limit = Math.max(maxHeadings, 60);
    const strong = unique.filter((heading) => heading.score >= 45);
    const chosen = (strong.length >= 3 ? strong : unique)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .sort((left, right) => left.pageIndex - right.pageIndex || left.at - right.at);

    const lastPage = Number(
      list[list.length - 1]?.sourcePage || list[list.length - 1]?.number || 0
    );

    return chosen.map((heading, index, array) => {
      const next = array[index + 1];
      const pageFrom = heading.page;
      const pageTo = next ? next.page : lastPage;

      return {
        label: heading.label,
        title: heading.title,
        score: heading.score,
        pageFrom,
        pageTo: pageTo >= pageFrom ? pageTo : pageFrom,
        pageIndex: heading.pageIndex,
        at: heading.at
      };
    });
  }

  // Компактний текстовий «зміст» для моделі.
  // Обрізаємо так, щоб він не з'їдав весь бюджет запиту.
  function formatOutlineForModel(outline, options) {
    const list = Array.isArray(outline) ? outline : [];
    const maxChars = Math.max(200, Number(options?.maxChars || 12000));
    const lines = [];

    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      const title = String(item.title || item.label || "").replace(/\s+/g, " ").trim();

      if (!title) {
        continue;
      }

      const range = item.pageFrom
        ? item.pageFrom === item.pageTo
          ? `с. ${item.pageFrom}`
          : `с. ${item.pageFrom}–${item.pageTo}`
        : "—";
      const line = `[${index + 1}] ${range} — ${title}`;
      const projected = lines.join("\n").length + line.length + 1;

      if (projected > maxChars) {
        lines.push(`… (ще ${list.length - index} розділів не показано)`);
        break;
      }

      lines.push(line);
    }

    return lines.join("\n");
  }

  // Перетворює вибір моделі («1, 4, 7-9») на список індексів карти.
  // Модель може відповісти по-різному, тому приймаємо будь-який формат.
  function parseOutlineSelection(value, total) {
    const limit = Math.max(0, Number(total || 0));
    const indexes = new Set();
    const text = Array.isArray(value) ? value.join(",") : String(value || "");

    // Діапазони «5-8», «5–8», «5 — 8».
    const rangePattern = /(\d{1,4})\s*[-–—]\s*(\d{1,4})/g;
    let match;

    while ((match = rangePattern.exec(text)) !== null) {
      const from = Number(match[1]);
      const to = Number(match[2]);

      for (let index = from; index <= to && index - from < 200; index++) {
        if (index >= 1 && index <= limit) {
          indexes.add(index);
        }
      }
    }

    const withoutRanges = text.replace(rangePattern, " ");

    (withoutRanges.match(/\d{1,4}/g) || []).forEach((raw) => {
      const index = Number(raw);

      if (index >= 1 && index <= limit) {
        indexes.add(index);
      }
    });

    return [...indexes].sort((left, right) => left - right);
  }

  // Частини матеріалу, які належать обраним пунктам карти.
  //
  // pageTo у карті — це сторінка, де починається НАСТУПНИЙ розділ, тому
  // останню сторінку діапазону не включаємо: інакше разом із розділом
  // захоплювався б і початок наступного.
  function chunksForOutlineItems(chunks, outline, indexes) {
    const list = Array.isArray(chunks) ? chunks : [];
    const items = Array.isArray(outline) ? outline : [];
    const wanted = [];

    (Array.isArray(indexes) ? indexes : []).forEach((index) => {
      const item = items[index - 1];

      if (!item) {
        return;
      }

      const from = Number(item.pageFrom || 0);
      const to = Number(item.pageTo || item.pageFrom || 0);

      list.forEach((chunk) => {
        const chunkFrom = Number(chunk?.pageFrom || 0);
        const chunkTo = Number(chunk?.pageTo || 0);

        if (!chunkFrom || !chunkTo) {
          return;
        }

        // Останній розділ не має наступного, тому в нього межа включна.
        const last = index === items.length;
        const fits = last
          ? chunkFrom >= from && chunkFrom <= to
          : chunkFrom >= from && chunkFrom < to;

        if (fits && !wanted.includes(chunk)) {
          wanted.push(chunk);
        }
      });
    });

    return sortByIndex(wanted);
  }

  return {
    cleanMaterialText,
    mojibakeRatio,
    buildChunks,
    formatPageRange,
    extractRequestedSections,
    expandChaptersToSections,
    extractSectionRangeText,
    scopeSelectedSections,
    buildSectionIndex,
    sectionsOfChapter,
    chunkMentionsSection,
    findHeadingOccurrences,
    findNumberedSectionHeadings,
    isReferenceChunk,
    bookUsesDottedSections,
    looksLikeHeadingTail,
    looksLikeOutlineHeading,
    scoreOutlineHeading,
    isBibliographicLine,
    looksLikePageFurniture,
    dropRepeatedFurniture,
    firstOccurrenceOnly,
    extractOutlineFromContents,
    outlineFromContents,
    hasSectionNumber,
    isMarkerHeading,
    isSingleNumberHeading,
    hasRealTitleAfterNumber,
    sectionNumberOf,
    outlineFromNumberedHeadings,
    outlineFromStructuralHeadings,
    numberedCoversContent,
    extractOutlineHeadings,
    buildDocumentOutline,
    formatOutlineForModel,
    parseOutlineSelection,
    chunksForOutlineItems,
    groupChunksByFile,
    scoreFileForPrompt,
    selectChunksForPrompt,
    describeCoverage,
    DEFAULT_CHUNK_CHARS
  };
});
