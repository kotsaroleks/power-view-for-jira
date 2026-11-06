# Timesheet — ТЗ для Power View for Jira / Chrome

| Поле        | Значення                                                        |
| ----------- | --------------------------------------------------------------- |
| Редакція    | 0.2, підготовлена 2026-10-29, внесена до репозиторію 2026-11-01 |
| Доручення   | Реалізація редакції 0.2 погоджена повідомленням «ок роби»       |
| Платформа   | Chrome extension / Jira Cloud REST v3                           |
| Призначення | Перегляд і ведення власного залогованого часу                   |

## 1. Призначення та scope

Timesheet — окрема логічна сторінка для власного часу, незалежна від Gantt та поточної
борди. Основний об'єкт — worklog; автор визначається за accountId, а не assignee,
reporter, displayName чи updateAuthor.

Перша версія: тиждень/місяць, перехід до дати, timezone, явні фільтри проєктів, таблиця
задач × дні, підсумки, деталі, пошук задач, пряме читання відомої задачі,
створення/редагування/видалення власних записів. Не входять командний режим, норми,
свята/відпустки, approvals, billing, timers, export, offline mutations, постійний індекс
історії, Data Center та інші платформи.

Це самостійне функціональне рішення. Tempo — функціональний орієнтир; копіювання коду,
графіки, текстів, внутрішньої реалізації та точного UI не входить у роботу.

## 2. Незалежний контекст

- SCOPE-01: потрібні лише перевірений Jira instance і поточний користувач. Board setup,
  завантажений Gantt, field mappings і completed statuses не є передумовою.
- SCOPE-02: за замовчуванням доступні всі проєкти instance в межах пошуку й прав. Поточні
  Project/Board/saved JQL не застосовуються непомітно.
- SCOPE-03: один/декілька проєктів — явний фільтр. «Використати поточний контекст» копіює
  saved JQL із Setup; фільтр видно й можна зняти. Подальша зміна Setup його не переписує.
  Семантика saved JQL не видається за гарантоване board membership.
- SCOPE-04: instance/account change скасовує читання й очищає попередні дані. Старі
  відповіді не можуть замінити поточну вибірку.
- SCOPE-05: Timesheet не отримує список задач через WorkspaceContext.issues. Reports і
  Gantt зберігають свою board-centric модель.

## 3. Інтерфейс

- UI-01: компактна панель — користувач, період, попередній/наступний, Today, date picker,
  timezone, фільтри, Refresh, Log time. Instance та деталі вибірки — компактно.
- UI-02: при 1440×900, zoom 100% видно заголовок таблиці та не менше п'яти рядків, якщо
  вони є; усі блоки над таблицею разом із шапкою застосунку займають до 300 CSS px.
  Перевірити також 1280×800 і zoom 200%; дії не перекриваються.
- UI-03: колонки key/summary, календарні дні, підсумок задачі. Унизу — суми днів і
  періоду. Заголовок і колонка задач закріплені. Місяць може прокручуватись горизонтально.
- UI-04: заповнена клітинка відкриває окремі записи. Порожня клітинка відкриває Log time
  із задачею/датою. Агрегована сума не редагується як один worklog.
- UI-05: пряме додавання/перевірка задачі за key працює незалежно від worklog discovery.
  Явні фільтри зберігаються: якщо задача їм не відповідає, пояснити причину й
  запропонувати очистити фільтри або логувати через форму без зміни перегляду.
- UI-06: пошук key/summary звужує лише видимі рядки; їх підсумок відрізняється від
  підсумку повної завантаженої вибірки. Порожній ручний рядок не збільшує кількість задач
  із записами.
- UI-07: клавіатура, видимий focus, доступні назви, Escape, focus management форм, захист
  незбереженого введення. Колір не є єдиним носієм стану.

## 4. Читання Jira API

API-01: `GET /rest/api/3/myself` визначає accountId і, якщо доступна, timezone профілю.
Відсутній ID — помилка ідентифікації, не порожній табель.

