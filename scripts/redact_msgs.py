# Show message-cell structure only: per cell, number of comma-separated fields and a shape for each
# (TIME, @mention-present, ends-with-colon, length bucket). No raw text.
import json, re, sys
d = json.load(open(sys.argv[1]))
for e in d:
    if e.get('identifier') != 'WAMessageBubbleTableViewCell': continue
    for k in ('description', 'value', 'title'):
        v = e.get(k)
        if not v: continue
        parts = re.split(r'(?:, |\n)', v)
        shape = []
        for p in parts:
            p = p.replace('\u200e', '').strip()
            if re.fullmatch(r'\d{1,2}:\d{2}', p): shape.append('TIME')
            elif p in ('已发送', '已送达', '已读', '你的消息', '已编辑', '已转发'): shape.append(p)
            elif p.endswith('发来的消息'): shape.append('<X>发来的消息')
            else: shape.append(('@' if '@' in p else '') + f'T{min(len(p)//10,9)}')
        print(k, e['role'], round(e.get('frame', {}).get('x', 0)), shape)
