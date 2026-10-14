"""RapidOCR sidecar: JSON-lines over stdin/stdout.
Request: {"id":1,"path":"x.png","region":[x,y,w,h]|null,"scale":1.5?}
Response: {"id":1,"ms":..,"lines":[{"box":[x0,y0,x1,y1],"text":"..","score":0.9}]}"""
import sys, json, time
from PIL import Image
import numpy as np
from rapidocr_onnxruntime import RapidOCR
ocr = RapidOCR()
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line); img = Image.open(req['path']).convert('RGB')
        ox = oy = 0
        if req.get('region'):
            x, y, w, h = req['region']; img = img.crop((x, y, x + w, y + h)); ox, oy = x, y
        sc = float(req.get('scale') or 1)
        if sc != 1: img = img.resize((round(img.width * sc), round(img.height * sc)), Image.LANCZOS)
        t = time.time(); res, _ = ocr(np.array(img)[:, :, ::-1]); ms = round((time.time() - t) * 1000)
        out = []
        for b, txt, s in (res or []):
            xs = [p[0] for p in b]; ys = [p[1] for p in b]
            out.append({"box": [min(xs) / sc + ox, min(ys) / sc + oy, max(xs) / sc + ox, max(ys) / sc + oy], "text": txt, "score": float(s)})
        print(json.dumps({"id": req.get('id'), "ms": ms, "lines": out}, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"id": req.get('id') if isinstance(req, dict) else None, "error": str(e)}), flush=True)
