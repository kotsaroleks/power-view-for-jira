# Shared Day Off — перевірка 2026-11-02

Фінальна production-збірка web/extension перевірена у встановленому Chrome через
Playwright (`channel: chrome`). Результат: **2/2 браузерні тести пройшли** (11,3 с).

- `e2e/timesheet-production.spec.ts`: підключення тестового Google-акаунта, позначення
  дати, блокування вводу в її комірки, збереження після reload, скасування позначення.
  Зміна Day Off не створює, не змінює та не видаляє Jira-worklog. Також пройшли перевірки
  табеля: верх таблиці <300 px, п'ять рядків при 1280×800, inline-введення, ієрархія,
  пріоритетний Epic та створення/редагування/видалення конкретних тестових worklog.
- `e2e/time-report-production.spec.ts`: спільний календар показує конфлікт `Day Off · 3h`,
  зберігає наявні години, дає 32h очікуваних годин працівника та 72h для тестової команди.
  Перевірено попередження `Complete Day Off data is unavailable` до підключення календаря.

Обидва тести використовують ізольовані Jira, Google OAuth і Google Sheets fixtures. Жодних
запитів до реального акаунта чи спільної таблиці під час цих запусків немає. Ці результати
**не підтверджують налаштування або роботу реального Google OAuth**.

## Скріншоти production UI

- [Timesheet: Day Off позначено, колонка заблокована](timesheet-shared-day-off.png).
- [Time Report: Day Off зі збереженими годинами та перерахованою нормою](time-report-shared-day-off.png).

Скріншоти знято з реального рендерингу production UI у Chrome; дані мають позначку
`TEST DATA`.

## Jira team roster sync

The explicit Sync Jira team scenario passed in Chrome with isolated test data: exact
stable Jira IDs, one RAW roster write, no worklog search or Day Off mutations, preserved
existing hours. [Team sync screenshot](time-report-team-sync.png).

Separate live setup synced14 Aria Team members to the shared Sheet. Only the user's
confirmed cross-domain Google/Jira mapping was approved;13 remain unmapped. Both annual
Day Off input ranges were verified work-account-only, personal Gmail removed.