API-02: discovery — `POST /rest/api/3/search/jql`; тільки потрібні поля та пагінація через
nextPageToken. Наприклад:

```json
{
  "jql": "worklogAuthor = currentUser() AND worklogDate >= \"2026-10-26\" AND worklogDate < \"2026-11-02\"",
  "fields": ["summary", "project"],
  "maxResults": 100
}
```

Це пошук задач-кандидатів, не готовий перелік worklog. У запит додаються лише явні
фільтри. Не використовувати legacy search та перебір задач борди.

API-03: календарний discovery має консервативно охоплювати період, а точні дати
відбираються локально. Для реалізації використано розширення дати на два дні з кожного
краю; якщо timezone профілю Jira відсутня/невідома — discovery за автором без дат.
Відсутність timezone ОС не використовується як припущення про timezone Jira. Семантика
пошукового індексу й крайні дати потребують перевірки на контрольованому Jira.

API-04: для кандидатів читати `GET /rest/api/3/issue/{key}/worklog` з пагінацією
startAt/maxResults. Вбудований search.fields.worklog не вважається повною колекцією.
startedAfter/Before — лише оптимізація після перевірки точних меж; наразі не застосовані.

API-05: кожен запис перевіряється за accountId автора та належністю started вибраному
періоду. JQL не доводить, що author/date відповідають одному запису. Злиття задач — за
issue ID; worklog — за instance + worklog ID. Parent/subtask не підсумовуються повторно.

API-06: обмежена паралельність (до 4 задач), прогрес, скасування, захист від старих
відповідей. Повторний cursor, порожня незавершена сторінка, невалідний запис, збій читання
або ліміт не трактуються як завершена вибірка.

API-07: GET і read-only POST search мають контрольовані повтори тимчасових HTTP-помилок
(до 2), із Retry-After та можливістю скасування. Mutations не повторюються.

## 5. Повнота і стани

DATA-01: Jira документує пошук лише найновіших worklog для задач із понад 1000 записів.
Читання всіх сторінок знайдених задач не усуває пропущені задачі. Успішний швидкий режим
завжди має `coverage: jql-limited`; не обіцяє «весь ваш час».

DATA-02: біля підсумку «Знайдений час» постійно є пояснення обмеження пошуку й можливість
перевірити відому задачу за key. Ручне додавання не доводить повноту решти вибірки.

DATA-03: транспортний стан, охоплення й актуальність — різні характеристики:

| Ситуація                      | Відображення                                               |
| ----------------------------- | ---------------------------------------------------------- |
| Початкове завантаження        | Прогрес; підсумок невідомий, не 0                          |
| Успішний пошук                | Знайдений час, пояснення JQL-обмеження                     |
| Нічого не знайдено            | Період/фільтри, пояснення обмежень, зміна умов та Log time |
| Часткове читання              | Лише завантажені записи, причини/кількість помилок         |
| Помилка без даних             | Невідомий результат, не успішний нуль                      |
| Refresh із попередніми даними | Позначений попередній snapshot того самого запиту          |
| Помилка Refresh               | Застарілі дані з поясненням                                |
| Cancel                        | Немає статусу завершеної вибірки                           |

DATA-04: деталі показують instance, автора, період, zone, явні фільтри, discovery JQL,
кількість знайдених/прочитаних задач, отриманих/відібраних worklog, помилки та час
читання. Недоступні записи не маскуються нулями. Усі результати обмежені поточними правами
та visibility; застосунок не обіцяє виявити приховані записи.

## 6. Час і обчислення

- TIME-01: явна IANA timezone, початково з поточного Jira-профілю (уточнення користувача
  2026-11-03). Явний ручний вибір зберігається; старий неявний Europe/Kyiv мігрує на
  Jira-профіль. Timezone ОС не визначає день.
- TIME-02: канонічний період
  `[локальна північ першого дня, локальна північ після останнього дня)`, з урахуванням
  DST. Відбір за локальним днем started еквівалентний цим межам для обраних календарних
  днів.
