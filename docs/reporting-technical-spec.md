# Технічне ТЗ: Reporting для Power View for Jira

| Поле | Значення |
| --- | --- |
| Статус | Draft 0.1 |
| Дата | 2026-08-02 |
| Продукт | Power View for Jira |
| Модуль | Reporting |
| Цільові середовища | Jira Cloud, Jira Data Center / Server за наявності сумісних REST API |
| Часова зона звітів | `Europe/Kyiv` |
| Локалі результату | `en`, `uk` |

## 1. Призначення документа

Документ визначає технічну реалізацію модуля Reporting у наявному browser-only Chrome MV3 застосунку Power View for Jira.

Модуль повинен:

- формувати Daily, Weekly і Sprint звіти на основі вибраного Jira Board;
- показувати звіт на окремому екрані Power View;
- створювати PDF;
- створювати готовий текст для stand-up;
- зберігати незмінні локальні snapshots сформованих звітів;
- не вимагати backend-сервера;
- не змінювати дані в Jira.

## 2. Узгоджені продуктові рішення

1. Звіт налаштовується для всієї команди або одного користувача.
2. Команда визначається за виконавцями задач, що входять до звіту.
3. Задачі без виконавця відображаються в окремому блоці `Unassigned`.
4. Worklog належить автору worklog-запису; задача належить її поточному виконавцю.
5. Виконаними вважаються задачі у статусах, локально замаплених для конкретного борду. До такого маппінгу мають входити точні Jira-статуси `Done` та `In Review` відповідного борду.
6. Маппінг статусів зберігається локально і не синхронізується між браузерами.
7. Sprint completion і Time utilization є різними метриками.
8. Sprint completion можна перемикати між кількістю задач, Story Points та Original Estimate.
9. Неоцінені задачі не змішуються зі Story Points або секундами. Вони показуються окремою кількістю.
10. Sprint Report використовує всі задачі поточного складу спринту.
11. Задачі, додані після старту спринту, і задачі, виключені після старту, показуються окремо.
12. Історія звітів локальна, immutable, без автоматичного очищення; видалення лише ручне.
13. У snapshot зберігаються структуровані дані. PDF і stand-up текст повторно генеруються зі snapshot.
14. PDF і stand-up текст формуються англійською або українською на вибір.

## 3. Межі реалізації

### 3.1. У scope

- список доступних Jira Boards;
- список спринтів вибраного Scrum board;
- локальний маппінг completed-статусів для кожного борду;
- завантаження поточного стану задач;
- завантаження changelog для цільових полів;
- завантаження Worklog;
- обчислення метрик;
- групування за виконавцями та авторами Worklog;
- визначення sprint scope changes;
- екран сформованого звіту;
- PDF export;
- stand-up text export/copy;
- локальна історія snapshots;
- ручне видалення snapshot;
- Jira Cloud та best-effort сумісність з Jira Data Center / Server.

### 3.2. Поза scope

- серверне зберігання або синхронізація звітів;
- спільний маппінг статусів для команди;
- автоматична email/Slack-доставка;
- автоматичний запуск за розкладом;
- зміна Jira issues, sprint або board з екрана Reporting;
- зберігання готових PDF Blob у локальній історії;
- машинний переклад Jira summary, status name або іншого контенту користувача;
- відновлення видаленого snapshot.

## 4. Поточна архітектура та необхідні зміни

Power View є browser-only pnpm monorepo:

- `apps/web` — React UI;
- `apps/extension` — Chrome MV3 shell, service worker, content script та Jira request policy;
- `packages/domain` — framework-independent доменні правила;
- `packages/jira-client` — Cloud/Data Center Jira adapters;
- `packages/extension-messaging` — Zod-валідовані runtime messages;
- `packages/storage` — versioned local storage;
- `packages/ui` — спільні UI primitives.

Поточний `JiraTransportRequest` приймає лише шляхи, що починаються з `/rest/api/`, а request policy дозволяє обмежений набір Platform REST endpoint-ів. Reporting потребує доступу до `/rest/agile/1.0/*`, Cloud enhanced `/rest/software/1.0/*`, issue changelog та worklog.

### 4.1. Нові доменні модулі

У `packages/domain/src/` додати:

- `reporting.ts` — типи звіту, metrics та агрегати;
- `reporting-period.ts` — розрахунок часових меж;
- `reporting-calculations.ts` — pure-функції метрик;
- `reporting-scope.ts` — sprint membership transitions;
- `reporting-standup.ts` — локалізована структурована модель stand-up тексту.

Доменний пакет не повинен імпортувати React, Chrome APIs, PDF renderer або Jira transport.

### 4.2. Розширення Jira client

У `packages/jira-client` додати read-only контракти:

