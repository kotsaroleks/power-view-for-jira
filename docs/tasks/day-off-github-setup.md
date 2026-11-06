# Локальне налаштування GitHub Day Off

Реалізований шлях: `GitHubDayOffStore` → GitHub Contents API, спільний singleton для
Timesheet та Time Report. Google-код, OAuth-конфігурацію та дозвіл identity видалено.
Зовнішню Google-таблицю та її дані не змінено.

Власник заповнює `.secrets/day-off-github.local.json` за шаблоном
`config/day-off-github.example.json`: owner, окремий приватний repo даних, наявна branch,
root (наприклад `powerview`) та fine-grained token з Contents read/write тільки для цього
repo. Файл ігнорується Git. Секрет не надсилати в чат. Альтернатива для збірки: змінна
`POWERVIEW_DAY_OFF_GITHUB_CONFIG` з таким самим JSON. Порожній шаблон означає
неналаштоване сховище. Після заповнення потрібна нова збірка. Учасники надають
Chrome-дозвіл `https://api.github.com/*` один раз, без входу в GitHub.

Ключі instance/account/team кодуються UTF-8 hex; місячні файли створюються автоматично.
Читання використовує ETag, записи — SHA і до трьох спроб merge різних дат. Після невідомої
відповіді PUT виконується читання, а не повтор PUT. 404 файлу вважається порожнім
календарем лише після перевірки гілки. Склад команди зберігається окремо; синхронізація не
видаляє місячні файли.

Налаштовано 2026-11-02: приватний `kotsaroleks/power-view-jira-data`, гілка `main`, корінь
`powerview`. Fine-grained token «PowerView Day Off» має Contents read/write лише для цього
репозиторію та Metadata read-only; діє до 2027-11-02. Секрет записано тільки до
ігнорованого локального конфігу та включено у збірку.

Жива перевірка GitHub API пройшла: приватність репозиторію, доступ до гілки, створення й
читання тестового JSON; тимчасовий файл потім видалено. Справжні Jira календарі під час
перевірки не змінювалися. Тест двох встановлень, перенесення Google-даних і production UI
перевірка Day Off ще не виконані. Контракт API:
https://docs.github.com/en/rest/repos/contents
