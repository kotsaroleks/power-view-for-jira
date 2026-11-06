# Незалежний regression-аудит переробки macOS

Дата: 19 жовтня 2026 року. Перевіряв окремий агент, без виправлень продуктного коду. Це
targeted regression після попереднього exploratory-аудиту, а не повторне приймання всього
ТЗ.

## Висновок

**Перевірені локальні зміни працюють. D2/D3 для local planning виправлені у перевіреному
сценарії.** Дошка, ручні оцінки, збереження без commit, локальний TL→QA→ready, повторне
оцінювання та XLSX реально перевірені через UI. Status і timeline працюють на незалежному
синтетичному workspace snapshot.

Це не приймання повного етапу 1: live Jira/Drive, три реальних користувачі, lease і
reporting parity цим regression не підтверджені. Локальна planning-ready сторі без Jira
evidence не доводить Jira-ready за початковим A8–A10.

## Середовище й доказовість

- Збірка: `apps/macos/dist/Power View.app`; SHA-256 executable
  `f9105e798000adf722fa76ee55ef40f933ec25bc65efae13a9b0816a47cf03d5`.
- На початку CUA підключився до старого процесу зі старими dev-рядками. Власний документ
  збережено, застосунок нормально завершено Cmd-Q і запущено заново. Остаточні dev/UI
  висновки — після restart; застарілий runtime не класифіковано як дефект нової збірки.
- Не використовувався файл розробника `power-view-rework-active.pvrelease` як доказ.
  Аудитор створив чистий локальний реліз `Independent rework`, команда `Regression`,
  проєкт REG, три ключі через UI.
- Власні артефакти: `/private/tmp/independent-rework-regression.pvrelease`,
  `/private/tmp/independent-rework-estimates.xlsx`,
  `/private/tmp/independent-workspace-regression.pvrelease`,
  `/private/tmp/independent-chrome-handoff.json`.
- Workspace snapshot створений аудитором вручну, позначений
  `INDEPENDENT SYNTHETIC WORKSPACE` / `SYNTHETIC board — no Jira`. Legacy JSON також
  synthetic. Це UI fixtures, не дані завантажені з Jira.
- Реальні зовнішні дані не змінювалися; авторизацію/секрети не шукали; тести/компіляцію не
  зараховували як доказ UI. Записаний JSON та XML нового XLSX перевірено окремо від
  екрана.

## Матриця targeted regression