```ts
interface ReportingJiraClient {
  getBoards(request: GetBoardsRequest, signal?: AbortSignal): Promise<JiraBoardPage>;
  getBoard(boardId: string, signal?: AbortSignal): Promise<JiraBoard>;
  getBoardConfiguration(
    boardId: string,
    signal?: AbortSignal,
  ): Promise<JiraBoardConfiguration>;
  getBoardIssues(
    request: GetBoardIssuesRequest,
    signal?: AbortSignal,
  ): Promise<ReportingIssuePage>;
  getBoardSprints(
    request: GetBoardSprintsRequest,
    signal?: AbortSignal,
  ): Promise<JiraSprintPage>;
  getSprint(sprintId: string, signal?: AbortSignal): Promise<JiraSprint>;
  getSprintIssues(
    request: GetSprintIssuesRequest,
    signal?: AbortSignal,
  ): Promise<ReportingIssuePage>;
  getIssueChangelogs(
    request: GetIssueChangelogsRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedChangelogPage>;
  getIssueWorklogs(
    request: GetIssueWorklogsRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedWorklogPage>;
}
```

Cloud і Data Center adapters реалізують один нормалізований контракт, але мають окремі pagination strategies.

### 4.3. Спільна Jira session у web app

Поточний `JiraClient` створюється всередині setup flow. Для Gantt і Reporting слід винести authenticated Jira session у спільний app-level provider/service:

```ts
interface JiraSession {
  context: JiraPageContext;
  connection: Extract<ConnectionState, { status: "authenticated" }>;
  client: JiraClient & ReportingJiraClient;
}
```

Reporting доступний після успішного connection test і не залежить від того, чи було налаштовано Gantt JQL.

## 5. Доменна модель

### 5.1. Базові типи

```ts
type ReportType = "daily" | "weekly" | "sprint";
type ReportLanguage = "en" | "uk";
type SprintProgressMode = "issue-count" | "story-points" | "original-estimate";

type ReportScope =
  | { kind: "team" }
  | { kind: "assignee"; userId: string };

interface ReportPeriod {
  timeZone: "Europe/Kyiv";
  start: string;       // ISO instant, inclusive
  end: string;         // ISO instant, exclusive
  dataCutoff: string;  // generatedAt або end, що наступить раніше
}
```

Усі timestamps зберігаються як ISO 8601 UTC instants. `Europe/Kyiv` використовується лише для визначення календарних меж і presentation.

### 5.2. Board та Sprint

```ts
interface JiraBoard {
  id: string;
  name: string;
  type: "scrum" | "kanban" | "simple" | "unknown";
  projectKeys: string[];
}

interface JiraSprint {
  id: string;
  name: string;
  state: "future" | "active" | "closed" | "unknown";
  originBoardId?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

interface BoardReportConfiguration {
  schemaVersion: 1;
  jiraBaseUrl: string;
  boardId: string;
  completedStatusIds: string[];
  completedStatusNames: string[];
  storyPointsFieldId?: string;
  updatedAt: string;
}
```

Status ID є технічним ключем. Точна назва зберігається для відображення, діагностики та виявлення видаленого/заміненого статусу.

### 5.3. Reporting issue

```ts
interface ReportingIssueSnapshot {
  id: string;
  key: string;
  browseUrl: string;
  summary: string;
  issueType: { id: string; name: string };
  status: { id?: string; name: string };
  assignee?: NormalizedReportUser;
  createdAt?: string;
  resolvedAt?: string;
  updatedAt?: string;
  storyPoints?: number;
  originalEstimateSeconds?: number;
  timeSpentSeconds?: number;
  sprintIds: string[];
}

interface NormalizedReportUser {
  id: string; // accountId -> key -> name, у такому порядку
  displayName: string;
  avatarUrl?: string;
}
```

Для reporting issue search додати до стандартного списку полів:

- `timeoriginalestimate`;
- `timespent`;
- Jira Agile Sprint field;
- mapped Story Points field;
- поточні `summary`, `issuetype`, `status`, `assignee`, `created`, `updated`, `resolutiondate`, `project`.

Опис задачі, comments і Worklog comments не запитуються та не зберігаються.

### 5.4. Changelog event

```ts
type ReportChangeType =
  | "issue-created"
  | "issue-completed"
  | "issue-reopened"
  | "status-changed"
  | "assignee-changed"
  | "story-points-changed"
  | "original-estimate-changed"
  | "sprint-added"
  | "sprint-removed";

interface ReportChangeEvent {
  id: string;
  issueId: string;
  issueKey: string;
  type: ReportChangeType;
  occurredAt: string;
  actor?: NormalizedReportUser;
  fieldId?: string;
  from?: string | number | null;
  to?: string | number | null;
  sprintId?: string;
}
```

Changelog normalizer пропускає лише allowlisted fields: status, assignee, mapped Story Points, Original Estimate та Sprint. Інші поля не потрапляють у доменну модель або snapshot.

### 5.5. Worklog

```ts
interface ReportWorklog {
  id: string;
  issueId: string;
  issueKey: string;
  author: NormalizedReportUser;
  startedAt: string;
  timeSpentSeconds: number;
  createdAt?: string;
  updatedAt?: string;
}
```

Період Worklog визначається за `startedAt`, а не за датою створення або редагування запису.

