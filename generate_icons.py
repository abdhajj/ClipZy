from PIL import Image, ImageDraw

INK = (18, 32, 31, 255)
PAPER = (250, 246, 236, 255)
AMBER = (226, 163, 61, 255)
TEAL = (63, 139, 124, 255)

def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = round(size * 0.08)
    radius = round(size * 0.22)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=INK)

    # paper card, slightly rotated feel via offset rectangle
    card_pad = round(size * 0.24)
    card_top = round(size * 0.20)
    card_bottom = round(size * 0.82)
    d.rounded_rectangle(
        [card_pad, card_top, size - card_pad, card_bottom],
        radius=round(size * 0.06),
        fill=PAPER,
    )

    # teal top bar on the card
    bar_h = max(2, round(size * 0.045))
    d.rounded_rectangle(
        [card_pad, card_top, size - card_pad, card_top + bar_h],
        radius=round(size * 0.02),
        fill=TEAL,
    )

    # text lines on card
    line_h = max(1, round(size * 0.035))
    line_gap = round(size * 0.11)
    line_x1 = card_pad + round(size * 0.06)
    for i, widen in enumerate([0.78, 0.6, 0.68]):
        y = card_top + round(size * 0.20) + i * line_gap
        x2 = card_pad + round((size - 2 * card_pad) * widen)
        d.rounded_rectangle([line_x1, y, x2, y + line_h], radius=line_h // 2, fill=(200, 193, 168, 255))

    # amber pin/tab in the corner
    pin_r = round(size * 0.13)
    pin_cx = size - card_pad - round(size * 0.02)
    pin_cy = card_top + round(size * 0.02)
    d.ellipse(
        [pin_cx - pin_r, pin_cy - pin_r, pin_cx + pin_r, pin_cy + pin_r],
        fill=AMBER,
    )

    return img

for size in (16, 48, 128):
    icon = make_icon(size)
    icon.save(f"icons/icon{size}.png")

print("done")
