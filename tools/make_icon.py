"""生成客户端图标（PNG 512 / ICO 多尺寸），纯 PIL 绘制，无外部素材。"""
import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(OUT_DIR, exist_ok=True)

S = 512
BG = (11, 15, 20)
GLOW = (34, 211, 238)
RED = (255, 77, 79)
GREEN = (14, 203, 129)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角深色底
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=110, fill=BG + (255,))

# 顶部微光：用「背景色→青色」的实色混合，避免 alpha 覆盖导致发白
for y in range(int(S * 0.62)):
    t = (1 - y / (S * 0.62)) ** 1.6 * 0.22
    c = tuple(int(BG[i] + (GLOW[i] - BG[i]) * t) for i in range(3))
    d.line([(0, y), (S, y)], fill=c + (255,))

# 圆角描边
d.rounded_rectangle([6, 6, S - 7, S - 7], radius=104, outline=GLOW + (90,), width=4)

# ---- K 线（逐根走高，红绿交替）----
bars = [
    # cx, hi, lo, top, bot, color
    (150, 268, 408, 296, 376, RED),
    (222, 232, 388, 260, 348, GREEN),
    (294, 196, 356, 224, 312, RED),
    (366, 158, 318, 186, 276, GREEN),
]
BW = 38
for cx, hi, lo, top, bot, color in bars:
    d.line([(cx, hi), (cx, top)], fill=color, width=8)
    d.line([(cx, bot), (cx, lo)], fill=color, width=8)
    d.rounded_rectangle([cx - BW // 2, top, cx + BW // 2, bot], radius=7, fill=color)

# ---- 底部基线 ----
d.line([(90, 432), (422, 432)], fill=(45, 61, 82, 255), width=5)

# ---- 右上抬头箭头（趋势）----
arrow = [(398, 296), (424, 262), (438, 214)]
for i in range(len(arrow) - 1):
    d.line([arrow[i], arrow[i + 1]], fill=GLOW + (255,), width=13)
d.polygon([(452, 196), (424, 202), (444, 226)], fill=GLOW + (255,))

png_path = os.path.join(OUT_DIR, "icon.png")
img.save(png_path, "PNG")

ico_path = os.path.join(OUT_DIR, "icon.ico")
img.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

tray = img.resize((64, 64), Image.LANCZOS)
tray.save(os.path.join(OUT_DIR, "tray.png"), "PNG")

print("OK", png_path, os.path.getsize(png_path))
print("OK", ico_path, os.path.getsize(ico_path))