### 5.6. Immutable report snapshot

```ts
interface GeneratedReportSnapshot {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  generatorVersion: string;
  jira: {
    baseUrl: string;
    deploymentType: JiraDeploymentType;
  };
  request: {
    type: ReportType;
    boardId: string;
    sprintId?: string;
    scope: ReportScope;
    period: ReportPeriod;
    progressMode?: SprintProgressMode;
  };
  board: JiraBoard;
  sprint?: JiraSprint;
  statusMapping: BoardReportConfiguration;
  issues: ReportingIssueSnapshot[];
  changes: ReportChangeEvent[];
  worklogs: ReportWorklog[];
  result: ReportResult;
  completeness: ReportCompleteness;
}
```

Snapshot не редагується після запису. Дозволена лише операція видалення всього snapshot.

## 6. Часові періоди

Всі інтервали є half-open: `[start, end)`. Подія рівно на `start` включається, рівно на `end` — належить наступному звіту.

### 6.1. Daily

Для вибраної локальної дати `D`, яка є датою завершення Daily report:

- `start` = `D - 1 day`, 08:00 у `Europe/Kyiv`;
- `end` = `D`, 08:00 у `Europe/Kyiv`;
- `dataCutoff` = `min(end, generatedAt)`.

### 6.2. Weekly

Для тижня, що містить вибрану дату:

- `start` = понеділок, 08:00 у `Europe/Kyiv`;
- `end` = наступний понеділок, 08:00 у `Europe/Kyiv`;
- `dataCutoff` = `min(end, generatedAt)`.

Якщо звіт створено до завершення тижня, header все одно показує повний weekly interval, а дані мають явний маркер `Data as of <dataCutoff>`.

### 6.3. Sprint

- active sprint: `start = sprint.startDate`, `end = generatedAt`, `dataCutoff = generatedAt`;
- closed sprint: `start = sprint.startDate`, `end = sprint.completeDate ?? sprint.endDate`, `dataCutoff = end`;
- future sprint не може бути джерелом Sprint Report;
- sprint без `startDate` не може бути згенерований; UI показує validation error.

### 6.4. DST

Не дозволено розраховувати Kyiv time через константний UTC offset. Реалізація повинна використовувати IANA zone `Europe/Kyiv` та timezone-aware date API/library. Unit tests мають покривати переходи на літній і зимовий час.

## 7. Jira REST інтеграція

### 7.1. Board та Sprint API

| Операція | Jira Cloud | Jira Data Center / Server | Pagination |
| --- | --- | --- | --- |
| Список boards | `GET /rest/agile/1.0/board` | той самий шлях | `startAt`, `maxResults` |
| Board details | `GET /rest/agile/1.0/board/{boardId}` | той самий шлях | немає |
| Board configuration | `GET /rest/agile/1.0/board/{boardId}/configuration` | той самий шлях | немає |
| Board issues | `GET /rest/software/1.0/board/{boardId}/issue` | `GET /rest/agile/1.0/board/{boardId}/issue` | token / offset |
| Список sprints | `GET /rest/agile/1.0/board/{boardId}/sprint` | той самий шлях | `startAt`, `maxResults` |
| Sprint details | `GET /rest/agile/1.0/sprint/{sprintId}` | той самий шлях | немає |
| Sprint issues | `GET /rest/software/1.0/board/{boardId}/sprint/{sprintId}/issue` | `GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue` | token / offset |

Для Cloud використовувати enhanced issue endpoint з `nextPageToken`. Deprecated offset endpoint не є primary path. Data Center adapter використовує `startAt`, `maxResults`, `total`.

### 7.2. Changelog API

Cloud primary path:

```text
POST /rest/api/3/changelog/bulkfetch
```

Обмеження request body:

- `issueIdsOrKeys`: максимум 1000 значень на batch;
- `fieldIds`: максимум 10 allowlisted полів;
- `maxResults`: bounded positive integer;
- `nextPageToken`: лише значення, отримане з попередньої відповіді.

Cloud fallback та Data Center / Server capability path:

```text
GET /rest/api/{2|3}/issue/{issueIdOrKey}/changelog?startAt=...&maxResults=...
```

Якщо Data Center version не підтримує окремий changelog endpoint, adapter може виконати capability-tested fallback через issue `expand=changelog`. Fallback не повинен змінювати нормалізований контракт.

### 7.3. Worklog API

Primary path:

```text
GET /rest/api/{2|3}/issue/{issueIdOrKey}/worklog
```

Cloud adapter передає `startedAfter` і `startedBefore`, коли endpoint їх підтримує. Незалежно від server-side filtering, client повторно застосовує half-open interval до `startedAt`.

Всі сторінки мають бути завантажені. Перші `maxResults` не можна трактувати як повний Worklog.

### 7.4. Права доступу

Reporting відображає лише boards, sprints, issues, changelog і Worklog, доступні поточній Jira browser session. Jira залишається джерелом істини для Browse Projects, issue security та Worklog visibility.

