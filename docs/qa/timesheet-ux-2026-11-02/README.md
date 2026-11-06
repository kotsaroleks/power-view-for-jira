# Timesheet UX — візуальна перевірка 2026-11-02

Production-збірка, встановлений Google Chrome, mocked Jira; це тестові дані.

- `timesheet-agreed-groups-1440.png`: pin → власний час → assigned → інші задачі.
- `timesheet-agreed-groups-1280.png`: viewport 1280×800; тест перевіряє п’ять повністю
  видимих рядків задач.
- `timesheet-agreed-hierarchy.png`: розгорнута ієрархія Epic → Story → Subtask.
- `timesheet-inline-saved.png`: 1,5 години введено прямо в таблиці та збережено як 5400
  секунд.
- `timesheet-log-time.png`: вбудована форма конкретної задачі перед таблицею, без popup.
- `timesheet-inline-entry.png`: введення 1,5 прямо в комірці основної таблиці; жодної
  форми або dialog.
- `timesheet-zoom-200.png`: CSS zoom 200%; глобальна навігація виходить за ширину
  viewport. Це симуляція, не нативний browser zoom.

Браузерний сценарій `e2e/timesheet-production.spec.ts` пройшов. 58 тестів табеля пройшли в
незалежному запуску GPT-6 Astra; 48 тестів адаптера й перевірок запитів також пройшли.
Web/extension typecheck, root typecheck і targeted lint пройшли.

Реальний Jira instance, оновлення розширення в особистому профілі користувача та великі
production-борди цією перевіркою не охоплені.

Додатковий пріоритет користувача: `timesheet-priority.png` показує LBR-68393 після pin та
власного часу, перед рештою assigned/other. Це production UI з TEST DATA, не live Jira.
Оновлено стиль таблиці, кнопок, pin та заголовків груп.
