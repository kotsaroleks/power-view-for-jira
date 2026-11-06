# Незалежний аудит розривів повної Swift-копії Chrome

Дата: 20 жовтня 2026 року. Окремий агент, read-only аналіз продуктового коду. Звіт
створено під час активної розробки; наведені рядки стосуються прочитаного стану, подальші
виправлення потребують повторної перевірки.

## Вердикт

**Новий root суттєво ближчий до Chrome, але повна копія дизайну, структури, логіки й дій
ще не доведена і має конкретні розриви.** Тепер є Workspace/topbar/cards та підключені
Gantt, Status і п’ятиколонкова Estimation. Старий висновок «дошки взагалі немає» не описує
цей новий source: дошка тепер реалізована в UI-коді. Проте це не PASS UI-приймання: у
цьому аудиті застосунок не запускався за домовленістю з основним виконавцем.

Найважливіші проблеми — змішування стану різних бордів/інстанцій, невідповідність файла
імпорту реальному Chrome export, відсутність післязаписного refresh, неповний Gantt
interaction parity та спрощений Reporting. Жодного відсотка готовності чи зарахування
старих тестів як доказу всього переносу немає.

## Метод

Порівняно active `PowerViewApp.swift`, `Product*.swift`, `ReportsView.swift`,
`ReportResultView.swift`, Jira UI та відповідні `PowerViewCore` моделі з реально
підключеними Chrome `App.tsx`, `GanttV2.tsx`, `EstimationBoard.tsx`/`workflow.ts`,
Reporting/ReportsService, Status та portable settings schema. UI не чіпався, мережеві
запити та записи Jira/Drive не виконувалися. Висновки нижче — source-confirmed відмінності
або ризики з чітким відтворюваним сценарієм, а не вигадані результати runtime.

## Пріоритет P1 — коректність даних і цільової Jira

### C1. Стан estimation/локального Gantt не ізольовано між бордами

