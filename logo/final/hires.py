import cairosvg,numpy as np
from PIL import Image,ImageDraw,ImageFont
K=3;N=1024*K
svg=open('waterly_drop_word_v5.svg').read().replace('width="1024" height="1024"',f'width="{N}" height="{N}" viewBox="0 0 1024 1024"')
cairosvg.svg2png(bytestring=svg.encode(),write_to='/tmp/hs.png')
a=np.array(Image.open('/tmp/hs.png').convert('RGB')).astype(int)
Image.fromarray((((a[...,2]-a[...,0])>80)*255).astype('uint8')).save('/tmp/m_blue.png')
G='/usr/share/fonts/truetype/sand-box/google/Montserrat/Montserrat-VariableFont_wght.ttf'
ink=Image.new('L',(N,N),0);acc=Image.new('L',(N,N),0)
di=ImageDraw.Draw(ink);da=ImageDraw.Draw(acc)
def F(s,w):
  f=ImageFont.truetype(G,s);f.set_variation_by_name(w);return f
def sp(y,t,f,g):
  ws=[di.textlength(ch,font=f) for ch in t];W=sum(ws)+g*(len(t)-1);x=N/2-W/2
  for ch,w in zip(t,ws): di.text((x,y),ch,font=f,fill=255);x+=w+g
  return W
g0=534*K;gh=174*K
sp(g0+gh*0.02,'WATERLY',F(round(gh*0.62),b'Light'),20*K)
W=sp(g0+gh*0.74,'AI CHAT ASSISTANT',F(round(gh*0.17),b'Medium'),6*K)
yl=g0+gh*0.74+gh*0.11
for x0 in (N/2-W/2-130*K,N/2+W/2+20*K): da.line((x0,yl,x0+110*K,yl),fill=255,width=5*K)
bm=Image.open('/tmp/m_blue.png');acc.save('/tmp/m_acc.png')
bm.save('/tmp/m_blue.png');ink.save('/tmp/m_ink.png')
