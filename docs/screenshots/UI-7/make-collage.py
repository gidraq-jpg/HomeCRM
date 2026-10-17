"""Собирает контактные листы из неизменённых Linux-снимков (нужен Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
SCREENS = [
    ("new-task", "Новое дело"), ("new-note", "Новая заметка"),
    ("new-object", "Новый объект"), ("new-document", "Новый документ"),
    ("new-person", "Новый человек"), ("new-organization", "Новая организация"),
    ("new-template", "Из шаблона"), ("task", "Факты дела"),
    ("edit-task", "Правка дела"), ("edit-note", "Правка заметки"),
    ("edit-object", "Правка объекта"), ("edit-document", "Правка документа"),
    ("edit-person", "Правка человека"), ("edit-organization", "Правка организации"),
]

def font(size):
    for path in ["C:/Windows/Fonts/segoeui.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)

def make(comparison):
    cell_width = 400 if comparison else 210
    columns = 4 if comparison else 7
    rows = (len(SCREENS) + columns - 1) // columns
    image = Image.new("RGB", (columns * cell_width + 20, rows * 430 + 70), "#ebe5da")
    draw = ImageDraw.Draw(image)
    draw.text((20, 16), "UI-7 · 360 px · до / после" if comparison else "UI-7 · 360 px · текст 200%", fill="#22201c", font=font(24))
    for index, (name, title) in enumerate(SCREENS):
        x, y = 20 + index % columns * cell_width, 65 + index // columns * 430
        draw.text((x, y), title, fill="#22201c", font=font(17))
        phases = [("before", 100), ("after", 100)] if comparison else [("after", 200)]
        for offset, (phase, percent) in enumerate(phases):
            screen = Image.open(ROOT / phase / f"{name}-{percent}.png").convert("RGB")
            screen.thumbnail((180, 370), Image.Resampling.LANCZOS)
            sx = x + offset * 190
            if comparison:
                draw.text((sx, y + 24), "До" if phase == "before" else "После", fill="#6b6358", font=font(14))
            image.paste(screen, (sx, y + 48))
    image.save(ROOT / ("before-after-collage.png" if comparison else "after-collage-200.png"))

make(True)
make(False)
