"""Generate synthetic chat-app screenshots per app theme (our own generic layout,
approximating each app's colors only; no real app UI assets).
Layout 900x700: sidebar x<250 (conversation list + unread badge), title bar y<50,
messages: left = other, right = self."""
from PIL import Image, ImageDraw, ImageFont
import glob, json, os
ROOT = os.path.join(os.path.dirname(__file__), '..', 'fixtures')
f = [p for p in glob.glob('/usr/share/fonts/**/*.tt*', recursive=True) if 'CJK' in p or 'Noto' in p or 'wqy' in p.lower()]
font = ImageFont.truetype(f[0], 18) if f else ImageFont.load_default()
THEMES = {
  'wechat':   dict(bg=(245,245,245), side=(230,230,230), sel=(200,200,200), badge=(250,81,81),  other=(255,255,255), self=(149,236,105)),
  'telegram': dict(bg=(219,232,240), side=(255,255,255), sel=(64,138,214),  badge=(51,144,236), other=(255,255,255), self=(239,253,222)),
  'whatsapp': dict(bg=(239,234,226), side=(255,255,255), sel=(240,242,245), badge=(37,211,102), other=(255,255,255), self=(217,253,211)),
}
def draw(app, name, title, msgs, unread_rows=(), selected=0, contacts=('张三', '李四', '王五', '赵六')):
    T = THEMES[app]; img = Image.new('RGB', (900, 700), T['bg']); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 249, 699], fill=T['side'])
    for i, c in enumerate(contacts):
        y = 20 + i * 70
        if i == selected: d.rectangle([0, y - 10, 249, y + 50], fill=T['sel'])
        d.text((20, y + 8), c, fill=0, font=font)
        if i in unread_rows: d.ellipse([210, y + 2, 230, y + 22], fill=T['badge'])
    d.rectangle([250, 0, 899, 49], fill=(250, 250, 250)); d.text((280, 14), title, fill=0, font=font)
    y = 70
    for side, t in msgs:
        w = len(t) * 19 + 30; x = 290 if side == 0 else 900 - 40 - w
        d.rectangle([x, y, x + w, y + 40], fill=T['other'] if side == 0 else T['self'])
        d.text((x + 15, y + 10), t, fill=0, font=font); y += 80
    os.makedirs(os.path.join(ROOT, app), exist_ok=True); img.save(os.path.join(ROOT, app, name))
conv = [(0, '你好，请问这个产品还有货吗？'), (1, '有的，今天下单明天发货')]
lisi = [(0, '在吗？明天几点开会'), (0, '我这边下午有空')]
for app in THEMES:
    draw(app, 'idle.png', '张三', conv)
    draw(app, 'unread_sidebar.png', '张三', conv, unread_rows=(1,))
    draw(app, 'two_unread.png', '张三', conv, unread_rows=(1, 3))
    draw(app, 'opened_lisi.png', '李四', lisi, selected=1)
    draw(app, 'after_send_lisi.png', '李四', lisi + [(1, '下午三点可以')], selected=1)
print('ok')
