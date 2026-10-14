#!/usr/bin/env python3
"""Generates build/icon.svg (hand-authored geometry; squircle + droplet-bubble + gloss)."""
import math, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE, NAVY, DOT = '#FFFFFD', '#386594', '#A9C6CC'
def squircle(x0=100, s=824, n=5, k=180):
  c = x0 + s / 2; r = s / 2; pts = []
  for i in range(k):
    t = 2 * math.pi * i / k; ct, st = math.cos(t), math.sin(t)
    pts.append((c + r * math.copysign(abs(ct) ** (2 / n), ct), c + r * math.copysign(abs(st) ** (2 / n), st)))
  return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'
cx, cy, R = 512, 596, 212
def P(a): return f'{cx + R * math.cos(math.radians(a)):.1f} {cy + R * math.sin(math.radians(a)):.1f}'
DROP = (f'M512 248 C 552 248, 618 372, 660 420 C 702 468, {cx+R} 530, {cx+R} {cy} '
        f'A {R} {R} 0 0 1 {P(112)} '
        f'C 408 812, 368 832, 334 834 C 318 835, 314 822, 324 812 C 340 796, 350 774, {P(146)} '
        f'A {R} {R} 0 0 1 {cx-R} {cy} C {cx-R} 530, 322 468, 364 420 C 406 372, 472 248, 512 248 Z')
def wave(y, amp=9, x0=270, x1=754, n=3.5):
  steps = 120; pts = [(x0 + (x1 - x0) * i / steps, y + amp * math.sin(2 * math.pi * n * i / steps)) for i in range(steps + 1)]
  return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="drop"><path d="{DROP}"/></clipPath>
    <linearGradient id="body" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#5584B5"/><stop offset="0.55" stop-color="{NAVY}"/><stop offset="1" stop-color="#2A5282"/></linearGradient>
    <radialGradient id="hl" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="0.6" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="inner" cx="512" cy="560" r="300" gradientUnits="userSpaceOnUse"><stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/></radialGradient>
    <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2A5282" stop-opacity="0.12"/><stop offset="1" stop-color="#132A49" stop-opacity="0"/></radialGradient>
  </defs>
  <path d="{squircle()}" fill="{TILE}"/>
  <g transform="translate(0 -12)">
  <ellipse cx="520" cy="838" rx="220" ry="34" fill="url(#shadow)"/>
  <path d="{DROP}" fill="url(#body)"/>
  <g clip-path="url(#drop)">
    <rect x="250" y="200" width="540" height="680" fill="url(#inner)"/>
    <g fill="none" stroke="{TILE}" stroke-width="15" stroke-linecap="round">
      <path d="{wave(604)}"/><path d="{wave(664)}"/>
    </g>
    <ellipse cx="420" cy="440" rx="44" ry="92" transform="rotate(32 420 440)" fill="url(#hl)"/>
  </g>
  <circle cx="598" cy="478" r="15" fill="{DOT}" opacity="0.75"/>
  </g>
</svg>
'''
open(os.path.join(root, 'build/icon.svg'), 'w').write(svg)