Значення `403` або відсутні через visibility дані не трактуються як нуль. Відповідна метрика отримує стан `unavailable`, а звіт — completeness warning.

### 7.5. Розширення transport schema

`jiraTransportRequestSchema.path` не повинен використовувати загальний `startsWith("/rest/api/")`. Схема має приймати лише три явні family:

```ts
const jiraPathSchema = z.union([
  z.string().startsWith("/rest/api/").max(512),
  z.string().startsWith("/rest/agile/1.0/").max(512),
  z.string().startsWith("/rest/software/1.0/").max(512),
]);
```

Приймання family у Zod не є авторизацією endpoint. Остаточне рішення завжди приймає exact route policy у service worker.

### 7.6. Read-only POST для bulk changelog

`POST /rest/api/3/changelog/bulkfetch` є read operation, але поточна policy вважає будь-який POST mutation. Policy слід розділити на:

- `validReadRequest` — GET allowlist плюс exact read-only POST bulkfetch;
- `validMutationRequest` — наявний обмежений edit path;
- `classifyRequestIntent` — повертає `read`, `mutation` або `denied`.

Bulk changelog body проходить strict validation і не може містити довільні ключі.

### 7.7. Новий route allowlist

Дозволити лише такі reporting routes:

```text
GET  /rest/agile/1.0/board
GET  /rest/agile/1.0/board/{numericBoardId}
GET  /rest/agile/1.0/board/{numericBoardId}/configuration
GET  /rest/agile/1.0/board/{numericBoardId}/issue
GET  /rest/software/1.0/board/{numericBoardId}/issue
GET  /rest/agile/1.0/board/{numericBoardId}/sprint
GET  /rest/agile/1.0/sprint/{numericSprintId}
GET  /rest/agile/1.0/board/{numericBoardId}/sprint/{numericSprintId}/issue
GET  /rest/software/1.0/board/{numericBoardId}/sprint/{numericSprintId}/issue
GET  /rest/api/{2|3}/issue/{issueKey}/changelog
GET  /rest/api/{2|3}/issue/{issueKey}/worklog
POST /rest/api/3/changelog/bulkfetch
```

Для кожного route задається незалежний query allowlist. Numeric board/sprint IDs та Jira issue keys перевіряються regex до побудови URL.

## 8. Завантаження і побудова звіту

### 8.1. Generation pipeline

1. Перевірити authenticated Jira session.
2. Перевірити report parameters.
3. Завантажити board details і configuration.
4. Завантажити локальний status mapping.
5. Якщо mapping відсутній або містить статуси, яких більше немає на борді, зупинити generation і відкрити mapping UI.
6. Для Sprint Report завантажити sprint details.
7. Розрахувати `ReportPeriod` і `dataCutoff`.
8. Завантажити всі сторінки current board/sprint issues.
9. Сформувати candidate issue set для changelog і scope history.
10. Завантажити changelog allowlisted fields.
11. Завантажити Worklog для candidate issues.
12. Нормалізувати та дедуплікувати дані.
13. Відфільтрувати changes і Worklog за `[start, dataCutoff)`.
14. Побудувати team/assignee blocks, Executive Summary та Sprint metrics.
15. Побудувати immutable `GeneratedReportSnapshot`.
16. Атомарно зберегти snapshot у local history.
17. Відкрити готовий report screen.

Кожен етап підтримує `AbortSignal`. UI повинен показувати поточний stage та мати кнопку Cancel.

### 8.2. Candidate issue set

Для Daily/Weekly candidate set містить усі доступні board issues, що повернулися з board endpoint з відповідним JQL narrowing за датою, плюс issues поточного board state, потрібні для summary.

Для Sprint Report candidate set є union:

- current sprint issues;
- board issues з `updated >= sprint.startDate`;
- issues, виявлені у sprint membership changelog під час pagination.

Такий union потрібен для пошуку задач, видалених зі sprint після старту. Якщо Jira permission, board filter або server API не дозволяє відновити повний historical membership, звіт повинен мати warning `SPRINT_SCOPE_HISTORY_PARTIAL`; silent omission заборонено.

### 8.3. Pagination та ліміти

- усі collections завантажуються до `isLast`, `total` або відсутності next token;
- повторений cursor/token є `INVALID_RESPONSE`;
- issue IDs дедуплікуються;
- reporting issue limit використовує наявний `MAX_CONFIGURABLE_ISSUES = 5_000`;
- перевищення ліміту створює partial report з `truncated = true` і видимим попередженням;
- changelog Cloud batches містять не більше 1000 issues;
- транспортний ліміт у чотири паралельні Jira requests зберігається;
- retry policy 429/5xx зберігається; generation-level retry не дублює transport retry.

### 8.4. Cache

Під час однієї generation session однакові pages не завантажуються повторно. Допускається in-memory cache до 5 хвилин за ключем:

```text
baseUrl + boardId + sprintId? + period + fieldMapping + pageCursor
```

