# Redact AX subtree dump: keep structure, digits and unread/mention keywords; mask other text.
import json, re, sys
KEEP = re.compile(r'(未读|unread|条|@|提及|mention|已静音|muted|置顶|pinned|昨天|星期.|\d+|[:：,，、]|\s)', re.I)
def red(s):
    out, i = [], 0
    for m in KEEP.finditer(s):
        out.append(re.sub(r'\S', 'x', s[i:m.start()])); out.append(m.group()); i = m.end()
    out.append(re.sub(r'\S', 'x', s[i:])); return re.sub(r'x{3,}', 'x…', ''.join(out))
for e in json.load(open(sys.argv[1]))[: int(sys.argv[2]) if len(sys.argv) > 2 else 60]:
    f = e.get('frame', {})
    print('  ' * e['depth'] + e['role'], e.get('identifier', ''), '|d:', red(e.get('description', '')), '|v:', red(e.get('value', '')), '|', round(f.get('y', 0)), round(f.get('h', 0)))
