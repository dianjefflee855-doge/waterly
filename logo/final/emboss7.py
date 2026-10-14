import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageChops
blue=Image.open('/tmp/m_blue.png');ink=Image.open('/tmp/m_ink.png');acc=Image.open('/tmp/m_acc.png')
def M(a): return a
def solid(c,s): return Image.new('RGB',s,c)
def diag(S,c0,c1):
    y,x=np.mgrid[0:S[1],0:S[0]];t=((x+y)/(S[0]+S[1]))[...,None]
    return Image.fromarray((np.array(c0)*(1-t)+np.array(c1)*t).astype('uint8'))
def face(T,top0,top1,inkc,inkside,bluec,blueside,rad,idep=4,bdep=14,sa=0.35):
    S=(T,T);tm=Image.new('L',S,0);ImageDraw.Draw(tm).rounded_rectangle((0,0,T-1,T-1),rad*2,fill=255)
    im=diag(S,top0,top1)
    # soft pillow bevel: darken edges, lighten top-left rim
    inner=tm.filter(ImageFilter.GaussianBlur(56))
    edge=ImageChops.subtract(tm,inner)
    im.paste(solid((0,0,0),S),(0,0),edge.point(lambda v:int(v*0.18)))
    rim=ImageChops.subtract(tm,ImageChops.offset(tm,14,14)).filter(ImageFilter.GaussianBlur(6))
    im.paste(solid((255,255,255),S),(0,0),rim.point(lambda v:int(v*0.6)))
    sc=1.08;L=int(T*sc);o=(T-L)//2
    def place(a):
        m=M(a).resize((L,L),Image.LANCZOS);c=Image.new('L',S,0);c.paste(m,(o,o-8));return c
    for mask,top,side,dep in ((place(blue),bluec,blueside,bdep),(place(ink),inkc,inkside,idep),(place(acc),bluec,blueside,0)):
        sh=ImageChops.offset(mask,dep+2,dep+3).filter(ImageFilter.GaussianBlur(4)).point(lambda v:int(v*(sa if dep==bdep else sa*0.6)))
        im.paste(solid((40,55,80),S),(0,0),sh)
        for k in range(dep,0,-1) if dep else []:
            f=k/dep;c=tuple(int(side[i]*(1-0.25*f)) for i in range(3))
            im.paste(solid(c,S),(0,0),ImageChops.offset(mask,k,k))
        im.paste(solid(top,S),(0,0),mask)
        if dep!=bdep: continue
        hl=ImageChops.subtract(mask,ImageChops.offset(mask,3,3))
        im.paste(solid((255,255,255),S),(0,0),hl.point(lambda v:int(v*0.6)))
    return im.convert('RGBA'),tm
def persp(img,coeffs_dst,S):
    w,h=img.size
    src=[(0,0),(w,0),(w,h),(0,h)]
    A=[];B=[]
    for (x,y),(X,Y) in zip(coeffs_dst,src):
        A.append([x,y,1,0,0,0,-X*x,-X*y]);A.append([0,0,0,x,y,1,-Y*x,-Y*y]);B+= [X,Y]
    c=np.linalg.solve(np.array(A,float),np.array(B,float))
    return img.transform(S,Image.PERSPECTIVE,tuple(c),Image.BICUBIC)
def bg(S,base0,base1,band):
    im=diag(S,base0,base1)
    n=np.random.default_rng(3).normal(0,1,(S[1]//16,S[0]//16))
    n=Image.fromarray(((n-n.min())/(n.max()-n.min())*255).astype('uint8')).resize(S,Image.BICUBIC).filter(ImageFilter.GaussianBlur(60))
    im=Image.blend(im,Image.merge('RGB',[n]*3),0.06)
    d=Image.new('L',S,0);ImageDraw.Draw(d).polygon([(S[0]*0.62,0),(S[0]*0.82,0),(S[0]*0.38,S[1]),(S[0]*0.18,S[1])],fill=255)
    im.paste(solid(band,S),(0,0),d.filter(ImageFilter.GaussianBlur(2)).point(lambda v:0))
    return im
def make(name,bgc,face_args,side_c,thick=90):
    W=2800;S=(W,W);im=bg(S,*bgc)
    f,tm=face(2000,*face_args)
    q=[(400,340),(2400,340),(2400,2340),(400,2340)]   # slight tilt
    fw=persp(f,q,S);mw=persp(tm.convert('L'),q,S)
    sh=ImageChops.offset(mw,0,190).filter(ImageFilter.GaussianBlur(100)).point(lambda v:int(v*0.65))
    im.paste(solid((0,0,0),S),(0,0),sh)
    for k in range(thick,0,-1):
        f2=k/thick;c=tuple(int(side_c[i]*(1-0.45*f2)) for i in range(3))
        im.paste(solid(c,S),(0,0),ImageChops.offset(mw,0,k))
    im.paste(fw,(0,0),fw.split()[3] if False else mw)
    im.crop((0,0,W,W)).resize((2048,2048),Image.LANCZOS).save(name)
BLUE=(53,128,232);BS=(22,70,150)
make('waterly_3d_v11_white.png',((40,42,48),(10,11,14),BLUE),((255,255,253),(225,226,226),(22,41,74),(150,162,182),BLUE,BS,140,0,20,0.3),(205,206,208))
make('waterly_3d_v11_black.png',((244,244,246),(200,202,206),BLUE),((52,54,60),(18,19,22),(246,247,249),(140,142,148),(70,145,245),BS,140),(60,62,68))