Створення нового immutable snapshot повинно фіксувати, чи були джерела отримані з cache. Кнопка Refresh/Regenerate обходить cache.

## 9. Правила подій

### 9.1. Created

`issue-created` створюється, якщо `issue.createdAt` входить у `[start, dataCutoff)`.

### 9.2. Status та completion

- кожен status changelog item створює `status-changed`;
- перехід зі статусу поза `completedStatusIds` у mapped completed status створює `issue-completed`;
- перехід з mapped completed status у не-completed створює `issue-reopened`;
- поточний completion state визначається поточним status ID issue;
- exact status name використовується лише як fallback, якщо Jira response не містить ID.

### 9.3. Assignee

Кожна зміна assignee створює `assignee-changed`. Task ownership у готовому snapshot визначається поточним assignee на `dataCutoff`, наскільки це можливо відновити з current state і changelog.

### 9.4. Estimate та Story Points

Зміна mapped Story Points field створює `story-points-changed`. Зміна Original Estimate створює `original-estimate-changed`. Значення нормалізуються у number і seconds відповідно; malformed значення створює completeness warning та не потрапляє в арифметику.

### 9.5. Sprint membership

Sprint changelog item нормалізується як множина sprint IDs до і після зміни:

```text
addedIds   = after - before
removedIds = before - after
```

Для цільового sprint ID:

- присутність в `addedIds` після `sprint.startDate` створює `sprint-added`;
- присутність в `removedIds` після `sprint.startDate` створює `sprint-removed`;
- issue, створена після sprint start вже з цільовим Sprint, вважається added after start навіть за відсутності окремого changelog item;
- issue може бути одночасно у секціях Added і Removed, якщо її додавали, видаляли або повертали кілька разів;
- UI показує timestamp кожної membership події та поточний membership state.

## 10. Метрики

Усі розрахунки використовують повну precision. UI/PDF округлює percentage до одного десяткового знака. Якщо denominator дорівнює нулю, результат — `null`/`N/A`, а не `0%`.

### 10.1. Completion by issue count

```text
completedIssueCount / totalIssueCount * 100
```

- denominator: усі current sprint issues у report scope;
- numerator: current issues у mapped completed status;
- unestimated issues включаються, тому що цей режим не використовує estimates.

### 10.2. Completion by Story Points

```text
sum(storyPoints of completed estimated issues)
------------------------------------------------ * 100
sum(storyPoints of all estimated issues)
```

Окремо показати:

- кількість issues без Story Points;
- кількість completed issues без Story Points;
- кількість incomplete issues без Story Points.

Не дозволено додавати умовну одиницю до суми Story Points.

### 10.3. Completion by Original Estimate

```text
sum(originalEstimateSeconds of completed estimated issues)
---------------------------------------------------------------- * 100
sum(originalEstimateSeconds of all estimated issues)
```

Окремо показати кількість completed/incomplete issues без Original Estimate. Issues з `originalEstimateSeconds <= 0` вважаються неоціненими.

### 10.4. Time utilization

```text
sum(timeSpentSeconds) / sum(originalEstimateSeconds) * 100
```

- це окрема метрика, не sprint completion;
- значення не cap-иться на 100%;
- issues без positive Original Estimate виключаються з denominator і показуються окремо;
- cumulative `Time Spent` і Worklog за report period показуються як різні значення.

### 10.5. Worklog period total

```text
sum(worklog.timeSpentSeconds where startedAt in [start, dataCutoff))
```

Worklog агрегується:

- для Executive Summary — по всіх доступних authors;
- для user block — за author ID;
- для individual scope — лише за selected author, але task section залишається прив'язаною до selected assignee.

### 10.6. Daily та Weekly

Daily/Weekly не показують sprint completion percentage. Вони показують:

- current issue counts by status;
- created/completed/reopened counts за period;
- status, assignee, estimate, Story Points і Sprint changes;
- Worklog period total;
- cumulative Time Spent current state;
- Unassigned issues.

## 11. Report result structure

```ts
interface ReportResult {
  executiveSummary: ExecutiveSummary;
  people: PersonReportBlock[];
  unassigned: UnassignedReportBlock;
  activity: ReportChangeEvent[];
  sprint?: SprintReportResult;
}

interface PersonReportBlock {
  user: NormalizedReportUser;
  assignedIssues: ReportingIssueSnapshot[];
  createdIssues: string[];
  completedIssues: string[];
  reopenedIssues: string[];
  changes: ReportChangeEvent[];
  authoredWorklogs: ReportWorklog[];
  worklogSeconds: number;
}

interface SprintReportResult {
  progressMode: SprintProgressMode;
  completion: PercentageMetric;
  timeUtilization: PercentageMetric;
  addedAfterStart: SprintScopeChange[];
  removedAfterStart: SprintScopeChange[];
  unestimated: UnestimatedBreakdown;
}
```

Person blocks будуються для всіх assignees у scope. Автор Worklog, який не є поточним assignee жодної задачі, також отримує contributor block, щоб Worklog не втрачав attribution. Такий блок має порожній `assignedIssues`.

