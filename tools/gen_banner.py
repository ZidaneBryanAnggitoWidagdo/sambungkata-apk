#!/usr/bin/env python3
"""Generator banner SVG untuk README — tema 'Papan Huruf' (tile 3D)."""

def tile(x, y, ch, kind, w=84, h=96):
    if kind == "amber":
        top, bot, edge, ink = "#ffd88a", "#f7a928", "#b96f0a", "#3d2600"
    else:
        top, bot, edge, ink = "#8ff0e2", "#2fc4ad", "#157c6d", "#03332b"
    r = 16
    cx = x + w / 2
    cy = y + h / 2 + 1
    return f'''
  <g>
    <rect x="{x}" y="{y+7}" width="{w}" height="{h}" rx="{r}" fill="{edge}"/>
    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="url(#g{kind})"/>
    <rect x="{x+6}" y="{y+5}" width="{w-12}" height="10" rx="5" fill="#ffffff" opacity="0.35"/>
    <text x="{cx}" y="{cy}" font-family="Arial Black, Arial, sans-serif" font-size="50" font-weight="900"
      fill="{ink}" text-anchor="middle" dominant-baseline="central">{ch}</text>
  </g>'''

def row(word, kind, y, W=1200, tw=84, gap=10):
    n = len(word)
    total = n * tw + (n - 1) * gap
    x0 = (W - total) / 2
    return "".join(tile(x0 + i * (tw + gap), y, c, kind, tw) for i, c in enumerate(word))

W, H = 1200, 320
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Sambung Kata">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="120%">
      <stop offset="0%" stop-color="#1c2440"/>
      <stop offset="55%" stop-color="#131829"/>
      <stop offset="100%" stop-color="#0d1120"/>
    </radialGradient>
    <linearGradient id="gamber" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="#ffd88a"/><stop offset="100%" stop-color="#f7a928"/>
    </linearGradient>
    <linearGradient id="gteal" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="#8ff0e2"/><stop offset="100%" stop-color="#2fc4ad"/>
    </linearGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <!-- tile latar mengambang -->
  <g opacity="0.16">
    <rect x="60"  y="40"  width="64" height="72" rx="12" fill="#2c3860"/>
    <rect x="1050" y="210" width="72" height="80" rx="12" fill="#2c3860"/>
    <rect x="150" y="230" width="52" height="60" rx="10" fill="#2c3860"/>
    <rect x="980" y="30" width="56" height="64" rx="10" fill="#2c3860"/>
    <text x="92" y="86" font-family="Arial" font-size="34" font-weight="900" fill="#3d4a75" text-anchor="middle" dominant-baseline="central">Z</text>
    <text x="1086" y="260" font-family="Arial" font-size="38" font-weight="900" fill="#3d4a75" text-anchor="middle" dominant-baseline="central">K</text>
    <text x="176" y="270" font-family="Arial" font-size="28" font-weight="900" fill="#3d4a75" text-anchor="middle" dominant-baseline="central">O</text>
    <text x="1008" y="72" font-family="Arial" font-size="28" font-weight="900" fill="#3d4a75" text-anchor="middle" dominant-baseline="central">F</text>
  </g>
  {row("SAMBUNG", "amber", 46)}
  {row("KATA", "teal", 158)}
  <text x="{W/2}" y="300" font-family="Arial" font-size="21" font-weight="bold" letter-spacing="6"
    fill="#8b95bd" text-anchor="middle">RANTAI KATA &#183; KBBI &#183; OFFLINE &#183; MULTIPLAYER</text>
</svg>
'''

with open("/home/z/my-project/sambungkata-apk/docs/img/banner.svg", "w") as f:
    f.write(svg)
print("banner.svg dibuat")
