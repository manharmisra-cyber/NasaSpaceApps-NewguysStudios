import sys, os, numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
W, H = 5760, 2880
g = np.fromfile(os.path.join(src, 'lunarnav_ldem16_u16.bin'), dtype='<u2').reshape(H, W)
print('global min/max m', g.min()*0.5-10000, g.max()*0.5-10000, 'mean', g.mean()*0.5-10000)
def rg(a):
    im = np.zeros(a.shape + (3,), np.uint8); im[..., 0] = a >> 8; im[..., 1] = a & 255; return Image.fromarray(im, 'RGB')
tot = 0
for r in range(4):
    for c in range(4):
        t = g[r*720:(r+1)*720, c*1440:(c+1)*1440]
        p = os.path.join(out, 'ldem16_%d_%d.png' % (r, c)); rg(t).save(p, optimize=True); tot += os.path.getsize(p)
print('global tiles total MB', tot/1e6)
s = np.fromfile(os.path.join(src, 'lunarnav_sites_u16.bin'), dtype='<u2').reshape(17, 128, 128)
atlas = np.concatenate(list(s), axis=1); rg(atlas).save(os.path.join(out, 'sites.png'), optimize=True)
print('sites.png KB', os.path.getsize(os.path.join(out, 'sites.png'))/1e3, 'relief per site (m):', [int((x.max()-x.min())*0.5) for x in s])
for n in ['moon_2k', 'earth_2k']:
    im = Image.open(os.path.join(src, 'lunarnav_%s.jpg' % n)); print(n, im.size, im.mode); im.save(os.path.join(out, n + '.jpg'), quality=88)
# round-trip check
back = np.array(Image.open(os.path.join(out, 'sites.png'))); v = back[..., 0].astype(np.uint16) * 256 + back[..., 1]; print('roundtrip ok', bool((v == atlas).all()))