## 12. UI вимоги

### 12.1. Навігація

У top navigation додати пункт `Reports`. Він доступний після визначення Jira context; generation actions активні лише після authentication.

### 12.2. Report builder

Builder містить:

- Report type: Daily / Weekly / Sprint;
- Jira Board selector;
- Sprint selector лише для Sprint Report;
- Scope: Team / Assignee;
- Assignee selector для individual scope;
- Daily date або Weekly week selector;
- Sprint progress mode toggle;
- Output language: English / Українська;
- кнопку Generate report.

Board і Sprint з поточного `JiraPageContext.boardId/sprintId` попередньо вибираються, якщо доступні поточному користувачу.

### 12.3. Status mapping

При першому використанні борду відкрити mapping panel зі списком точних Jira statuses. Користувач позначає всі statuses, які вважаються completed.

Board column configuration може запропонувати statuses останньої колонки як initial suggestion, але користувач повинен підтвердити mapping. Mapping зберігається локально.

Якщо status з mapping більше не існує, generation блокується до оновлення mapping.

### 12.4. Report screen

Екран містить:

1. report metadata та completeness warnings;
2. Executive Summary;
3. Sprint metrics для Sprint Report;
4. Added after start;
5. Removed after start;
6. окремі person blocks;
7. Unassigned block;
8. activity list;
9. actions: Download PDF, Copy stand-up text, Regenerate, Delete snapshot.

Daily/Weekly screen не рендерить Sprint progress controls або percentage.

### 12.5. Loading та errors

Generation UI показує stages:

```text
Loading board -> Loading issues -> Loading changes -> Loading worklogs
-> Calculating -> Saving snapshot -> Ready
```

Під час loading доступна кнопка Cancel. Partial data не показується як готовий повний report.

### 12.6. History

History screen дозволяє:

- сортувати snapshots за `generatedAt` descending;
- фільтрувати за Jira instance, board, report type і sprint;
- відкрити snapshot без Jira network request;
- повторно створити PDF або stand-up text;
- вручну видалити snapshot після confirmation.

Regenerate створює новий snapshot і не змінює попередній.

## 13. Stand-up text

Text renderer є deterministic pure function:

```ts
renderStandupText(snapshot, language): string
```

Порядок:

1. title, board, period і data cutoff;
2. Executive Summary;
3. Sprint progress/scope changes, якщо applicable;
4. person blocks у стабільному alphabetical order;
5. Unassigned;
6. completeness warnings.

Issue key у text output має бути придатним для копіювання. Jira summary і власні назви статусів не перекладаються. Локалізуються лише labels, fixed phrases, dates, durations і metric names.

## 14. PDF

PDF renderer приймає лише immutable snapshot і locale:

```ts
renderReportPdf(snapshot, language): Promise<Blob>
```

Вимоги:

- PDF формується локально без зовнішніх HTTP-запитів;
- формат сторінки A4;
- embedded font повинен підтримувати Latin і Cyrillic;
- повторюваний header містить report type, board і period;
- footer містить page number і generated timestamp;
- довгі таблиці коректно переходять на наступну сторінку;
- issue key може бути clickable Jira link;
- відсутні дані відображаються як `N/A`, а не як нуль;
- completeness warnings входять до PDF;
- Blob не зберігається в history;
- object URL revoke-иться після download.

Рекомендоване ім'я файлу:

```text
power-view-{reportType}-{boardSlug}-{periodStart}-{language}.pdf
```

## 15. Локалізація

Додати reporting dictionaries:

```text
apps/web/src/app/reporting/i18n/en.ts
apps/web/src/app/reporting/i18n/uk.ts
```

Locale впливає на:

- fixed UI/output labels;
- stand-up text;
- PDF labels;
- date/time formatting;
- number і duration formatting.

Locale не змінює:

- Jira issue summary;
- user display name;
- board/sprint/status names;
- Jira URL.

## 16. Local storage

### 16.1. Board settings

Невеликі board mappings зберігати в `chrome.storage.local` через окремий `ReportSettingsStore`:

```text
reporting-settings:v1
```

Ключ конфігурації:

```text
encodeURIComponent(normalizedBaseUrl) + ":" + boardId
```

Не додавати великі snapshots до наявного `settings:v2` object, щоб кожна зміна історії не переписувала всі Gantt settings.

### 16.2. Snapshot history

Snapshots зберігати в IndexedDB:

```text
database: power-view-reporting
version: 1
objectStore: reportSnapshots
keyPath: id
```

Indexes:

- `generatedAt`;
- `[jira.baseUrl, request.boardId]`;
- `request.type`;
- `request.sprintId`;
- `[request.boardId, generatedAt]`.

Операції:

```ts
interface ReportHistoryStore {
  save(snapshot: GeneratedReportSnapshot): Promise<void>;
  get(id: string): Promise<GeneratedReportSnapshot | undefined>;
  list(filter?: ReportHistoryFilter): Promise<ReportHistoryItem[]>;
  delete(id: string): Promise<void>;
}
```

