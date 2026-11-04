// injected.js — автоматизація Angular-конструктора тестів для AI Quiz Generator.
// Adds questions and can remove the last inserted batch.

(function () {
  "use strict";

  if (
    window.__quizGenInjectedV7Loaded
  ) {
    return;
  }

  window.__quizGenInjectedV7Loaded =
    true;

  const UNDO_STORAGE_KEY =
    "__quizGen_last_insertion_v7";

  let isBusy = false;

  console.log(
    "[AI Quiz Generator] Injected automation loaded"
  );

  document.addEventListener(
    "quizgen-insert",
    async (event) => {
      const detail =
        event.detail || {};

      const requestId =
        detail.requestId || "";

      const questions =
        Array.isArray(
          detail.questions
        )
          ? detail.questions
          : [];

      if (isBusy) {
        dispatchInsertResult({
          requestId,

          error:
            "Інша операція вже виконується."
        });

        return;
      }

      isBusy = true;

      try {
        if (!questions.length) {
          throw new Error(
            "Немає питань для вставки."
          );
        }

        const normalizedQuestions =
          questions
            .map(
              normalizeGeneratedQuestion
            )
            .filter(Boolean);

        if (
          !normalizedQuestions.length
        ) {
          throw new Error(
            "Питання мають неправильний формат."
          );
        }

        const beforeSnapshot =
          captureQuestionSnapshot();

        let createdCount = 0;

        for (
          let index = 0;
          index <
          normalizedQuestions.length;
          index++
        ) {
          await createQuestion(
            normalizedQuestions[index],
            index,
            normalizedQuestions.length
          );

          createdCount++;
        }

        await sleep(1000);

        await returnToQuestionListSafe();

        await sleep(500);

        const afterSnapshot =
          captureQuestionSnapshot();

        const undoToken =
          createUndoToken({
            beforeSnapshot,
            afterSnapshot,

            questions:
              normalizedQuestions,

            insertedCount:
              createdCount
          });

        sessionStorage.setItem(
          UNDO_STORAGE_KEY,
          JSON.stringify(undoToken)
        );

        dispatchProgress(
          "Готово!",
          100
        );

        dispatchInsertResult({
          requestId,
          count: createdCount,
          undoToken
        });
      } catch (error) {
        console.error(
          "[AI Quiz Generator] Insert error:",
          error
        );

        dispatchInsertResult({
          requestId,

          error:
            error.message ||
            "Помилка вставки питань."
        });
      } finally {
        isBusy = false;
      }
    }
  );

  document.addEventListener(
    "quizgen-cancel-insert",
    async (event) => {
      const detail =
        event.detail || {};

      const requestId =
        detail.requestId || "";

      if (isBusy) {
        dispatchCancelResult({
          requestId,

          error:
            "Інша операція вже виконується."
        });

        return;
      }

      isBusy = true;

      try {
        let undoToken =
          detail.undoToken || null;

        if (!undoToken) {
          const stored =
            sessionStorage.getItem(
              UNDO_STORAGE_KEY
            );

          undoToken =
            stored
              ? JSON.parse(stored)
              : null;
        }

        if (!undoToken) {
          throw new Error(
            "Немає даних про останню вставку."
          );
        }

        dispatchProgress(
          "Видалення вставлених питань...",
          10
        );

        const deletedCount =
          await rollbackInsertion(
            undoToken
          );

        sessionStorage.removeItem(
          UNDO_STORAGE_KEY
        );

        dispatchProgress(
          "Вставку скасовано.",
          100
        );

        dispatchCancelResult({
          requestId,
          count: deletedCount
        });
      } catch (error) {
        console.error(
          "[AI Quiz Generator] Cancel error:",
          error
        );

        dispatchCancelResult({
          requestId,

          error:
            error.message ||
            "Не вдалося скасувати вставку."
        });
      } finally {
        isBusy = false;
      }
    }
  );

  async function createQuestion(
    question,
    index,
    total
  ) {
    dispatchProgress(
      `Створення питання ${index + 1} з ${total}`,
      Math.round(
        (
          index /
          Math.max(total, 1)
        ) * 90
      )
    );

    const newQuestionButton =
      document.querySelector(
        '[ng-click="builder.newQuestion()"]'
      );

    if (!newQuestionButton) {
      throw new Error(
        "Кнопка «Нове питання» не знайдена."
      );
    }

    newQuestionButton.click();

    await sleep(1200);

    const context =
      getBuilderContext();

    if (!context) {
      throw new Error(
        "Не вдалося отримати Angular scope конструктора."
      );
    }

    const {
      builder,
      scope,
      createButton
    } = context;

    if (
      !builder.data ||
      !builder.data.question
    ) {
      throw new Error(
        "Не знайдено дані нового питання."
      );
    }

    const builderQuestion =
      builder.data.question;

    builderQuestion.type =
      question.type;

    builderQuestion.content =
      `<p>${escapeHtml(
        question.question
      )}</p>`;

    if (
      question.image &&
      typeof question.image ===
        "string"
    ) {
      builderQuestion.image =
        question.image.trim() ||
        null;
    } else {
      builderQuestion.image =
        null;
    }

    if (
      !Array.isArray(
        builderQuestion.options
      )
    ) {
      builderQuestion.options = [];
    }

    while (
      builderQuestion.options
        .length <
      question.answers.length
    ) {
      builderQuestion.options.push({
        value: "",
        correct: 0,
        image: null
      });
    }

    if (
      builderQuestion.options
        .length >
      question.answers.length
    ) {
      builderQuestion.options =
        builderQuestion.options.slice(
          0,
          question.answers.length
        );
    }

    builderQuestion.options.forEach(
      (option, answerIndex) => {
        const answer =
          question.answers[
            answerIndex
          ];

        option.correct = 0;

        if (
          typeof answer ===
          "string"
        ) {
          option.value =
            `<p>${escapeHtml(
              answer
            )}</p>`;

          option.image = null;
          return;
        }

        if (
          answer &&
          typeof answer ===
            "object"
        ) {
          option.value =
            `<p>${escapeHtml(
              answer.text ||
              `Варіант ${answerIndex + 1}`
            )}</p>`;

          option.image =
            answer.image || null;

          return;
        }

        option.value =
          `<p>Варіант ${answerIndex + 1}</p>`;

        option.image = null;
      }
    );

    builderQuestion.options.forEach(
      (option) => {
        option.correct = 0;
      }
    );

    if (
      question.type ===
      "multiquiz"
    ) {
      question.correct.forEach(
        (correctIndex) => {
          if (
            builderQuestion.options[
              correctIndex
            ]
          ) {
            builderQuestion.options[
              correctIndex
            ].correct = 1;
          }
        }
      );
    } else {
      const correctIndex =
        question.correct[0] || 0;

      if (
        typeof builder.correctRadio ===
        "function"
      ) {
        builder.correctRadio(
          correctIndex
        );
      } else {
        builderQuestion.options.forEach(
          (
            option,
            optionIndex
          ) => {
            option.correct =
              optionIndex ===
              correctIndex
                ? 1
                : 0;
          }
        );
      }
    }

    applyScope(scope);

    await sleep(500);

    if (
      typeof builder.createQuestion ===
      "function"
    ) {
      const result =
        builder.createQuestion();

      if (
        result &&
        typeof result.then ===
          "function"
      ) {
        await result;
      }
    } else {
      createButton.click();
    }

    applyScope(scope);

    await waitForQuestionSave(
      question.question,
      10000
    );

    console.log(
      `[AI Quiz Generator] Created ${index + 1}/${total}:`,
      question.question
    );
  }


  async function returnToQuestionListSafe() {
    const context =
      getBuilderContext();

    if (
      context?.builder &&
      context?.scope
    ) {
      const methods = [
        "cancelQuestion",
        "closeQuestion",
        "backToQuestions",
        "showQuestions",
        "goToQuestions",
        "questionList",
        "resetQuestionForm"
      ];

      for (const method of methods) {
        if (
          typeof context.builder[method] === "function"
        ) {
          try {
            context.builder[method]();

            applyScope(context.scope);

            await sleep(700);

            if (isQuestionListViewSafe()) {
              return true;
            }
          } catch (_) {}
        }
      }
    }

    const selectors = [
      '[ng-click="builder.cancelQuestion()"]',
      '[ng-click="builder.closeQuestion()"]',
      '[ng-click="builder.backToQuestions()"]',
      '[ng-click="builder.showQuestions()"]',
      '[ng-click*="cancelQuestion"]',
      '[ng-click*="closeQuestion"]',
      '[ng-click*="backToQuestions"]',
      '[ng-click*="showQuestions"]',
      '[data-ng-click*="cancelQuestion"]',
      '[data-ng-click*="closeQuestion"]',
      '[data-ng-click*="backToQuestions"]',
      '[data-ng-click*="showQuestions"]'
    ];

    for (const selector of selectors) {
      const element =
        document.querySelector(selector);

      if (
        element &&
        isVisibleElementSafe(element)
      ) {
        clickElement(element);

        await sleep(800);

        if (isQuestionListViewSafe()) {
          return true;
        }
      }
    }

    const backWords = [
      "до списку",
      "до питань",
      "повернутися",
      "назад",
      "закрити",
      "скасувати"
    ];

    const bannedWords = [
      "видалити",
      "зберегти",
      "опублікувати",
      "вийти"
    ];

    const candidates =
      Array.from(
        document.querySelectorAll(
          "button,a,.btn,[role='button']"
        )
      );

    for (const element of candidates) {
      if (!isVisibleElementSafe(element)) {
        continue;
      }

      const text =
        normalizeText(
          element.innerText ||
          element.textContent ||
          element.getAttribute("title") ||
          ""
        );

      if (!text) {
        continue;
      }

      if (
        bannedWords.some((word) =>
          text.includes(word)
        )
      ) {
        continue;
      }

      if (
        !backWords.some((word) =>
          text.includes(word)
        )
      ) {
        continue;
      }

      clickElement(element);

      await sleep(800);

      if (isQuestionListViewSafe()) {
        return true;
      }
    }

    return false;
  }

  function isQuestionListViewSafe() {
    const createButton =
      document.querySelector(
        '[ng-click="builder.createQuestion()"]'
      );

    const newQuestionButton =
      document.querySelector(
        '[ng-click="builder.newQuestion()"]'
      );

    const createVisible =
      createButton &&
      isVisibleElementSafe(createButton);

    const newVisible =
      newQuestionButton &&
      isVisibleElementSafe(newQuestionButton);

    return Boolean(newVisible && !createVisible);
  }

  function isVisibleElementSafe(element) {
    if (!element) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    if (
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return false;
    }

    const style =
      window.getComputedStyle(element);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }


  function getBuilderContext() {
    const createButton =
      document.querySelector(
        '[ng-click="builder.createQuestion()"]'
      );

    const newQuestionButton =
      document.querySelector(
        '[ng-click="builder.newQuestion()"]'
      );

    const referenceElement =
      createButton ||
      newQuestionButton ||
      document.body;

    if (!window.angular) {
      return null;
    }

    let scope = null;

    try {
      const angularElement =
        window.angular.element(
          referenceElement
        );

      scope =
        angularElement.scope?.() ||
        angularElement
          .isolateScope?.();
    } catch (_) {}

    let currentScope = scope;

    for (
      let level = 0;
      level < 12 &&
      currentScope;
      level++
    ) {
      if (currentScope.builder) {
        return {
          scope: currentScope,
          builder:
            currentScope.builder,
          createButton
        };
      }

      currentScope =
        currentScope.$parent;
    }

    try {
      const bodyScope =
        window.angular
          .element(document.body)
          .scope?.();

      currentScope = bodyScope;

      for (
        let level = 0;
        level < 12 &&
        currentScope;
        level++
      ) {
        if (
          currentScope.builder
        ) {
          return {
            scope:
              currentScope,

            builder:
              currentScope.builder,

            createButton
          };
        }

        currentScope =
          currentScope.$parent;
      }
    } catch (_) {}

    return null;
  }

  function normalizeGeneratedQuestion(
    raw
  ) {
    if (
      !raw ||
      typeof raw !== "object"
    ) {
      return null;
    }

    const question =
      String(
        raw.question ||
        raw.text ||
        ""
      ).trim();

    const answers =
      Array.isArray(raw.answers)
        ? raw.answers
            .map((answer) => {
              if (
                typeof answer ===
                "string"
              ) {
                return answer.trim();
              }

              if (
                answer &&
                typeof answer ===
                  "object"
              ) {
                return {
                  text:
                    String(
                      answer.text ||
                      ""
                    ).trim(),

                  image:
                    answer.image ||
                    null
                };
              }

              return "";
            })
            .filter(Boolean)
        : [];

    if (
      !question ||
      answers.length < 2
    ) {
      return null;
    }

    const correctRaw =
      Array.isArray(raw.correct)
        ? raw.correct
        : [raw.correct];

    const correct =
      correctRaw
        .map((value) =>
          Number(value)
        )
        .filter(
          (
            value,
            position,
            array
          ) =>
            Number.isInteger(
              value
            ) &&
            value >= 0 &&
            value <
              answers.length &&
            array.indexOf(value) ===
              position
        );

    if (!correct.length) {
      correct.push(0);
    }

    let type =
      String(
        raw.type || "quiz"
      ).toLowerCase();

    if (correct.length > 1) {
      type = "multiquiz";
    }

    if (
      ![
        "quiz",
        "multiquiz"
      ].includes(type)
    ) {
      type = "quiz";
    }

    return {
      type,
      question,
      answers,
      correct,

      image:
        typeof raw.image ===
        "string"
          ? raw.image
          : null
    };
  }

  async function waitForQuestionSave(
    questionText,
    timeoutMs
  ) {
    const startedAt =
      Date.now();

    while (
      Date.now() - startedAt <
      timeoutMs
    ) {
      await sleep(400);

      const context =
        getBuilderContext();

      if (
        context?.builder?.data
          ?.question?.content
      ) {
        const currentText =
          stripHtml(
            context.builder.data
              .question.content
          );

        if (
          currentText !==
          normalizeText(questionText)
        ) {
          return;
        }
      } else {
        return;
      }
    }

    await sleep(1000);
  }

  function captureQuestionSnapshot() {
    const context =
      getBuilderContext();

    const questions =
      findBestQuestionsArray(
        context
      );

    return {
      count: questions.length,

      entries:
        questions.map(
          (
            question,
            index
          ) => {
            const id =
              getQuestionId(
                question
              );

            const fingerprint =
              getQuestionFingerprint(
                question
              );

            return {
              id,
              fingerprint,

              key:
                id
                  ? `id:${id}`
                  : `fp:${fingerprint}:${index}`
            };
          }
        )
    };
  }

  function createUndoToken({
    beforeSnapshot,
    afterSnapshot,
    questions,
    insertedCount
  }) {
    const beforeIds =
      new Set(
        beforeSnapshot.entries
          .map((entry) => entry.id)
          .filter(Boolean)
      );

    const beforeFingerprints =
      new Set(
        beforeSnapshot.entries
          .map(
            (entry) =>
              entry.fingerprint
          )
          .filter(Boolean)
      );

    const addedEntries =
      afterSnapshot.entries.filter(
        (entry) => {
          if (
            entry.id &&
            !beforeIds.has(entry.id)
          ) {
            return true;
          }

          if (
            entry.fingerprint &&
            !beforeFingerprints.has(
              entry.fingerprint
            )
          ) {
            return true;
          }

          return false;
        }
      );

    return {
      version: 1,

      batchId:
        "batch_" +
        Date.now() +
        "_" +
        Math.floor(
          Math.random() *
          100000
        ),

      builderUrl:
        location.href,

      createdAt:
        new Date().toISOString(),

      count:
        Number(
          insertedCount || 0
        ),

      createdIds:
        addedEntries
          .map((entry) => entry.id)
          .filter(Boolean),

      fingerprints:
        addedEntries
          .map(
            (entry) =>
              entry.fingerprint
          )
          .filter(Boolean),

      questionTexts:
        questions
          .map(
            (question) =>
              question.question
          )
          .filter(Boolean)
    };
  }

  async function rollbackInsertion(
    undoToken
  ) {
    await returnToQuestionListSafe().catch(() => {});
    if (
      undoToken.builderUrl &&
      stripUrlHash(
        undoToken.builderUrl
      ) !==
        stripUrlHash(
          location.href
        )
    ) {
      throw new Error(
        "Відкрийте той самий тест у конструкторі, куди були вставлені питання."
      );
    }

    const wantedIds =
      new Set(
        undoToken.createdIds || []
      );

    const wantedFingerprints =
      new Set(
        undoToken.fingerprints ||
        []
      );

    const wantedTexts =
      Array.isArray(
        undoToken.questionTexts
      )
        ? undoToken.questionTexts
        : [];

    let deletedCount = 0;

    const context =
      getBuilderContext();

    const questions =
      findBestQuestionsArray(
        context
      );

    const matchingQuestions =
      questions
        .map(
          (
            question,
            index
          ) => {
            return {
              question,
              index,

              id:
                getQuestionId(
                  question
                ),

              fingerprint:
                getQuestionFingerprint(
                  question
                ),

              text:
                getQuestionText(
                  question
                )
            };
          }
        )
        .filter((item) => {
          if (
            item.id &&
            wantedIds.has(item.id)
          ) {
            return true;
          }

          if (
            item.fingerprint &&
            wantedFingerprints.has(
              item.fingerprint
            )
          ) {
            return true;
          }

          return wantedTexts.some(
            (text) =>
              sameQuestionText(
                text,
                item.text
              )
          );
        })
        .reverse();

    for (
      const item of
      matchingQuestions
    ) {
      const deleted =
        await deleteQuestionWithAngular(
          context,
          item
        );

      if (deleted) {
        deletedCount++;
      }
    }

    const expectedCount =
      Number(
        undoToken.count || 0
      );

    if (
      deletedCount <
      expectedCount
    ) {
      const remainingTexts =
        wantedTexts.filter(
          (text) =>
            !matchingQuestions.some(
              (item) =>
                sameQuestionText(
                  text,
                  item.text
                )
            )
        );

      deletedCount +=
        await deleteQuestionsThroughUi(
          remainingTexts.length
            ? remainingTexts
            : wantedTexts
        );
    }

    if (deletedCount === 0) {
      throw new Error(
        "Не знайдено вставлені питання для видалення. " +
        "Не редагуйте їх вручну перед натисканням «Скасувати»."
      );
    }

    return deletedCount;
  }

  async function deleteQuestionWithAngular(
    context,
    item
  ) {
    if (!context) {
      return false;
    }

    const targets = [
      context.builder,
      context.scope,
      context.scope?.$parent
    ].filter(Boolean);

    const methodNames = [
      "deleteQuestion",
      "removeQuestion",
      "destroyQuestion",
      "deleteTestQuestion",
      "removeTestQuestion"
    ];

    for (const target of targets) {
      for (
        const methodName of
        methodNames
      ) {
        const method =
          target?.[methodName];

        if (
          typeof method !==
          "function"
        ) {
          continue;
        }

        const argumentsToTry = [
          item.question,
          item.id
        ].filter(
          (
            value,
            index,
            array
          ) =>
            value !== "" &&
            value !== null &&
            value !== undefined &&
            array.indexOf(value) ===
              index
        );

        for (
          const argument of
          argumentsToTry
        ) {
          try {
            const result =
              method.call(
                target,
                argument
              );

            if (
              result &&
              typeof result.then ===
                "function"
            ) {
              await result;
            }

            applyScope(
              context.scope
            );

            await sleep(300);
            await confirmDeleteDialog();
            await sleep(500);

            if (
              !questionStillExists(
                item
              )
            ) {
              return true;
            }
          } catch (_) {}
        }
      }
    }

    const button =
      findDeleteButtonForQuestion(
        item.text
      );

    if (button) {
      clickElement(button);

      await sleep(300);
      await confirmDeleteDialog();
      await sleep(600);

      return true;
    }

    return false;
  }

  function questionStillExists(
    item
  ) {
    const context =
      getBuilderContext();

    const questions =
      findBestQuestionsArray(
        context
      );

    return questions.some(
      (question) => {
        const id =
          getQuestionId(
            question
          );

        if (
          item.id &&
          id === item.id
        ) {
          return true;
        }

        return (
          getQuestionFingerprint(
            question
          ) === item.fingerprint
        );
      }
    );
  }

  async function deleteQuestionsThroughUi(
    questionTexts
  ) {
    let deleted = 0;

    for (
      const questionText of
      [...questionTexts].reverse()
    ) {
      const button =
        findDeleteButtonForQuestion(
          questionText
        );

      if (!button) {
        continue;
      }

      clickElement(button);

      await sleep(300);
      await confirmDeleteDialog();
      await sleep(600);

      deleted++;
    }

    return deleted;
  }

  function findDeleteButtonForQuestion(
    questionText
  ) {
    const normalizedTarget =
      normalizeText(
        questionText
      );

    if (!normalizedTarget) {
      return null;
    }

    const textElements =
      Array.from(
        document.querySelectorAll(
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "p",
            "span",
            "div",
            "td"
          ].join(",")
        )
      ).filter((element) => {
        const text =
          normalizeText(
            element.textContent
          );

        return (
          text ===
            normalizedTarget ||
          (
            normalizedTarget.length >
              25 &&
            text.includes(
              normalizedTarget.slice(
                0,
                80
              )
            )
          )
        );
      });

    for (
      const textElement of
      textElements
    ) {
      let container =
        textElement;

      for (
        let level = 0;
        level < 8 &&
        container;
        level++
      ) {
        const selectors = [
          "[ng-click*='deleteQuestion']",
          "[data-ng-click*='deleteQuestion']",
          "[ng-click*='removeQuestion']",
          "[data-ng-click*='removeQuestion']",
          "button[title*='Видал']",
          "a[title*='Видал']",
          ".fa-trash",
          ".glyphicon-trash",
          ".icon-trash",
          ".icon-delete"
        ];

        for (
          const selector of
          selectors
        ) {
          const found =
            container.querySelector(
              selector
            );

          if (found) {
            return (
              found.closest(
                "button, a, [role='button'], [ng-click], [data-ng-click]"
              ) || found
            );
          }
        }

        container =
          container.parentElement;
      }
    }

    return null;
  }

  async function confirmDeleteDialog() {
    const candidates =
      Array.from(
        document.querySelectorAll(
          [
            ".modal button",
            ".modal a",
            "[role='dialog'] button",
            "[role='dialog'] a",
            ".swal2-confirm",
            ".bootbox-accept"
          ].join(",")
        )
      );

    const confirmButton =
      candidates.find(
        (button) => {
          const text =
            normalizeText(
              button.textContent ||
              button.value ||
              ""
            );

          return [
            "видалити",
            "так",
            "підтвердити",
            "ок",
            "delete",
            "yes",
            "confirm"
          ].includes(text);
        }
      );

    if (confirmButton) {
      clickElement(
        confirmButton
      );

      await sleep(300);
    }
  }

  function findBestQuestionsArray(
    context
  ) {
    if (!context) {
      return [];
    }

    const roots = [
      context.builder,
      context.builder?.data,
      context.builder?.test,
      context.builder?.data?.test,
      context.scope,
      context.scope?.test
    ].filter(Boolean);

    const candidates = [];

    for (const root of roots) {
      collectQuestionArrays(
        root,
        candidates,
        new WeakSet(),
        0
      );
    }

    candidates.sort(
      (first, second) =>
        second.length -
        first.length
    );

    return candidates[0] || [];
  }

  function collectQuestionArrays(
    value,
    results,
    visited,
    depth
  ) {
    if (
      !value ||
      typeof value !== "object" ||
      depth > 4 ||
      visited.has(value)
    ) {
      return;
    }

    visited.add(value);

    for (
      const [
        key,
        child
      ] of Object.entries(value)
    ) {
      if (
        Array.isArray(child)
      ) {
        const keyLooksCorrect =
          /questions|questionlist|testquestions/i.test(
            key
          );

        const valuesLookCorrect =
          child.some(
            looksLikeQuestion
          );

        if (
          keyLooksCorrect ||
          valuesLookCorrect
        ) {
          if (
            child.length ||
            keyLooksCorrect
          ) {
            results.push(child);
          }
        }

        continue;
      }

      if (
        key.startsWith("$") ||
        key === "options" ||
        key === "answers" ||
        key === "question" ||
        !child ||
        typeof child !==
          "object"
      ) {
        continue;
      }

      collectQuestionArrays(
        child,
        results,
        visited,
        depth + 1
      );
    }
  }

  function looksLikeQuestion(
    item
  ) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      return false;
    }

    return Boolean(
      item.content ||
      item.question ||
      item.text ||
      item.title ||
      item.options ||
      item.answers
    );
  }

  function getQuestionId(
    question
  ) {
    if (
      !question ||
      typeof question !== "object"
    ) {
      return "";
    }

    return String(
      question.id ||
      question._id ||
      question.question_id ||
      question.questionId ||
      question.uuid ||
      question.pk ||
      ""
    ).trim();
  }

  function getQuestionText(
    question
  ) {
    if (
      !question ||
      typeof question !== "object"
    ) {
      return "";
    }

    return stripHtml(
      question.content ||
      question.question ||
      question.text ||
      question.title ||
      question.name ||
      question.body ||
      ""
    );
  }

  function getQuestionFingerprint(
    question
  ) {
    const text =
      normalizeText(
        getQuestionText(
          question
        )
      );

    const answers =
      Array.isArray(
        question?.options
      )
        ? question.options
        : Array.isArray(
            question?.answers
          )
          ? question.answers
          : [];

    const answersText =
      answers
        .map((answer) => {
          if (
            typeof answer ===
            "string"
          ) {
            return normalizeText(
              stripHtml(answer)
            );
          }

          return normalizeText(
            stripHtml(
              answer?.value ||
              answer?.text ||
              answer?.title ||
              ""
            )
          );
        })
        .join("|");

    return (
      text.slice(0, 180) +
      "::" +
      answersText.slice(0, 240)
    );
  }

  function sameQuestionText(
    first,
    second
  ) {
    const firstText =
      normalizeText(first);

    const secondText =
      normalizeText(second);

    if (
      !firstText ||
      !secondText
    ) {
      return false;
    }

    return (
      firstText === secondText ||
      (
        firstText.length > 30 &&
        secondText.includes(
          firstText.slice(0, 120)
        )
      ) ||
      (
        secondText.length > 30 &&
        firstText.includes(
          secondText.slice(0, 120)
        )
      )
    );
  }

  function dispatchProgress(
    message,
    percent
  ) {
    document.dispatchEvent(
      new CustomEvent(
        "quizgen-progress",
        {
          detail: {
            message,
            percent
          }
        }
      )
    );
  }

  function dispatchInsertResult(
    detail
  ) {
    document.dispatchEvent(
      new CustomEvent(
        "quizgen-insert-result",
        {
          detail
        }
      )
    );
  }

  function dispatchCancelResult(
    detail
  ) {
    document.dispatchEvent(
      new CustomEvent(
        "quizgen-cancel-result",
        {
          detail
        }
      )
    );
  }

  function applyScope(scope) {
    try {
      if (
        scope &&
        !scope.$$phase
      ) {
        scope.$apply();
      }
    } catch (_) {
      try {
        scope?.$applyAsync?.();
      } catch (_) {}
    }
  }

  function clickElement(
    element
  ) {
    if (!element) {
      return;
    }

    element.scrollIntoView({
      block: "center"
    });

    element.dispatchEvent(
      new MouseEvent(
        "mousedown",
        {
          bubbles: true,
          cancelable: true
        }
      )
    );

    element.dispatchEvent(
      new MouseEvent(
        "mouseup",
        {
          bubbles: true,
          cancelable: true
        }
      )
    );

    element.click();
  }

  function escapeHtml(text) {
    const div =
      document.createElement(
        "div"
      );

    div.textContent =
      String(text || "");

    return div.innerHTML;
  }

  function stripHtml(value) {
    const div =
      document.createElement(
        "div"
      );

    div.innerHTML =
      String(value || "");

    return normalizeText(
      div.textContent ||
      div.innerText ||
      ""
    );
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function stripUrlHash(url) {
    return String(url || "")
      .split("#")[0]
      .replace(/\/+$/, "");
  }

  function sleep(milliseconds) {
    return new Promise(
      (resolve) => {
        setTimeout(
          resolve,
          milliseconds
        );
      }
    );
  }
})();