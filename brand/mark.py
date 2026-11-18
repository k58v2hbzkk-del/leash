# Leash mark: a handle loop, a taut line, and the agent at the end of it (acid green).
INK, PAPER, ACID = '#121211', '#EEEDEA', '#F0388B'

def mark(fg=INK, size=240, x=0, y=0, dot=ACID):
    s = size / 240
    return f'''<g transform="translate({x} {y}) scale({s})">
  <circle cx="78" cy="120" r="46" fill="none" stroke="{fg}" stroke-width="26"/>
  <rect x="118" y="107" width="62" height="26" rx="13" fill="{fg}"/>
  <circle cx="190" cy="120" r="32" fill="{dot}"/>
</g>'''

def wordmark(fg=INK, x=0, y=0, size=88):
    return f'<text x="{x}" y="{y}" font-family="Inter Display, Inter, sans-serif" font-weight="600" font-size="{size}" letter-spacing="{-0.045*size:.1f}" fill="{fg}">Leash</text>'

def svg(w, h, body, bg=None):
    b = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{b}{body}</svg>'

if __name__ == '__main__':
    import os
    os.makedirs('out', exist_ok=True)
    open('out/mark.svg', 'w').write(svg(240, 240, mark()))
    open('out/mark-paper.svg', 'w').write(svg(240, 240, mark(PAPER)))
    open('out/favicon.svg', 'w').write(svg(240, 240, f'<rect width="240" height="240" rx="56" fill="{INK}"/>' + mark(PAPER, 200, 14, 20)))
    open('out/icon.svg', 'w').write(svg(512, 512, f'<rect width="512" height="512" rx="112" fill="{INK}"/>' + mark(PAPER, 420, 34, 46)))
    open('out/logo-light.svg', 'w').write(svg(560, 160, mark(INK, 160, 0, 0) + wordmark(INK, 172, 112, 86)))
    open('out/logo-dark.svg', 'w').write(svg(560, 160, mark(PAPER, 160, 0, 0) + wordmark(PAPER, 172, 112, 86), INK))
    W, H = 1600, 1000
    body = f'<rect width="{W}" height="{H}" fill="{PAPER}"/>'
    body += f'<rect x="40" y="40" width="740" height="560" rx="40" fill="#E4E2DD"/>' + mark(INK, 440, 180, 100)
    body += f'<rect x="820" y="40" width="740" height="560" rx="40" fill="{INK}"/>' + mark(PAPER, 440, 960, 100)
    body += f'<rect x="40" y="640" width="1040" height="320" rx="40" fill="#fff"/>' + mark(INK, 220, 80, 690) + wordmark(INK, 320, 850, 150)
    body += f'<rect x="1120" y="640" width="440" height="320" rx="40" fill="#E4E2DD"/><rect x="1240" y="700" width="200" height="200" rx="46" fill="{INK}"/>' + mark(PAPER, 172, 1250, 714)
    open('out/sheet.svg', 'w').write(svg(W, H, body))