`save` виконується однією transaction. Existing ID не overwrite-иться.

### 16.3. Quota

- автоматичне видалення заборонено;
- перед save перевіряти доступну quota через browser storage estimate, якщо API доступний;
- при quota error готовий report лишається доступним у поточній session, але UI явно повідомляє, що history save не відбувся;
- користувачу пропонується вручну видалити snapshots;
- PDF Blob та дубльований stand-up text не зберігаються.

## 17. Completeness model

```ts
type ReportWarningCode =
  | "ISSUES_TRUNCATED"
  | "CHANGELOG_UNAVAILABLE"
  | "WORKLOG_UNAVAILABLE"
  | "SPRINT_SCOPE_HISTORY_PARTIAL"
  | "STORY_POINTS_FIELD_UNAVAILABLE"
  | "TIME_TRACKING_UNAVAILABLE"
  | "STATUS_MAPPING_STALE"
  | "MALFORMED_JIRA_VALUE";

interface ReportCompleteness {
  complete: boolean;
  issueCount: number;
  truncated: boolean;
  warnings: Array<{
    code: ReportWarningCode;
    message: string;
    affectedIssueKeys?: string[];
  }>;
}
```

Unavailable/partial metric не може відображатися як `0`. Screen, PDF і text повинні однаково показувати warning.

## 18. Error handling

Додати reporting-specific `AppErrorCode`:

```ts
| "BOARD_NOT_FOUND"
| "SPRINT_NOT_FOUND"
| "STATUS_MAPPING_REQUIRED"
| "STATUS_MAPPING_STALE"
| "REPORT_GENERATION_CANCELLED"
| "REPORT_STORAGE_QUOTA_EXCEEDED"
| "PDF_GENERATION_FAILED"
```

Правила:

- `401` — попросити відкрити Jira і повторно автентифікуватися;
- `403` — показати, який dataset недоступний; не підміняти нулем;
- `404` board/sprint — очистити stale selection;
- `429` — використати наявну bounded retry policy;
- `5xx`/timeout — дозволити retry generation;
- malformed response — відхилити відповідну page через Zod;
- failure PDF renderer не видаляє snapshot;
- failure history save не втрачає поточний in-memory result.

## 19. Security та privacy

1. Усі Jira requests проходять exact-origin, exact-route і query/body allowlist у service worker.
2. Credentials використовуються лише для active Jira origin.
3. Reporting endpoints є read-only. Bulk changelog POST класифікується як read-only exact operation.
4. Не запитуються descriptions, comments, attachments або Worklog comments.
5. У snapshot зберігаються issue key, summary, status, assignee, timestamps, estimates, Worklog author/duration та агрегати.
6. Jira text перед UI/PDF rendering розглядається як untrusted input і не інтерпретується як HTML.
7. Немає remote analytics payload з issue/user data.
8. Diagnostics можуть містити лише endpoint category, counts, duration, retry/error code; issue keys, summaries, user names і Worklog не потрапляють у diagnostics.
9. Видалення snapshot є незворотним і потребує confirmation.
10. Не додавати `unlimitedStorage` permission без окремого продуктового рішення.

## 20. Diagnostics

Розширити `RequestDiagnostic.endpoint`:

```ts
| "boards"
| "board-configuration"
| "sprints"
| "sprint-issues"
| "changelog"
| "worklogs"
```

Додати sanitized generation diagnostic:

```ts
interface ReportGenerationDiagnostic {
  reportType: ReportType;
  issueCount: number;
  changeCount: number;
  worklogCount: number;
  durationMs: number;
  complete: boolean;
  warningCodes: ReportWarningCode[];
}
```

Не включати board name, sprint name, issue keys або person names.

## 21. Test strategy

### 21.1. Domain unit tests

Обов'язкові cases:

- Daily `[08:00, 08:00)` boundaries;
- Weekly Monday 08:00 boundaries;
- `dataCutoff` для поточного тижня;
- Kyiv DST spring/fall transitions;
- issue-count completion;
- Story Points completion;
- Original Estimate completion;
- denominator zero -> `N/A`;
- неоцінені issues окремо від weighted denominator;
- Time utilization більше 100%;
- current status `Done`/`In Review` через mapping;
- completed -> reopened transitions;
- Sprint added/removed/re-added sequences;
- Worklog boundary timestamps;
- Worklog attribution by author;
- Unassigned block;
- deterministic ordering;
- snapshot serialization round trip.

### 21.2. Jira client tests

- Cloud token pagination для board/sprint issues;
- Data Center offset pagination;
- board/sprint schema validation;
- Cloud bulk changelog batching та next token;
- per-issue changelog fallback;
- Worklog pagination;
- cancellation;
- deduplication;
- malformed numeric estimates;
- missing permission response.

### 21.3. Request policy tests

