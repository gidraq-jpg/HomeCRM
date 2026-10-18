"""Коллаж Linux-снимков D16b; запуск в контейнере описан в runbook, раздел 12."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2] / "test-results/screens/UI-6"
SCREENS = [
    ("more", "Ещё"), ("search-results", "Поиск"), ("profile", "Обо мне"),
    ("security", "Безопасность"), ("export", "Мои данные"), ("member", "Участник"),
    ("invite", "Приглашение"), ("spaces", "Пространства"), ("house", "Настройки дома"),
    ("notifications", "Уведомления"), ("summaries-list", "Сводки"), ("summary", "Сводка"),
    ("deliveries", "Журнал доставки"), ("trash", "Корзина"), ("month-charged", "Коммуналка за месяц"),
    ("charges", "Начисления"), ("charge-form", "Новое начисление"), ("charge-payment", "Оплата"),
    ("start-house", "Первый запуск: дом"), ("start-template", "Шаблоны"), ("start-object", "Первый объект"),
    ("start-invite", "Первый запуск: приглашение"), ("import", "Импорт vCard"), ("import-preview", "Предпросмотр vCard"),
    ("not-found", "Не найдено"), ("open-missing", "Запись недоступна"), ("auth-sign-in", "Вход"),
    ("auth-forgot-password", "Восстановление"), ("record-task", "Карточка: файлы"), ("record-access-share", "Поделиться"),
    ("record-access-audience", "Кто видит"), ("record-transfer", "Передать дело"), ("profile-form", "Правка профиля"),
    ("profile-leave", "Подтверждение ухода"), ("member-role", "Смена роли"), ("invite-issued", "Выданное приглашение"),
]
font = ImageFont.truetype("DejaVuSans.ttf", 18)
for percent in (100, 200):
    width, height, gap, cols = 240, 494, 16, 6
    rows = (len(SCREENS) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * (width + gap) + gap, 64 + rows * (height + 52 + gap)), "#ebe5da")
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 18), f"D16b · Studio 2 · 360 px · текст {percent}% · Linux Chromium", font=font, fill="#22201c")
    for i, (name, label) in enumerate(SCREENS):
        options = [ROOT / "after" / f"service-{name}-w360-{percent}.png", ROOT / "after" / f"service-{name}-{percent}-w360.png"]
        source = next((p for p in options if p.exists()), None)
        if source is None:
            raise FileNotFoundError(name)
        shot = Image.open(source).convert("RGB")
        shot = shot.crop((0, 0, min(720, shot.width), min(1480, shot.height)))
        shot.thumbnail((width, height))
        x = gap + (i % cols) * (width + gap)
        y = 64 + (i // cols) * (height + 52 + gap)
        draw.text((x, y), label, font=font, fill="#22201c")
        canvas.paste(shot, (x, y + 44))
    canvas.save(ROOT / f"service-after-collage-{percent}.png", optimize=True)