Доказ: [ProductSetup.load:196](../apps/macos/Sources/PowerView/ProductSetup.swift#L196)
замінює `state.snapshot` і `state.setup`, але не розділяє `state.estimation`,
`state.plans`, `state.links`, `state.preferences` за origin+board. У
[ProductWorkspace:23](../apps/macos/Sources/PowerView/PowerViewApp.swift#L23) це по одному
екземпляру на весь документ. Натомість Chrome estimation storage key містить origin+board
([EstimationBoard:18](../apps/web/src/app/estimation/EstimationBoard.tsx#L18)); Gantt
скидає й підвантажує стан при зміні scope
([GanttV2Service:40](../apps/web/src/app/gantt-v2/GanttV2Service.tsx#L40)).

Сценарій для перевірки: створити board A, додати estimation і local dates/link, перейти
Settings, вибрати board B і Save and continue. Ті самі preparation records/links
залишаться у state. Export handoff бере НОВИЙ snapshot boardID та стару estimation
([ProductEstimation:241](../apps/macos/Sources/PowerView/ProductEstimation.swift#L241)),
тобто може неправильно атрибутувати scope.

Робота: зберігати/відновлювати за origin+board або явно створювати новий scope з
підтвердженим переносом; не просто мовчки очищати дані, що теж втратить роботу. Перевірити
A→B→A з однаковими й різними ключами.

### C2. Jira-операції не звіряють origin завантаженого workspace

Доказ: [ProductRoot.ready](../apps/macos/Sources/PowerView/PowerViewApp.swift#L65) означає
лише наявний snapshot;
[Gantt editor:97](../apps/macos/Sources/PowerView/ProductGantt.swift#L97) дозволяє write,
якщо `jira.client != nil`. `reviewSchedule`, `prepareDates` і metadata використовують
поточний client, але не порівнюють його origin зі snapshot/setup.
[JiraMetadataView:82](../apps/macos/Sources/PowerView/JiraMetadataView.swift#L82) читає
issue за ключем із поточного client.

Сценарій: відкрити збережений workspace інстанції A, підключити B, відкрити edit для
ключа, який існує в обох. Preview буде для B, хоча картка завантажена з A. Людський
preview зменшує ризик, але не робить UI-сценарій коректним.

Робота: заборонити мережеві дії при невідповідності origin; явно показувати
disconnected/stale snapshot. Scope перевіряти до read і proposal, а не лише перед POST. Не
вимагати browser session як у extension, але зберегти зв’язок workspace з його інстанцією.

### C3. Reports можуть показувати назву одного борду, генеруючи інший

Доказ:
[ReportsView.loadWorkspace:274](../apps/macos/Sources/PowerView/ReportsView.swift#L274)
приймає `importedSetup`, а далі безумовно перевизначає boardID/JQL/completed IDs старим
`ReportWorkspaceStore`. У видимому control використовується `importedSetup.board.name`, не
фактичний boardID
([ReportsView:83](../apps/macos/Sources/PowerView/ReportsView.swift#L83)); generate бере
внутрішній boardID
([ReportsView:230](../apps/macos/Sources/PowerView/ReportsView.swift#L230)). Chrome
ReportsService отримує один конкретний workspace і не вибирає інший
([ReportsService:17](../apps/web/src/app/reports/ReportsService.tsx#L17)).

Робота: workspace settings мають бути єдиним джерелом поточної генерації; historical store
не може непомітно перемикати борд. Перевірити два борди одного проєкту з попередньою
історією/store.

### C4. Зміна проєкту/борду має async race і скидає імпортовані налаштування

Доказ:
[ProductSetup.onChange:155](../apps/macos/Sources/PowerView/ProductSetup.swift#L155)
одразу перезаписує JQL default-рядком; tasks boards/statuses не перевіряють, що відповідь
належить досі поточному selection. `.onAppear`/import встановлюють project,board,JQL, а
відповідний observer згодом може перекрити імпортований JQL і completed mapping. Completed
IDs у `.onAppear` з setup взагалі не відновлюються; board observer автоматично ставить всі
statusCategory=done замість збереженої явної mapping.

Робота: окремо restore/import і user change; кожна відповідь перевіряє
origin/project/board/generation; зберігати mapping, очищати stale choices одразу й
блокувати Save під час завантаження. Прийняти швидке A→B перемикання із затриманою
A-відповіддю.

### C5. Після Jira-write snapshot не оновлюється, reload-кнопка Jira не читає

Доказ:
[ProductGantt write callback:118](../apps/macos/Sources/PowerView/ProductGantt.swift#L118)
ігнорує results і лише пише «operation finished; reload».
[Update app:151](../apps/macos/Sources/PowerView/PowerViewApp.swift#L151) змінює view
identity через `reloadID`; `loadWorkspace` при цьому не викликається. Chrome після
accepted mutations викликає `editing.refresh()` у date/metadata flows
([GanttV2:878](../apps/web/src/app/gantt-v2/GanttV2.tsx#L878),
[GanttV2:979](../apps/web/src/app/gantt-v2/GanttV2.tsx#L979)).

Робота: обробляти succeeded/failed/uncertain по операціях, перечитувати активний JQL і
відновлювати коректний UI; забезпечити явний refresh даних. Не показувати завершення як
успіх і не вимагати від користувача знайти Settings→Save and continue після кожного edit.

## Пріоритет P1 — несумісність переносу налаштувань

### C6. «Import workspace / Chrome setup» не приймає файл реальної кнопки Chrome Export settings

Chrome
[BoardConfigurationTransfer:59](../apps/web/src/app/workspace/BoardConfigurationTransfer.tsx#L59)
викликає store export, який видає `PortableBoardConfiguration` з `kind`, `version`,
`board`, `configuration`
([settings-store:583](../packages/storage/src/settings-store.ts#L583)). Native
[ChromeSetup.decode:14](../apps/macos/Sources/PowerViewCore/ChromeSetup.swift#L14) очікує
root `jiraBaseUrl`, `project.key`, `board.id`, `jql`. Поточний імпорт пробує
ProductWorkspace, цей ChromeSetup і WorkspaceCodec
([ProductSetup:219](../apps/macos/Sources/PowerView/ProductSetup.swift#L219)); portable
envelope не декодується жодним із цих очікуваних форматів.

До того ж ChromeSetup має `unsupportedFields` для hierarchy/storyPoints/sprint mapping, а
UI їх не показує. Після Save setup заново конструюється лише з start/end і completed
statuses, відкидаючи інші mapping. Немає зворотного Export settings, preview заміни та
переносу Gantt board state/filter/view preferences як у Chrome.

Робота: fixture, створений саме поточною Chrome UI-кнопкою, імпортувати в native; показати
preview і підтримати payload/schema, dependencies/reconciled dates/preferences/status
mapping. Не називати raw внутрішній setup-файл реальним portable export.

## Пріоритет P2 — Gantt не є повною копією взаємодій

Підключені task/status/assignee table, timeline, zoom, sort/search, collapse, dates, local
typed links, preview writes — це реальне просування від попереднього UI, але залишилися
відмінності:

| Chrome baseline                                                                       | Native source                                                                                                                                           | Конкретна робота                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Resizable split з початковими 520px; keyboard grid navigation                         | [ProductGantt:59](../apps/macos/Sources/PowerView/ProductGantt.swift#L59) фіксує taskTable 550px; Button-рядки без еквівалента `useGanttGridNavigation` | Перенести resize та navigation/focus/selection, перевірити клавіатуру.                                                        |
| External date conflict alert, repair cascade / keep Jira dates, підсвічування         | [GanttV2:1147](../apps/web/src/app/gantt-v2/GanttV2.tsx#L1147) має сценарій; новий ProductGantt не має reconciliation UI                                | Перенести порівняння з останнім accepted state й обидві дії. Наявний TimelineCascade не є всім conflict workflow.             |
| Залежності зі стрілками, type/title, double-click/Delete                              | [ProductGantt:373](../apps/macos/Sources/PowerView/ProductGantt.swift#L373) Canvas без arrowheads/labels; `.allowsHitTesting(false)`                    | Додати selectable/removable link та keyboard доступ. Зараз створений local link можна прибрати лише поза UI.                  |
| Drag preview показує дозволеність, hover detail/tooltips, inferred/quality indicators | Новий bar показує key+progress, `model.warnings/state/source` не показані                                                                               | Перенести видимі стани/причини/tooltip і invalid preview до завершення drag. Не трактувати inferred bar як підтверджені дати. |
| Inline status/assignee popovers із feedback; grid accessibility                       | [JiraMetadataView](../apps/macos/Sources/PowerView/JiraMetadataView.swift) — інший sheet, українські labels у English-product UI                        | Якщо замовлено повну UX-копію, відтворити структуру і feedback, не лише той самий REST виклик.                                |
| Workspace актуалізується після edit                                                   | Див. C5                                                                                                                                                 | Наскрізний preview→write→readback→updated row, включно з partial failure.                                                     |

Додатковий масштабний ризик: workspace loader дозволяє до 100 000 задач
([Workspace:127](../apps/macos/Sources/PowerViewCore/Workspace.swift#L127)), а Gantt
створює всі рядки та `count` Rectangle на кожен день для кожної задачі без
lazy/virtualization. Це не доказ runtime зависання, але явна відсутність bounded-render
поведінки; потрібна перевірка на контрольному великому наборі, а не збільшення ліміту
завантаження.

## Пріоритет P2 — Reporting досі спрощено

1. Chrome [ReportsService](../apps/web/src/app/reports/ReportsService.tsx) показує Board
   Health із поточних workspace issues перед builder. Native перетворив Board Health на
   четвертий report type із новою генерацією. Це інша структура й інша дія.
2. Scope participants у Chrome беруться з workspace issues до першого запуску. Native
   `members: []` у root, а `peopleChoices` з’являються лише з поточного report result;
   отже індивідуальний звіт не обрати до попередньої Team-генерації. `WorkspaceIssue`
   навіть не зберігає assignee accountId, лише displayName.
3. Історія має Open, але видима Delete-дія видалена, хоча state `pendingDeletion`
   залишився. Chrome має явне Delete+confirm
   ([ReportsView:1060](../apps/web/src/app/reporting/ReportsView.tsx#L1060)).
4. Немає period preview та видимого точного completed-status mapping, немає shift-click
   bypass history cache/пояснення cached progress. Чи потрібен той самий кеш-двигун —
   технічне рішення; поведінку оновлення даних не можна просто втратити.
5. Вивід — stand-up text + прості DisclosureGroup. Не відтворено Chrome executive cards,
   activity chart, докладну activity table Who/What/Time, person metrics, per-person
   finished toggles і sprint layout.
   [Native ReportResultView:9](../apps/macos/Sources/PowerView/ReportResultView.swift#L9)
   — один global showCompleted і plain rows;
   [Chrome DailyWeeklyOutput:273](../apps/web/src/app/reporting/ReportsView.tsx#L273) має
   іншу структуру.
6. PDF — plain detailed text через CoreText, а Chrome друкує оформлений report HTML.
   Коректний multipage PDF не є копією дизайну report export. Потрібне порівняння двох
   артефактів.

## Пріоритет P2/P3 — Estimation, дизайн і збереження

Нова Estimation за source має всі п’ять етапів і основні поля старого workflow, позитивний
dev estimate gate, уточнення/scope/QA invalidation, search, counters і JSON handoff. Це не
дозволяє оголосити повну тотожність:

- Root обмежує estimation шириною 1180, колонки фіксовані 220, тоді як Chrome wide tool
  page + `repeat(5,minmax(220px,1fr))` розтягує їх на доступну ширину. Cards мають
  lineLimit(3), інші font sizes, Search label над полем замість горизонтально. Є
  source-known design differences, не лише системні control skins.
- На Estimation немає окремої «← Workspace», яка є в
  [Chrome App:623](../apps/web/src/app/App.tsx#L623); тільки topbar. Немає truncated
  workspace note; snapshot не зберігає completeness/truncation. Loading весь board без
  Chrome cap змінює й цю поведінку.
- Export handoff не додає `issues:[key,summary,stage]`, як Chrome export; для round-trip
  drafts це необов’язково, але за вимоги повної копії JSON-артефакт відрізняється.
- Swift `Double` і JavaScript `Number` мають різну множину числових рядків (наприклад,
  JavaScript приймає `0x10`). Це невелика, але реальна відмінність imported draft
  validation/total; потрібні fixtures edge cases, не лише звичайні 3/5 днів. Native
  числове поле також plain text замість Chrome `type=number,min=0.1,step=any`.
- Нове редагування одразу змінює `@Binding state`, тому попередній окремий commit-form
  дефект не слід автоматично переносити на новий UI. Але Chrome autosave
  per-board/localStorage замінено FileDocument без окремо доведеного
  recovery/попередження/закриття незбереженого документа. Потрібна нова перевірка
  quit/reopen; старий PASS або FAIL тут неактуальний.
- Setup не має всіх Chrome hierarchy/storypoints/sprint mapping, recent JQL і повного
  transfer UI. API token у desktop є очікуваною платформною відмінністю, але у новому
  Setup немає дії використати вже збережений Keychain token, хоча вона існує в іншій, не
  підключеній settings-form.
- Diagnostics зведено до трьох рядків; Chrome має докладні connection/load diagnostics.
  Update app відтворює напис, але не перевіряє/не застосовує нову збірку. Кнопка зі схожим
  текстом без тієї самої дії не є parity.
- Cloud-only adapter лишився. Chrome має Cloud/Data Center; не можна назвати повний
  перенос підтриманих інстанцій виконаним без adapter/явного погодженого виключення.

## Що потрібно приймати далі

Порядок конкретної роботи: C1–C4 (scope/origin/settings correctness), реальний Chrome
portable export C6, write/readback C5, Gantt missing interactions, Reports missing
structure/actions, visual comparison й Estimation edge parity.

Після source-виправлень потрібні окремо: два workspace з однаковими ключами; реальні
Chrome-export файли; delayed metadata responses; same-fixture Chrome/native screenshots на
однаковому viewport; keyboard navigation; date/status/assignee write preview з синтетичним
сервером і readback; history delete; Team/person reports до першої генерації; report/PDF
comparison; persistence quit/reopen; великий Gantt fixture. Live Jira write лише після
окремого погодження конкретної операції.

**Поточний висновок — суттєва переробка в правильну структуру, але ще неповна копія.**
Наявність source екранів, успішна компіляція чи старі тести не закривають перелічених
сценаріїв.

## Повторна перевірка виправлень C1–C6, 20 жовтня

Перевірено лише ці виправлення у новому стані, без UI та live Jira. Початкові знахідки
вище залишено як історію аудиту; їх не слід читати як незмінний стан після цієї перевірки.

| Знахідка | Поточний висновок за кодом                                                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1       | Основна причина виправлена: Core `ProductWorkspace.activate` архівує estimation/plans/links/preferences/reconciledDates за origin+board, load викликає activate. Це source-confirmed виправлення; A→B→A через реальний UI ще не перевірено.                             |
| C2       | Основні Gantt read/write entry points перевіряють `state.matches(jira.client)`, write controls залежать від origin. Ризик явного A-snapshot→B-write закрито на цих шляхах за кодом. Зміна session під час вже відкритого metadata sheet окремо не відтворювалась.       |
| C3       | Виправлено: Reports не читає старий ReportWorkspaceStore, коли є importedSetup, і generation перевіряє origin. Runtime два борди не перевірялися.                                                                                                                       |
| C4       | Observers замінені explicit project/board bindings; metadata/board/status requests мають UUID+origin/selection guards; restore зберігає JQL/mapping. Основну описану race виправлено за кодом. Delayed-response сценарій не запускався.                                 |
| C5       | Виправлено основний шлях: refreshAfterWrite перечитує workspace, відрізняє outcomes, оновлює accepted dates для successful date operations, прибирає їх local plans. Root Update викликає network refresh із identity guard. Partial failure/readback UI не перевірено. |
| C6       | Portable envelope decoder/export додано; незалежний реальний round-trip нижче пройдено для одного валідного повного набору. Залишилися semantic mapping loss та обмеження schema edge cases, зазначені нижче.                                                           |

Незалежно виконано реальний `SettingsStore.exportBoardConfiguration` з оригінального
TypeScript, а не вручну складений JSON. Створено
`/private/tmp/power-view-real-chrome-export.json`: повний setup із project.id/name, scrum
board/projectKeys, JQL, start/end mapping, reporting mapping,
defaultDurations/nonWorkingDays; Gantt filters, view preferences, FS dependency із lag=1 і
reconciledDates. Потім окремий Swift executable, зв’язаний із наявними Core object files,
викликав **фактичні** `ChromeSetup.decode` та
`ProductWorkspace.exportPortableConfiguration`; результат збережено
`/private/tmp/power-view-native-reexport.json`. Оригінальний **строгий**
`SettingsStore.importBoardConfiguration` прийняв native результат. Це доказ schema
compatibility для цього набору, а не всього UI-import сценарію або довільних даних. Нових
секретів чи мережевих викликів не було.

Залишкове C6: `ProductSetup.load` заново будує fieldMapping лише start/end, тому
імпортовані hierarchy/storyPoints/sprint mapping зникають у `state.setup`; export бере
саме це setup і перезаписує ним `importedConfiguration.configuration.setup`. Прямий Core
round-trip, виконаний тут, зберігає imported.raw і тому не проходить через цю втрату
UI-load. Schema може прийняти результат, але перенос налаштувань семантично неповний.
Потрібен додатковий portable fixture з трьома mapping і прохід import→load→export.

Ще один schema edge: Chrome defaultDurations потребує цілих значень 1…365 для фіксованих
шести ключів; native ChromeSetup допускає Double до 366, export бере overrides без
еквівалентної перевірки. Звичайний реальний Chrome-export цього не містить, але довільний
native стан/налаштування може дати export, який строгий Chrome import відхилить. Не слід
називати export гарантовано валідним для всіх native states до перевірки цих меж.

Продуктний код під час повторної перевірки не змінено. Інші Gantt/Reporting/visual
findings цією вузькою перевіркою не переприймалися.

## Наступна read-only перевірка Reporting, Board Health і Gantt

Прочитано нові `ReportPresentation.swift`, `ReportResultView.swift`,
`ProductBoardHealth.swift` та поточні UI-зміни. Старі finds нижче уточнені; UI не
запускався. Під час активних змін будь-яке вже виправлене місце потрібно трактувати як
історичну знахідку.

Підтверджене просування за source: додано activity grouping із того самого
issue/time/actor ключа та виключенням synthetic completed/reopened із текстового log;
changed-issues hierarchy; KPI/activity/delivery/people panels; per-person Show finished;
Board Health перед report builder; history Delete+confirmation; dependency arrowheads та
removal controls; збереження додаткових field mapping і duration 1…365. Отже попередні
пункти «цього UI взагалі немає» до цих компонентів більше не застосовні. Це не
підтвердження точного visual/runtime parity.

### R1 — P1: немає Current sprint половини Board Health

Новий `ProductBoardHealth` має board totals/status/planning drill-down, але завершується
після них. Chrome `BoardHealthReport.tsx` має окремий Current sprint: active-sprint
picker, server-verified issues із loading/error, completed/remaining/unassigned/blocked
KPIs, sprint progress segments, team breakdown, SP coverage та issues per person/status
(приблизно рядки 680–930). Наявні Core `BoardHealthCalculator.sprint`/generator не є UI
цієї можливості. Для копії потрібно підключити той самий ручний користувацький сценарій,
включно з відмовою вдавати completeness при невдалому membership-read.

### R2 — P1/P2: Sprint report показує Daily-значення замість свого layout

`NativeReportResultView` не розрізняє тип для executive KPIs: Completed завжди
`completedDuringPeriod`. Chrome Daily використовує це значення, але Chrome Sprint summary
використовує `completedIssues` та окремо `result.sprint.completion.percentage`. У native
`sprint.completion` взагалі не відображається; додано лише added/removed lists. Stand-up
текст може містити частину цифр, але не замінює головний показник і різні UI-сценарії.

Контрольний приклад: спринт має завершену до поточного period задачу; `completedIssues` і
`completedDuringPeriod` різні. Порівняти Chrome/native Sprint, потім перемкнути completion
basis. Потрібні окремі daily/weekly та sprint presentation branches.

### R3 — P2: Changed issues втратили прив’язаний до вузла change log

Chrome `IssueTreeItem` відображає issue type/accent, assignee, context styling untouched
ancestors та під кожною зміненою задачею таблицю Time / Who did the change / What changed.
Новий changedTree правильно обирає ієрархію, але `ReportResultView.issueRow` показує
key/summary/estimate/time/status, без цих даних; усі events винесено в загальний Activity
log унизу. Це не та сама дія огляду «яка саме зміна цієї задачі». Потрібно передати
grouped log по issueKey у вузли, зберегти ancestor context та ідентифікацію типу/власника.

### R4 — P2: People Assigned work не відповідає видимому фільтру

Chrome People показує `visibleIssues.length`, а коли finished приховані — також
`of assignedIssues.length`; native завжди показує `assigned.count`. Наприклад, одна
відкрита й одна завершена задача дають Chrome «1 of 2», native «2», хоча розгорнутий
список має одну. Show finished тепер є, але counters/finished count/detail heading ще не
перенесені. Це відмінність видимого значення, не лише оформлення.

### R5 — P2: Delete history залишає видалений snapshot відкритим

Delete вже реалізований, але callback видаляє диск і перечитує history, не прибираючи
`snapshot` коли його id дорівнює deleted id. Chrome `deleteHistory` явно робить
`setSnapshot(undefined)`. Користувач може продовжувати переглядати/копіювати/експортувати
вже видалений матеріал без видимого статусу. Потрібна та сама синхронізація відкритого
результату.

### R6 — P2: origin посилань result перевіряти на реальному snapshot

На останньому читанні `ReportResultView.issueLink` шукав
`board.jiraBaseUrl ?? request.jiraBaseUrl`, тоді як обидва native generator-и зберігають
origin у `jira.baseUrl`. Це перетворює Jira keys на Text у generated result замість Link.
Основному виконавцю повідомлено; він зазначив, що виправляє/виправив цей шлях. Приймання:
generated snapshot без штучних додаткових полів має відкривати Jira з changed tree, people
і Activity log. Не перевіряти лише вручну зібраний fixture з іншою схемою origin.

Activity grouping за source близьке до оригінального `activity-log.ts`; окремого нового
дефекту звичайного grouping не виявлено. Точного visual порівняння, доведення PDF parity
або живого приймання ці доповнення не містять.

## Повторна перевірка CurrentSprint, metadata та PDF

Read-only перевірка наступного стану підтвердила: CurrentSprint тепер підключено,
generator перевіряє sprint membership через Jira і передає розраховані blockedIDs;
issueLink використовує `jira.baseUrl`; history Delete очищає відкритий snapshot;
visible/of-total People counter доданий; є sprint completion/time utilization/unestimated
cards. Старі твердження про відсутність цих конкретних елементів більше неактуальні. Це
перевірка коду, не UI/мережевого результату.

Залишкові функціональні розбіжності:

1. **CurrentSprint не дає drill-down.** ProgressView і Team breakdown plain rows у
   `ProductCurrentSprint.swift` не відкривають задачі за статусом/людиною, немає
   per-person Show finished. Chrome `BoardHealthReport.tsx:796–900` має expand, visible
   count/total, finished filter та Jira links. Також у team table немає Not
   started/distribution, натомість додана інша колонка Story points.
2. **Невідомі Story Points подані як нульові.** CurrentSprint без явно доступного points
   mapping показує `0 / 0 completed` і `0% coverage`. Chrome використовує
   `storyPointsDataAvailable`, приховує coverage або пояснює недоступність. Generator
   зараз має fallback board estimation.fieldId: слід перевірити board із time-based
   estimation, щоб секунди не підписувалися Story points. Це окремий контрольний сценарій,
   а не твердження про виконаний live тест.
3. **Верхній Sprint Completed KPI на момент читання все ще `completedDuringPeriod`.**
   Окремий completion percentage вже є, але перша Completed-картка у
   `ReportResultView.swift:21–23` лишалася без sprint branch; Chrome Sprint summary
   використовує `completedIssues`. Якщо зміна вже внесена після читання — потрібна
   перевірка саме поточного файла.
4. **CurrentSprint warning visibility неповна.** `load()` показує completeness warning
   лише коли sprintHealth порожній; якщо спринт є, решта warnings snapshot не виводяться.
   Неповноту SP/unknown statuses потрібно показувати біля результату, як Chrome, а не лише
   при повній відсутності спринту.
5. **Structured PDF ще не копія report export.** `ReportPDFExporter.write(snapshot:)` —
   справжній оформлений багатосторінковий документ, але не відтворює period activity bars,
   вкладені per-issue Time/Who/What, sprint time utilization/unestimated cards та
   hyperlinks до Jira. Відсутність цих секцій видно у функції без вигаданого screenshot
   PASS. Потрібне порівняння артефактів Chrome/native на одному snapshot; structured text
   сам по собі не закриває дизайн-паритет.

`JiraFieldMapping.infer/validate` відтворює основні candidate scores, preferred start/due,
legacy Epic link і типові валідації оригіналу; нового суттєвого дефекту цих правил у
прочитаному коді не знайдено. `ProductJiraMetadata` тепер popover із server
transitions/assignable users; це ближче до Chrome. Водночас async search залишає старий
users список видимим під час нового запиту і не очищає стару error після успішного search
— невеликий UX gap, не підстава називати весь popover непрацюючим. Runtime
edit/attribution не перевірялися.

## Поточний read-only зріз 24 жовтня: persistence та lifecycle

Перечитано actual files, UI не займався. Попередні R1/R2/R4/R5/R6 не повторюються як
відсутні реалізації: CurrentSprint drill-down/warnings/SP availability, correct Sprint
KPI, history clear, people counts, links і PDF sections суттєво доповнено. Нижче —
конкретні поточні проблеми за кодом, не runtime PASS/FAIL.

### L1 — P1: Open може відкинути незбережену роботу

[WorkspaceDocumentStore.swift:62](../apps/macos/Sources/PowerView/WorkspaceDocumentStore.swift#L62)
успішно читає наступний файл, потім скасовує autosave і замінює document без
flush/preserve попереднього. Autosave має 300ms debounce (рядок 47). Open через URL
відразу після редагування, або після попереднього autosave error, знищує останню
неперсистовану версію. New Workspace зберігає попередній стан — Open має забезпечити таку
саму гарантію. Контроль: змінити поле й програмно відкрити інший валідний файл до
debounce, потім перевірити попередній файл/recovery. UI-тест тут не виконувався.

### L2 — P1/P2: пошкоджений last-open файл блокує справний recovery

[WorkspaceDocumentStore.swift:25](../apps/macos/Sources/PowerView/WorkspaceDocumentStore.swift#L25):
якщо lastOpenPath існує, init викликає open, а при read/decode error вже не заходить у
fallback recovery. Користувач отримує порожній workspace+error, хоча окрема справна
recovery-копія може існувати. Потрібно distinguish primary failure та
пропозицію/автоматичний read-only recovery; не перезаписати recovery порожнім state.
Контроль: lastOpenPath→існуючий невалідний JSON плюс валідний recovery.

### L3 — P1/P2: Setup.load допускає змішану ревізію mapping

[ProductSetup.swift:427](../apps/macos/Sources/PowerView/ProductSetup.swift#L427) захоплює
mapping/preferences до network await, але guard на рядках 460–462 звіряє лише
project/board/JQL/start/end/origin. Hierarchy, Story Points, Sprint, completed mapping та
preferences залишаються не включеними в guard. Snapshot побудовано зі старими values, а
nextSetup reporting береться з поточного completed після await; користувацькі зміни
controls можуть бути збережені неузгоджено або загублені. Потрібна єдина captured setup
revision із guard/блокуванням controls на всю операцію.

### L4 — P2: per-board archive не відновлює explicit setup

`ProductWorkspace.savedBoards` архівує estimation/plans/links/preferences, але не власний
setup/JQL/status mapping кожного борду.
[ProductSetup.swift:290](../apps/macos/Sources/PowerView/ProductSetup.swift#L290) при
`chooseBoard(restore:false)` відновлює preferences, потім замінює completed на всі
done-category statuses. A→B→A втрачає спеціальну completed mapping A й може застосувати
mapping fields/JQL іншого scope. Chrome зберігає setup per origin/project/board. Це окремо
від уже виправленої ізоляції preparation cards.

### L5 — P1/P2: time estimation борду може бути підписано Story Points

[JiraReporting.swift:540](../apps/macos/Sources/PowerViewCore/JiraReporting.swift#L540)
fallback
`pointsField = request.storyPointsFieldId ?? boardConfig.estimation.field.fieldId` не
перевіряє, що board estimation є points. Якщо fieldId=`timeoriginalestimate`, значення
секунд потрапляють у normalized.storyPoints; `storyPointsDataAvailable` стає true лише
через наявність fieldId (рядок 663), CurrentSprint показує їх як SP. Потрібен fixture
time-based Scrum board без explicit points mapping: seconds не можна називати points або
вдавати coverage. Це source-derived сценарій, live Jira не викликалася.

PDF зараз має actual hyperlinks, time utilization/unestimated, per-issue changes та period
activity sections; старі твердження про їх повну відсутність більше неактуальні. Visual
parity Chrome report HTML проти native PDF досі не доведено: activity — текст, не bar
chart, layout відмінний; це не нова доведена втрата числових даних. У цьому зрізі
пріоритет за L1–L5, а не повторенням уже виправлених старих findings.

## Перевірка 25 жовтня: shared handoff та persistence races

Read-only actual files. Підтверджено виправлення базової версії L1: Open тепер flush перед
заміною; L2: WorkspaceRecovery пробує fallback; L3: setup guard включає
extras/preferences; L4: archive setup та restore mapping/completed додані. Ці
source-виправлення не означають відсутність нових race нижче. UI й зовнішні дані не
змінено.

### H1 — P1/P2: прив’язка handoff не зберігається в archive

[ProductWorkspace.swift:58](../apps/macos/Sources/PowerViewCore/ProductWorkspace.swift#L58)
archive initializer передає preparation/plans/preferences/setup, але не
`handoffPath`/`handoffFingerprint`. Вони є optional полями archive та читаються при
restore (рядки 70–71), тому A→B→A повертає nil замість попереднього shared
target/fingerprint. Додати поля лише до struct було недостатньо. Контроль: відкрити
handoff A, перейти B, повернути A та перевірити Save target/stale check.

### H2 — P1: flush не закриває MainActor reentrancy під час Open/New

[WorkspaceDocumentStore.swift:66](../apps/macos/Sources/PowerView/WorkspaceDocumentStore.swift#L66)
читає наступний документ, викликає `await flush()`, після чого перевіряє лише
`openRequest`. Поки очікується actor persistence, main actor може прийняти новий edit,
який збільшує revision і ставить новий autosave. Повернення Open замінює документ без
перевірки revision/повторного flush, а новий autosave може бути згодом скасований
наступною дією. `newWorkspace` має аналогічний await-save→replace і не інвалідовує
openRequest, тому pending Open може замінити щойно створений New. Потрібна serial
lifecycle transaction, замороження редагування або revision-aware повторна перевірка й
узгоджене скасування Open/New/SaveAs, а не лише UUID для двох Open.

### H3 — межа гарантії: coordinated local compare-hash не є cross-Mac cloud CAS

`HandoffFileStore.save` атомарно координує read/hash/write між cooperating локальними
процесами. Це корисний захист від уже видимого stale local файла. Він не дає одноосібного
редактора чи глобальної compare-and-swap гарантії для двох Mac із затримкою Drive sync:
обидві локальні копії можуть мати очікуваний старий hash, обидва save успішні до появи
remote зміни. Відсутність `NSFileCoordinator` readingItem на import також означає, що
читання не бере участі у coordination protocol.

Це не підстава прибирати ручний file handoff; це підстава точно позначити його межі. Для
обіцянки conflict-safe shared editing між Mac потрібен інший доведений механізм або чітко
ручна послідовна передача. Не прирівнювати local tests до multi-Mac Drive concurrency
test.

### H4 — P2: PDF HTML load може залишити операцію очікування незавершеною

`ProductReportPDF.write` очікує continuation, яку завершують лише
didFinish/didFail/didFailProvisionalNavigation. Немає timeout/cancellation-handler або
`webViewWebContentProcessDidTerminate`; при смерті WebContent процесу render task може
залишитися pending. Потрібне завершення continuation рівно один раз для всіх
termination/cancel шляхів; actual crash не відтворювався. HTML escaped, URL scheme
whitelist і CSP у `ReportHTML` присутні; очевидної ін’єкції в перевіреному link builder не
знайдено.

L5 status на останньому читанні:
[JiraReporting.swift:542](../apps/macos/Sources/PowerViewCore/JiraReporting.swift#L542)
усе ще мав прямий fallback estimation.fieldId без відсікання системних time fields. Поки
це так у actual file, попередній seconds-as-points сценарій не закритий; основному
виконавцю повідомлено можливу незбережену/непідключену правку. Старий CoreText-PDF audit
не застосовується автоматично до нового WK HTML print path; новий вивід потребує окремого
artifact comparison.

### Фінальний вузький recheck наступних правок 25 жовтня

В actual файлах підтверджено: обидва `pointsField` fallback беруть лише customfield,
системний timeoriginalestimate більше не fallback SP; PDF має timeout 30s та
process-termination callback із одноразовим finish. H4 і fallback-частину L5 закрито за
source. Це не тест runtime process crash або довільного configured points field.

H1 **ще не закрито у прочитаному файлі**: `ProductWorkspace.activate` initializer досі
закінчувався `setup: setup)` без двох handoff полів. Повідомлено основному виконавцю.

Замість первинного H2 додано `saveCurrent(to:mirror:)` з revision loop. Один flush тепер
помічає edit під час await, але два паралельні lifecycle виклики залишають небезпечні
сценарії:

- **P1, livelock:** Open A та Open B обидва заходять у saveCurrent. Кожна ітерація сама
  збільшує shared revision, а потім await actor save. A бачить ревізію B і повторює; B
  бачить ревізію A і повторює. Черга може нескінченно писати й не завершитися навіть без
  користувацьких edits. `openRequest` перевіряється лише після flush і не зупиняє
  конкурентний loop.
- **P1, cross-document write risk:** target збережений на вході saveCurrent, а на retry
  `state = document.state` читається заново. Якщо інший lifecycle вже замінив
  document/session, старий loop може записати новий документ у старий target. Інвалідація
  openRequest не захищає самі retries; New не перевіряє свою transaction identity після
  await.

Потрібен серіалізований lifecycle або єдина transaction queue із session identity та
cancellation до кожного persistence retry. Revision-loop сам по собі не достатній. Це
source interleaving analysis; UI/файли користувача не використовувалися, дефект навмисно
не відтворювався на живих workspace.

### Наступний actual recheck serialized lifecycle

Перечитано файли після наступної зміни: `ProductWorkspace.activate` **тепер** реально
передає `setup`, `handoffPath` і `handoffFingerprint` в archive initializer. H1 закрито за
source.

`WorkspaceDocumentStore` тепер ставить `switching` до await для Open/New/Save; конкурентні
Open/New/Save відхиляються, flush чекає звільнення gate; root UI disabled під час
switching. `saveCurrent` більше не збільшує revision на кожному retry. Попередній описаний
ping-pong двох lifecycle flush та replacement під час старого retry цими змінами закрито
за кодом. Невиконані команди під час switching зараз ігноруються, а не стають у чергу; це
поведінка gate, не доведена втрата даних. Preferred→recovery fallback присутній, попередня
робота зберігається у preservationURL/previousPath.

Нових P1 blockers у цьому вузькому source-recheck не виявлено. Залишковий P2 для ясності
стану: `replace` позначає saved=true перед фінальним recovery write; якщо він падає,
документ уже змінено, а повідомлення generic Open/New failure не пояснює частковий
результат. Попередня робота має preservation файл, тому це не доведена втрата даних.
Runtime fault injection/kill recovery не проводилися; повний visual/functional parity цим
не прийнятий.