- дозволені exact reporting routes;
- відхилення non-numeric board/sprint IDs;
- відхилення traversal, encoded slash і cross-origin URL;
- незалежні query allowlists;
- strict bulk changelog body;
- batch понад 1000 issues відхиляється;
- довільний POST під `/rest/api/3/` відхиляється;
- reporting routes не розширюють mutation allowlist.

### 21.4. Storage tests

- save/get/list/delete snapshot;
- immutable ID collision;
- indexes та sorting;
- corrupted snapshot rejection;
- quota failure;
- manual delete;
- board mapping isolation за base URL + board ID.

### 21.5. React component tests

- builder field visibility за report type;
- Sprint disabled для non-Scrum board;
- mapping required/stale state;
- progress mode toggle;
- loading stage та cancel;
- partial warnings;
- person та Unassigned blocks;
- history reopen без network call;
- EN/UA output switch;
- PDF/text actions.

### 21.6. E2E

Fixture Jira transport повинен мати:

- щонайменше два boards;
- active і closed sprint;
- `Done`, `In Review` та incomplete statuses;
- assigned/unassigned issues;
- estimated/unestimated issues;
- added/removed/re-added sprint issues;
- Worklog від assignee і стороннього contributor;
- changelog pagination;
- partial permission scenario.

E2E flow:

1. authenticate fixture Jira;
2. відкрити Reports;
3. вибрати board;
4. зберегти status mapping;
5. згенерувати Sprint Report;
6. перевірити metrics і scope changes;
7. скопіювати stand-up text;
8. згенерувати PDF;
9. перезавантажити extension page;
10. відкрити snapshot з history без Jira request;
11. видалити snapshot.

## 22. Acceptance criteria

### AC-01: Daily period

Daily report включає події з 08:00 попереднього дня включно до 08:00 звітної дати невключно у `Europe/Kyiv`.

### AC-02: Weekly period

Weekly report має межі понеділок 08:00 — наступний понеділок 08:00 у `Europe/Kyiv` і коректно працює через DST.

### AC-03: Board mapping

Новий board вимагає одноразового локального status mapping. Повторна generation використовує збережений mapping.

### AC-04: Team report

Team report має окремий блок для кожного виконавця, contributor Worklog attribution та `Unassigned`.

### AC-05: Sprint modes

Користувач перемикає issue count, Story Points та Original Estimate без повторного Jira fetch; усі три результати обчислюються з одного snapshot source model.

### AC-06: Unestimated issues

Неоцінені issues не входять до weighted percentage та показуються окремими completed/incomplete counts.

### AC-07: Time utilization

Time utilization показується окремо від completion і може бути понад 100%.

### AC-08: Scope changes

Sprint Report має окремі списки Added after start і Removed after start, включно з issue key та timestamp. Re-added issue може бути в обох списках.

### AC-09: Worklog

Worklog period total використовує `startedAt` і атрибутується автору запису. Cumulative Time Spent показується окремо.

### AC-10: Immutable history

Після зміни Jira даних відкритий з history snapshot не змінюється. Regenerate створює новий ID.

### AC-11: Local-only

Mapping і history зберігаються лише локально; модуль не потребує backend.

### AC-12: Manual retention

Snapshot видаляється лише явною дією користувача. Автоматичне очищення відсутнє.

### AC-13: Output language

Один snapshot може створити EN або UA stand-up text та PDF без повторного Jira fetch.

### AC-14: PDF

PDF містить Executive Summary, person blocks, Unassigned, Sprint sections за потреби, warnings, page numbers і коректний Cyrillic text.

### AC-15: Partial data

Недоступні або truncated дані ніколи не відображаються як повні або як нульові. Screen, PDF і text містять однакове попередження.

### AC-16: Transport security

Усі нові Jira paths проходять exact allowlist tests; довільні Agile/Software/POST routes залишаються заблокованими.

## 23. Послідовність реалізації

### Phase 1: Domain та security boundary

- reporting domain types;
- period/calculation/scope pure functions;
- transport schema;
- exact Jira request allowlist;
- policy tests.

### Phase 2: Jira adapters

- boards/configuration/sprints;
- Cloud/Data Center issue pagination;
- changelog;
- Worklog;
- normalized schemas/mappers;
- completeness tracking.

### Phase 3: Configuration та report UI

- shared Jira session;
- Reports navigation;
- builder;
- local status mapping;
- generation pipeline;
- report screen.

### Phase 4: History та exports

- IndexedDB history;
- stand-up renderer EN/UA;
- PDF renderer;
- manual deletion;
- quota handling.

### Phase 5: Hardening

- component/E2E tests;
- accessibility;
- performance profiling;
- Data Center capability matrix;
- security review;
- release documentation.

## 24. Офіційні API джерела

- [Jira Software Cloud REST API — Board](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)
- [Jira Software Cloud REST API — Sprint](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/)
- [Jira Cloud Platform REST API — Issues and changelog](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [Jira Cloud Platform REST API — Issue worklogs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/)
- [Jira Agile Server/Data Center 9.4 REST API](https://docs.atlassian.com/jira-software/REST/9.4.0/)
