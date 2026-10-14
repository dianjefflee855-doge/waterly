# Masked dump of WeChat AX fields for format discovery (digits->9, CJK->汉, latin->a).
import json, re, subprocess, sys
H, B = sys.argv[1], 'com.tencent.xinWeChat'
mask = lambda s: re.sub(r'(.)\1{3,}', r'\1\1\1…', re.sub(r'[\u4e00-\u9fff]', '汉', re.sub(r'[A-Za-z]', 'a', re.sub(r'\d', '9', s or '')))).replace('\n', '⏎')[:70]
def sub(i, d): return json.loads(subprocess.run([H, 'subtree', B, i, str(d)], capture_output=True, text=True).stdout or '[]')
for e in sub('session_list', 2)[:8]:
    print('S', e['depth'], e['role'], (e.get('identifier') or '')[:13], '|d', mask(e.get('description')), '|t', mask(e.get('title')), '|v', mask(e.get('value')))
for e in sub('chat_message_list', 2):
    if e.get('identifier') == 'virtual_cell': continue
    print('M', e['depth'], e['role'], e.get('identifier'), '|d', mask(e.get('description')), '|t', mask(e.get('title')), '|v', mask(e.get('value')), round(e.get('frame', {}).get('x', 0)))
for i in ['current_chat_name_label', 'current_chat_count_label', 'chat_input_field']:
    for e in sub(i, 0): print('H', i, '|d', mask(e.get('description')), '|t', mask(e.get('title')), '|v', mask(e.get('value')), e.get('numChars'), e.get('settable'))