- TIME-03: усю тривалість відносити до дня started; через північ автоматично не ділити.
  created/updated і межа 08:00 із Reporting не визначають день обліку.
- TIME-04: цілі секунди; суми клітинок/задач/днів/періоду збігаються для однієї вибірки.
  timeSpent задачі за весь час не замінює суму за період.
- TIME-05: історичні секунди не губляться при редагуванні іншого поля. Незмінені дата/час
  зберігають початковий started включно із секундами.
- TIME-06: неіснуючий DST-час відхиляється; для повтореного часу обирається конкретний
  offset/UTC instant. Вихідні не блокують логування.

## 7. Створення, редагування, видалення

WRITE-01: форма — задача, дата, локальний час початку, тривалість, необов'язковий опис.
Пошук за key/summary працює за дією користувача, із debounce/скасуванням, незалежно від
борди, assignee та попередніх worklog. Не завантажувати всі задачі для autocomplete.

WRITE-02: формати `1h 30m`, `90m`, `1:30` означають 5400 s. Голі числа, неоднозначні
десяткові значення, нуль, від'ємні, d/w — відхиляються. Норма 8h не припускається.

WRITE-03: маршрути:

| Дія            | Маршрут                                       |
| -------------- | --------------------------------------------- |
| Створення      | `POST /rest/api/3/issue/{key}/worklog`        |
| Читання одного | `GET /rest/api/3/issue/{key}/worklog/{id}`    |
| Редагування    | `PUT /rest/api/3/issue/{key}/worklog/{id}`    |
| Видалення      | `DELETE /rest/api/3/issue/{key}/worklog/{id}` |

Mutations мають adjustEstimate=leave; поля started, timeSpentSeconds та optional ADF
comment. Author/visibility/estimate не приймаються. Незмінений опис не пересилається;
після явного редагування опис стає plain text в ADF. Обмеження форми/allowlist контролюють
розмір. Остаточні права визначає Jira.

WRITE-04: лише власні записи, перевірка поточного account перед mutation. Перед
редагуванням/видаленням перечитати конкретний ID і порівняти updated/author/started/
seconds/comment. Конфлікт потребує оновлення, а не мовчазного перезапису. Це best-effort,
без обіцянки атомарності.

WRITE-05: Save — явне підтвердження створення/редагування; видалення має окреме
підтвердження конкретного запису. Подвійний Save блокується. Помилки зберігають форму.

WRITE-06: timeout/мережевий збій/непідтверджений серверний результат після відправлення —
«Результат невідомий». Немає автоматичного повтору, включно з переходом на інший bridge.
Перечитати задачу; повторна спроба доступна лише після явного підтвердження користувача,
що він перевірив Jira. Відсутність запису в першому читанні не доводить невиконання.

WRITE-07: після підтвердженого успіху перечитати worklog задачі, оновити таблицю й
запам'ятати задачу в поточній сесії, щоб затримка JQL-індексації не сховала запис. Успіх
mutation із помилкою refresh — «Збережено, табель не вдалося оновити», без POST-повтору.

WRITE-08: запис поза фільтром/періодом дозволено з поясненням. «Показати запис» явно
змінює перегляд. Немає offline writes або фонової черги mutations.

## 8. Технічні рамки

Використовувати наявний browser-session transport і окремий CloudTimesheetClient; не
додавати приватні worklog тексти до reporting snapshots/diagnostics. Нові route/
method/query/body додаються окремо до exact allowlist; читання не дає права запису. POST
search — окремо визначена read operation, не довільний POST.

Preferences: normalized instance + accountId; zone, period mode, project filters, явно
скопійований JQL. Опорна дата нового відкриття — сьогодні. Worklog/описи/форми/ ручні
рядки зберігаються лише в пам'яті вкладки. Query identity включає instance, account, дні,
zone та фільтри; попередні відповіді не оновлюють інший запит. Credentials не читаються й
не зберігаються; нові broad permissions/backend/remote code не додаються. 404 worklog не
означає автоматично вимкнений time tracking.