| Перевірка                          | Результат                       | Незалежний доказ                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| П’ять колонок дошки й картки       | PASS                            | «Оцінка ТЛ», «Уточнення», «Погодження скоупу», «Підготовка QA», «Готово» доступні як окремі колонки/списки; REG-1/2/3 — кнопки-картки, відкривають редактор.                                                                                                                                            |
| Множинний ввід ключів              | PASS                            | У чистому релізі введено `REG-1, REG-2` + newline `REG-3`; додано рівно 3 картки.                                                                                                                                                                                                                       |
| Пошук                              | PASS                            | Пошук `REG-2` лишає одну картку, лічильник колонки стає 1; інші колонки показують «Немає збігів».                                                                                                                                                                                                       |
| Автоматичні локальні TL/QA         | PASS                            | У створеному релізі одразу доступні координатор, ТЛ, QA лід; не довелось вручну додавати технічні IDs. Це локальні ролі, не Jira identity.                                                                                                                                                              |
| Ручні dev-частини                  | PASS                            | Після актуального restart: два editable рядки `Independent backend`=2 та `Independent frontend`=3. Dev=5, базове QA=1, total=6. У JSON немає `jiraKey` чи `recordedEstimateSeconds`, `requiresJiraEvidence=false`.                                                                                      |
| D2: звичайний Cmd-S без commit     | PASS, local planning            | Змінено назву на `Independent title v2`, AC на `Independent AC v2`, DoD на `Independent DoD v1`, dev2/3 і три підтвердження. Cmd-S зберіг усі ці значення в document JSON. Окремої commit-кнопки немає.                                                                                                 |
| D3: навігація й повторне відкриття | PASS, local planning            | «Команда та реліз» → REG-1 зберігає AC/DoD/назву/частини. Перед цим власний документ був збережений і відкритий після повного restart — первісні AC/DoD/назва також збережені. Редактор planning не вимагав Keychain, помилки `-25293` не виникло. Сценарій Jira-bound private recovery не перевірявся. |
| Local TL→QA→ready                  | PASS                            | ТЛ увімкнув три підтвердження й окремо передав сторі. QA заповнив ім’я, 4 матеріали, явно застосував QA=2 і погодив AC/DoD. Окрема ready-кнопка змінила стан; JSON підтвердив ready і матеріали. Total=7.                                                                                               |
| Gate експорту                      | PASS                            | Поки REG-2/3 неготові, export disabled. Координатор вилучив їх із synthetic scope; тоді export став доступним.                                                                                                                                                                                          |
| Реальний XLSX export               | PASS, synthetic release         | UI створив новий `independent-rework-estimates.xlsx`; його worksheet XML має лише key/estimate: `REG-1`, `7.0`. Є архів матеріалу в UI релізу.                                                                                                                                                          |
| Ready → повторне оцінювання        | PASS                            | Координатор натиснув «Повернути на оцінювання»: стан повернувся до TL, approvals скинулись, дані підготовки й dev залишились; export знову disabled.                                                                                                                                                    |
| Gantt і Status окремі маршрути     | PASS                            | Дві окремі sidebar-кнопки відкривають відповідно timeline і distribution, а не Reporting sheet.                                                                                                                                                                                                         |
| Status distribution/filter         | PASS, synthetic snapshot        | 4 задачі: Open2=50%, Done1=25%, In Progress1=25%. Натискання Open прибрало REG-2/3, лишило REG-1/4.                                                                                                                                                                                                     |
| Timeline й local plan edit         | PASS, synthetic snapshot        | Gantt має сітку дат, REG-1/2/4, done приховано за замовчуванням. Редактор REG-2 змінив start/due з 22/24 жовтня на 23/26 жовтня. UI показав 1 локальний план; Cmd-S записав `localPlans.REG-2`, оригінальні дати workspace лишились 22/24.                                                              |
| Read-only live workspace loader    | BLOCKED                         | Є UI board/JQL/date-field loader; без Jira «Список бордів» і «Завантажити борд» disabled. Код `loadWorkspace` робить paginated GET, але реальний endpoint/доступ/пагінацію аудит не виконував. Synthetic snapshot не зарахований як live PASS.                                                          |
| Chrome JSON handoff                | PASS, synthetic legacy fixture  | Через стартову кнопку «Відкрити реліз або handoff Chrome…» імпортовано власний version1 JSON: CHR-1/title, scope, dev4, resolved questions, TL/QA та матеріали. Дошка показала ready, dev4+QA0.8=4.8. Реальний користувацький Chrome-export не перевірений.                                             |
| Спільний Drive/lease               | BLOCKED / раніше не реалізовано | Основний екран досі явно каже, що спільне редагування недоступне. Нових доказів виправлення попереднього D1 немає. Не відкривали/змінювали справжніх Drive-файлів.                                                                                                                                      |

## Точний локальний сценарій

1. New → назва/команда/REG → offline toggle → local coordinator → Create.
2. Вставити три REG-ключі в дошку, додати; перевірити search.
3. ТЛ → REG-1 → назва/AC/DoD → дві ручні частини 2 та 3 дні → підтвердження → Cmd-S.
4. Перейти в команду й назад, перевірити поля та власний JSON на диску.
5. Передати на QA → QA роль → заповнити тест-план/дані/середовище/умови → явне QA2 →
   approval → ready → Cmd-S.
6. Координатор вилучає лише зайві synthetic REG-2/3 → export XLSX → перевірити XML:
   REG-1=7.
7. Повернути REG-1 на оцінювання → перевірити reset/gate.

На відміну від першого аудиту, тут готовність отримано вручну в продукті без підстановки
фальшивих Jira підзадач/секунд у документ.

## Залишкові gaps та застереження

