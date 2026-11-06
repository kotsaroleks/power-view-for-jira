# Незалежний exploratory-аудит нової Swift-копії

Дата: 20 жовтня 2026 року. Об’єкт: поточний `apps/macos/dist/Power View.app`, нова повна
копія UI з форматом `.pvworkspace`. Попередні аудити іншої реалізації не вважаються
результатами цієї збірки.

## Висновок і суттєве обмеження

**Оновлення після виправлення збереження:** див. заключний regression-розділ цього
документа. Точний сценарій зависання незалежно повторено успішно в новій збірці;
reset/Cmd-S/full restart тепер PASS у перевіреному обсязі. Початкові результати нижче
залишені як історія дефекту, а не актуальний статус виправленого save.

**Готовність не підтверджена.** Реально відкрито локальний workspace, Estimation board,
пошук та деталі готової сторі. Подальші UI-перевірки заблоковані зависанням/недоступністю
Power View через CUA. Це не доведений crash продукту і не доведене блокування Mac; причина
не встановлена. Кількість модульних тестів не використовувалася як доказ працездатності.

Виявлено одну підтверджену неточність статусу: workspace зі збереженим snapshot без
перевіреного підключення показує «Your Jira connection and project settings are ready».
Локальний файл доводить наявність даних, а не готовність поточної авторизації.

## Об’єкт і дані

- SHA-256 executable на диску під час перевірки:
  `af0c30c4a98dfd1c58978e5272b98b1c2ac8139cf5fa6570595cf46a19836fb2`.
- Початкове прив’язування CUA показало новий Gantt із навігацією
  Workspace/Reports/Gantt/Status/Estimation, 2 задачами й чотирма FS/SS/FF/SF links. Це
  підтверджує актуальну версію вікна, але links створював розробник — не зараховано як
  незалежне створення.
- Власні disposable копії: `/private/tmp/independent-native-copy.pvworkspace` і
  `/private/tmp/independent-native-gantt.pvworkspace`, скопійовані з явно синтетичних
  fixtures. Авторські робочі дані не відкривались.
- Першу копію відкрито звичайною командою Open через UI. Друга була підготовлена, але її
  UI-прогін не розпочався через blocker.
- `jira.example.test`, LBR-1/2, Alex/Sam та дані scope/tests є synthetic. Реальна Jira,
  Drive, облікові дані та зовнішні записи не використовувалися. Product code не
  змінювався.

## Матриця фактичного покриття

| Сценарій                          | Статус               | Доказ / межа                                                                                                                                                                         |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Відкриття нового `.pvworkspace`   | PASS, synthetic      | Через Cmd-O відкрито власну копію; UI відобразив LBR і workspace з 4 навігаційними напрямами.                                                                                        |
| Головна навігація / Estimation    | PASS для відкриття   | Натискання Estimation відкрило 5 колонок: Tech estimation, PM clarification, Scope confirmation, QA preparation, Ready to dev.                                                       |
| Підсумки Estimation               | PASS на fixture      | Дві сторі, 3,5 estimated dev days, 1 ready; LBR-1 у Tech estimation, LBR-2 у Ready. Це сума dev за новим Chrome-процесом, не перевірка формул початкового продуктового ТЗ.           |
| Пошук карток                      | PASS                 | Введення LBR-2 прибрало LBR-1 і залишило готову LBR-2. Загальні лічильники при цьому лишилися глобальними: 2 in release / Tech estimation 1 / ready1.                                |
| Відкриття готової сторі           | PASS                 | LBR-2 показала Tech Lead Alex, QA Sam, 3.5 dev days, decomposition, питання/відповідь, scope, 4 QA поля та checked confirmations. Ready button disabled з позначкою ✓.               |
| Reset approvals після редагування | BLOCKED              | Спроба setValue days3.5→4 + Cmd-S завершилась CUA noWindowsAvailable; зміна/результат не підтверджені. Файл на диску лишив days3.5, ready=true. Не PASS і не доведений дефект reset. |
| Save/reopen нових правок          | BLOCKED              | Після втрати UI не вдалося перевірити збереження mutation. Саме відкриття початкового файла перевірене.                                                                              |
| Gantt: search/zoom/hideDone       | UNVERIFIED / BLOCKED | Початкове вікно Gantt видно: search, checkbox hide completed, sort, Day/Week/Month, 2 рядки. Аудитор ці дії не виконав.                                                              |
| Typed dependency persistence      | UNVERIFIED           | Read-only JSON другого fixture містить підготовлені розробником links. Незалежний create/remove/save/reopen не виконаний. Попередні версії не зараховуються.                         |
| Reports offline UI                | BLOCKED              | До Reports не дійшли до втрати доступу. Код має offline/connection guards та локальну історію, але це не UI PASS.                                                                    |
| Setup import через UI             | BLOCKED              | Кнопку імпорту нової копії не перевірено. Код імпорту прочитано окремо; старий regression не переноситься автоматично.                                                               |
| Live Jira/Drive / parity          | UNVERIFIED           | Заборонені зовнішні записи; немає live login/parity-пілота. Synthetic fixture не є серверною перевіркою.                                                                             |