## 9. Окремий етап: індекс повної доступної історії

Не входить у першу версію. До обіцянки повного охоплення потрібні:

1. Явний scope — проєкти або весь доступний instance.
2. Початковий перелік задач без worklogAuthor/worklogDate/assignee/поточної борди;
   прочитати їхню доступну історію з пагінацією. Це дорога явна ініціалізація, не алгоритм
   кожного відкриття.
3. Синхронізація через `GET worklog/updated?since=...`, `POST worklog/list` (до 1000 ID),
   `GET worklog/deleted?since=...`. since — момент зміни, а не дата роботи; врахувати
   пагінацію й затримку останньої хвилини.
4. Baseline watermark, overlap, upsert/deduplication, окремі checkpoints updated/deleted,
   просування лише після успішного застосування сторінок, відновлення після переривання.
5. Повторна звірка scope/прав/переміщення задач; worklog feed не доводить незмінність
   видимості й не є атомарним snapshot сервера.
6. Окреме погодження сховища, retention, очищення персональних даних, квот і поведінки
   MV3.

## 10. Критерії приймання

| ID    | Перевірка                                               | Очікування                                                      |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------- |
| AC-01 | Немає Board setup                                       | Timesheet працює після підключення                              |
| AC-02 | Час у двох проєктах, задача поза бордою                 | Немає автоматичного board scope                                 |
| AC-03 | Інший assignee, власний запис / чужий запис             | Відбір за автором worklog                                       |
| AC-04 | Декілька записів клітинки                               | Правильна сума й окремі дії                                     |
| AC-05 | DST, межі, північ, parent/subtask, дублікати            | Правильні дні й секунди без повторного rollup                   |
| AC-06 | Декілька сторінок, повторний cursor, malformed record   | Всі прочитані або пояснена неповнота                            |
| AC-07 | Історія поза JQL-вікном 1000                            | Постійне застереження і пряма перевірка key                     |
| AC-08 | Порожньо / помилка / partial / Cancel                   | Стани розрізнені, невідомість не стає успішним нулем            |
| AC-09 | Зміна account/instance/періоду                          | Старі дані не підміняють новий результат                        |
| AC-10 | Створення в задачі без попереднього worklog поза бордою | Успіх Jira та пряме перечитування                               |
| AC-11 | Редагування дати/тривалості/опису                       | Правильний ID, клітинки й підсумки, збережені незмінені секунди |
| AC-12 | Видалення                                               | Точне підтвердження та перечитування                            |
| AC-13 | Подвійний Save / timeout / 5xx                          | Немає автоматичного дублювання                                  |
| AC-14 | Конфлікт / відмова / успіх із помилкою Refresh          | Форма збережена, статус не вводить в оману                      |
| AC-15 | Зміни часу                                              | Remaining estimate незмінний                                    |
| AC-16 | Cross-instance, unknown route/body/author               | Блокування до Jira                                              |
| AC-17 | Viewport, keyboard, zoom                                | UI-02/UI-07 перевірено в браузері                               |

Готовність підтверджується typecheck/lint/build, domain/adapter/policy/component tests,
Chrome E2E на production build і звіркою з контрольованим Jira. Потрібні реальні скріншоти
week/month/details/form/empty/partial. Fixtures позначаються як тестові. Немає браузерної
перевірки або живої звірки — зазначити прямо; unit-тести їх не замінюють. Без доручення не
створювати тестові worklog у робочому Jira користувача.

## Джерела

Контракти перевірялися за публічною документацією; це не свідчення перевірки на
користувацькому Jira instance.

