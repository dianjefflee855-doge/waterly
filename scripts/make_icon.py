#!/usr/bin/env python3
"""make_icon.py -> renders build/icon.svg to build/icon.png (1024), build/icon.iconset/*, build/icon.icns.
Needs: pip install cairosvg icnsutil (iconutil used instead when on macOS)."""
import os, shutil, subprocess, io
import cairosvg
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); b = os.path.join(root, 'build')
svg = os.path.join(b, 'icon.svg')
from PIL import Image
src_png = os.path.join(b, 'icon_src.png')
if os.path.exists(src_png):
  _im = Image.open(src_png).convert('RGBA')
  def render(n):
    o = io.BytesIO(); _im.resize((n, n), Image.LANCZOS).save(o, 'PNG'); return o.getvalue()
else:
  subprocess.check_call(['python3', os.path.join(root, 'scripts/icon_svg.py')])
  def render(n): return cairosvg.svg2png(url=svg, output_width=n, output_height=n)
open(os.path.join(b, 'icon.png'), 'wb').write(render(1024))
iset = os.path.join(b, 'icon.iconset'); shutil.rmtree(iset, ignore_errors=True); os.makedirs(iset)
for n in [16, 32, 128, 256, 512]:
  open(f'{iset}/icon_{n}x{n}.png', 'wb').write(render(n)); open(f'{iset}/icon_{n}x{n}@2x.png', 'wb').write(render(n * 2))
icns = os.path.join(b, 'icon.icns')
if shutil.which('iconutil'): subprocess.check_call(['iconutil', '-c', 'icns', iset, '-o', icns])
else:
  import icnsutil
  f = icnsutil.IcnsFile()
  for k, n in [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024),
               ('ic11', 32), ('ic12', 64), ('ic13', 256), ('ic14', 512)]:
    f.add_media(k, data=render(n))
  f.write(icns)
print('icon ->', icns)