## Інструментальний blocker — точні спостереження

1. До втрати UI AX-дерево незалежного документа підтвердило форму LBR-2 з days3.5 та
   ready.
2. Після запиту змінити days на 4 і Cmd-S інструмент повернув
   `Computer Use server error -10005: noWindowsAvailable`.
3. Повторне getApp за шляхом, за bundle ID та getAXState повертали `timeoutReached` (~17
   секунд кожний).
4. Інвентаризація `cua.getState()` показувала `com.powerview.native` з `isRunning: true`.
   Жодного явного повідомлення `locked` не було.
5. Окреме прив’язування Finder врешті повернуло Desktop, але лише після тривалого
   зависання інструмента (~330 секунд). Після цього Power View ще раз дав timeout.
6. Read-only перевірка власного JSON показала старі days3.5/ready=true. Це засвідчує, що
   mutation не збережена, але не визначає, чи був запит вводу фактично застосований.

Повторні однакові спроби припинено, UI передано назад реалізатору. Він повідомив, що UI
паралельно не керував і dist під час тесту не перепаковував. Свіжого crash report аудитор
сам не досліджував. Немає достатніх доказів класифікувати цю подію як product crash або
Mac lock.

## Підтверджена неточність: статус готовності підключення

**P2 — локальний snapshot помилково описується як готове Jira-підключення.**

Кроки: відкрити synthetic `.pvworkspace` зі snapshot і setup, без проходження авторизації
→ Workspace.

Фактично: «WORKSPACE READY», «Your Jira connection and project settings are ready.»
Жодного серверного входу аудитор не виконував. У source `PowerViewApp.swift` readiness
головного екрана визначена лише `document.state.snapshot != nil`, а текст стверджує
готовність connection.

Очікувано: розрізняти наявний saved/offline workspace та перевірену поточну авторизацію.
Сам факт відкриття файла не підтверджує актуальність Jira-прав/мережі.

Це UI/code-confirmed неточність; вона не означає, що мережеві операції обходять перевірку
авторизації.

## Що встановлено лише читанням коду

- `ChromeEstimationDraft.edit` скидає scopeConfirmed/qaSubmitted/ready після зміни
  TL/days/decomposition/questions/answers/scope і QA flags після зміни QA-полів. Під час
  цього прогону runtime reset не підтверджений.
- `ProductSetup.importWorkspace` розрізняє native ProductWorkspace, ChromeSetup і
  WorkspaceCodec snapshot. UI-імпорт аудитором не виконаний.
- ProductWorkspace зберігає estimation/plans/links/preferences і архіви за identity
  origin|board. Незалежне cross-board switching цього разу не перевірене.

Наступний короткий прогін має початися з доступного вікна: незалежна зміна days →
підтверджений reset → Cmd-S/reopen; далі Gantt search/zoom/hideDone/link persistence;
Reports offline; Setup import. До цього результати залишаються BLOCKED/UNVERIFIED, без
заяв про завершення копії чи приймання продукту.