- **Повна acceptance-готовність усе ще не доведена.** Local planning прямо допускає
  підготовку без реальних Jira-задач. Його ready/export не закривають початкові вимоги
  фактичного створення dev/QA та запису Original Estimate.
- Старі D2/D3 закриті лише для перевіреного local planning потоку. Чи захищено роботу
  Jira-bound редактора при Keychain failure, crash чи lease expiration — цей regression не
  довів.
- Справжні Drive open/save/lock, два Mac, 30 хвилин, stale writer та selective merge
  залишаються невипробуваними/незавершеними як раніше.
- Gantt перевірено як ручну timeline з локальними датами/залежностями; це не доказ
  автоматичного ресурсного планувальника з календарями, алокаціями й погодженням.
- Board/status snapshot вручну seeded; live loader та еквівалентність старому
  Chrome/Reporting на реальних даних лишаються BLOCKED.
- Targeted сценарії нових критичних дефектів не виявили. Це обмежений результат, не
  твердження про відсутність інших помилок чи приймання етапу 1.

## Доповнення: 19 жовтня 2026, 23:26–23:29 — typed links, preferences, snapshot

Перевірявся **поточний запущений bundle без перезапуску**: розробник паралельно готував
наступну збірку. Отже, ці результати не стосуються ще не запущеного календаря прогнозу,
нової локалізації чи наступного Chrome setup import. Product source не змінювався
аудитором.

Для ізоляції створено власну копію вже відомого synthetic workspace з новим UUID та назвою
`Independent typed dependency regression`:
`/private/tmp/independent-typed-gantt.pvrelease`. Вхідний
`/private/tmp/independent-snapshot-input.json` — лише native workspace-частина цієї копії,
без release/history/export. Файл розробника не редагувався. Жодних Jira/Drive операцій не
виконувалося.

| Перевірка                          | Результат                         | Відтворення й доказ                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Додавання FS/SS/FF/SF              | PASS, локально                    | Gantt → «Локальні залежності» → REG-1 як попередник, REG-4 як наступник; послідовно обрано й додано всі 4 типи. UI count=4; Cmd-S записав чотири `timelineLinks` з окремими IDs та kind FS/SS/FF/SF.                                                                                                 |
| Виявлення суперечності дат         | PASS для контрольного прикладу    | REG-1 має 19–21 жовтня, REG-4 20–25. Показано рівно 1 conflict: FS. Для SS/FF/SF на цих датах conflicts немає, що узгоджується з їхніми умовами. Це перевірка діагностики, не автоматичного пересування ручних дат.                                                                                  |
| Захист від точного дубліката       | PASS                              | Повторно натиснуто «Додати» для того самого SF. Показано «Така залежність уже є»; fifth link не створений.                                                                                                                                                                                           |
| Preferences у файлі                | PASS у перевіреному обсязі        | Обрано масштаб «Місяці», здійснено перемикання hideDone/showDependencies; після Cmd-S JSON має `timelinePreferences` з dayWidth=4, hideDone=true, showDependencies=true, sort=rank, ascending=true. Усі можливі sort/collapse/calendar комбінації не перебиралися.                                   |
| Preferences і links після закриття | PASS                              | Cmd-S → Cmd-W → звичайний Open власної копії → Gantt. Знову «Місяці», count=4 links, count=1 conflict. Повний restart застосунку в цій сесії навмисно не робився.                                                                                                                                    |
| Snapshot JSON через UI             | PASS для native synthetic формату | «Імпортувати workspace JSON…» → власний `independent-snapshot-input.json` → Open. Повернення в Gantt без import error, з 4 задачами; збереження й наступне відкриття успішні. Snapshot ідентичний поточному board, тому це не перевірка перемикання board/origin чи mapping старого Chrome snapshot. |
| Live Jira links/loader             | BLOCKED                           | Зовнішні дані не авторизували й не змінювали; локальні link fixtures не доводять live parity.                                                                                                                                                                                                        |

Нових found failures у цьому вузькому прогоні немає. Не перевірені drag/resize,
cyclic-graph rejection через UI, всі візуальні anchors SS/FF/SF, cross-board isolation,
новий календар та повний forecast parity. Попередні загальні acceptance gaps лишаються
чинними.