- [Issue worklogs REST v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/)
- [Enhanced issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)
- [JQL fields](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/)
- [JQL worklog limits](https://support.atlassian.com/jira-service-management-cloud/docs/jql-fields/)
- [Workspace context](workspace-context-architecture.md)
- [Authentication](authentication.md), [Permissions](permissions.md)

## Стан перевірки реалізації — 2026-11-01

Незалежний CloudTimesheetClient, персональний discovery, явні фільтри, компактна таблиця,
пряме читання задач і власний CRUD реалізовані локально.

- Повний Vitest прогін: 71 файл, 456 тестів — успішно. Після останніх двох UI-правок
  повторено 16 цільових тестів App/Timesheet і web typecheck — успішно.
- Typecheck web/extension/jira-client/root, lint змінених TS-файлів, форматування,
  production build та валідація розширення — успішно.
- Додано `e2e/timesheet-production.spec.ts`: production UI із контрольованим runtime та
  exact request policy, задача іншого проєкту, відсутність board enumeration, CRUD,
  estimate=leave, перевірка розміщення таблиці й збереження PNG.
- Chrome E2E і візуальне приймання не виконано. Окремий browser smoke launch завершився
  `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)` до UI.
  Скріншотів нової реалізації немає.
- Реальні mutations і звірка з контрольованим Jira instance не виконувалися. Робочий Jira
  користувача для демонстраційних записів не використовувався.
- JQL-обмеження історії показується в UI; постійний індекс із §9 не реалізовано. Результат
  не є доказом повного історичного обліку.

### Worklog issue picker — selected board and favorites

- Creating a worklog starts with an explicit board choice, remembered per Jira instance
  and account. The picker uses the board's saved filter so Scrum Epics are included. This
  preference does not scope the Timesheet's worklog loading.
- The issue dropdown starts with **Assigned to me**: Epic, Story, Task and Subtask whose
  Assignee account ID equals the current account, within the selected board filter.
  Remaining issues appear under **Other issues**, without duplicates. Assignment priority
  does not imply a status filter.
- Epic/Story can be favorited per board. Selecting a Story shows its subtasks; selecting
  an Epic shows a single dropdown of subtasks grouped by their immediate parent, while
  assigned board issues remain first. Clearing the parent selection returns to all board
  issues.
- Board and issue pages are fully loaded before choices are offered. Missing access,
  failed or inconsistent pagination show an error and Retry. Changing boards cancels
  previous loading; late responses are ignored. Unavailable favorites can be removed.
- Selecting or changing an issue retains the worklog date, time, duration and description.
  The picker reads only issue metadata, never individual worklogs.
- Production updates must rebuild the UI, service worker and content script together, then
  reload the extension. A stale worker may reject the picker's exact five-field search
  body. Request-policy rejection must not be misreported as proof of an unsafe Jira URL.

### Weekly grid entry and pinned tasks

- The selected board supplies the current user's assigned Epic, Story, Task and Subtask
  rows even when no time is logged. Pinned rows appear first, followed by assigned rows
  and historical rows. Pins persist per instance, account and board; unpinning never
  deletes worklogs.
- Other issues can be added to the table through a collapsed selector with Epic/Story
  filtering. The main Timesheet history remains independent of the selected board.
- Weekly cells with zero or one worklog accept hours directly (`2`, `1.5`, `1,5`, `1:30`)
  and save on blur/Enter. Tab keeps normal table navigation. A new worklog starts at
  **09:00 on the column's date in the selected time zone**, as approved.
- Editing one existing worklog preserves its exact start timestamp and comment. Cells with
  multiple worklogs open details for individual edits; no aggregate rewriting. Empty input
  cancels the edit; zero does not silently delete a record.
- Before writing, identity and the current cell's worklogs are checked. A concurrent
  change prevents the write. Unknown outcomes are never retried automatically; the entered
  value remains and an explicit Refresh records action is offered. Confirmed writes
  followed by read failures are not submitted again.
- Pending cell changes register a navigation/unload guard. Details and the full logging
  form remain available for descriptions, exact times, individual worklog deletion and
  exceptional cases.
- Copy last week's tasks imports task rows only, with no hours. Parent rows can expand
  their child tasks. Today's column header is highlighted; Alt+Down opens details for a
  single-record cell while Tab skips its detail button.