## Regression після заміни механізму save — 20 жовтня 2026

Об’єкт повторного незалежного тесту — перепакована збірка, SHA-256
`6c258e7ce7b4aed93938ed1bfb79bc41bc45eea2105cffd555688589ece5c7f3`. За повідомленням
реалізатора попереднє зависання було підтверджено sample main thread у NSDocument
serialization semaphore; аудитор сам sample не виконував. Новий UI використовує окремий
workspace store. Наведені нижче результати отримані фактично через CUA, а не виведені зі
зміни архітектури чи кількості тестів.

### Exact edit/save/restart

1. Відкрив **власну** `/private/tmp/independent-native-copy.pvworkspace`, яка ще містила
   days3.5, ready=true і всі погодження.
2. Estimation → LBR-2 → `Estimate (dev days)` 3.5→4 → Cmd-S.
3. Живий AX повернувся за ~0,7 секунди. Дошка: 4 estimated dev days, 0 ready, Scope
   confirmation1. У деталях scope/QA submission скинуті.
4. Власний JSON на диску: `days: "4"`, `scopeConfirmed: false`, `qaSubmitted: false`,
   `ready: false`.
5. Cmd-Q → повторний getApp → автоматично відкрився **той самий незалежний файл**.
   Estimation знову показала 4 days / 0 ready / Scope confirmation1.

**Результат: PASS для exact regression зависання, reset та повного restart.** Скасовано
попередній інструментальний BLOCKED для цього конкретного сценарію; це не перевірка всіх
аварійних/дискових помилок.

### Додаткові доступні сценарії

| Сценарій                         | Актуальний результат                     | Доказ                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline chooser wording          | PASS, попередню P2 неточність виправлено | Головний екран тепер каже «Your saved workspace is ready. Connect to Jira in Settings to refresh or edit Jira.»                                                                                                                                                 |
| Reports offline UI               | PASS для оболонки/чесного стану          | Відкрив Reports: Board Health із loaded scope, явний connect message для current sprint/live generation, disabled Generate report, локальна історія доступна. Генерація реального звіту/parity не виконувалася.                                                 |
| Gantt search                     | PASS                                     | Search `telemetry` прибрав LBR-1 і лишив LBR-2.                                                                                                                                                                                                                 |
| Gantt hideDone і zoom            | PASS                                     | Після очищення пошуку Hide completed=1 прибрав done LBR-1; Day змінив календарну шкалу на щоденну. Cmd-S не завис.                                                                                                                                              |
| Settings native workspace import | PASS для native формату                  | Settings → Import workspace / Chrome setup → власна `/private/tmp/independent-native-gantt.pvworkspace`; імпорт повернув offline chooser, Gantt показав 2 scheduled tasks і 4 typed links. Це native workspace import, не перевірка всіх Chrome setup mappings. |
| Dependency removal/save          | PASS у перевіреному обсязі               | Double-click по наявній групі dependency curves вилучив SS. UI лишив FS/FF/SF; Cmd-S JSON має рівно ці 3 типи. Нове drag-створення та cycle rejection у цьому повторному прогоні не виконувалися.                                                               |
| Live integration/parity          | UNVERIFIED                               | Credentials і production writes не виконувалися.                                                                                                                                                                                                                |

Увесь прогін зроблено на disposable файлах. Native import навмисно замінив їхній synthetic
стан після завершеної перевірки exact regression.

Спостереження щодо доступності: перекриті dependency curves об’єднані AX в один text із
Help, що називає FS, хоча double-click у вибраній точці видалив SS. Це не доказ
неправильного графа чи неправильного mouse hit testing; точний вибір типу через
accessibility неоднозначний. Для окремого accessibility-рев’ю варто перевірити незалежні
доступні назви й дії кожного link.

Нових критичних дефектів у цьому короткому повторному прогоні не виявлено. Повна
функціональна еквівалентність Chrome, реальний Jira/Drive-пілот і загальне приймання
залишаються непідтвердженими.
