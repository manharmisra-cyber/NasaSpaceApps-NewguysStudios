import sys, os, json, numpy as np
src, out = sys.argv[1], sys.argv[2]
W, H, R = 5760, 2880, 1737400.0
g = np.fromfile(os.path.join(src, 'lunarnav_ldem16_u16.bin'), dtype='<u2').reshape(H, W).astype(np.float32) * 0.5 - 10000
sites = [[-89.45,-137.3],[-85.99,-2.93],[-85.42,31.62],[-84.79,29.2],[-80.13,1.44],[-69.373,32.319],[18.56,61.81],[-13.316,25.251],[-45.444,177.599],[-41.638,-153.985],[43.058,-51.916],[0.6741,23.473],[-3.0124,-23.4216],[-3.6453,-17.4714],[26.1322,3.6339],[-8.973,15.5002],[20.1908,30.7717]]
s64 = np.fromfile(os.path.join(src, 'lunarnav_sites_u16.bin'), dtype='<u2').reshape(17, 128, 128).astype(np.float32) * 0.5 - 10000
def samp(lat, lon):
    fr = np.clip((90 - lat) * 16 - 0.5, 0, H - 1.001); fc = ((lon + 180) % 360) * 16 - 0.5; fc = np.where(fc < 0, fc + W, fc)
    r0 = np.floor(fr).astype(int); c0 = np.floor(fc).astype(int) % W; c1 = (c0 + 1) % W; tb = fr - r0; ta = fc - np.floor(fc)
    return (g[r0, c0] * (1 - ta) + g[r0, c1] * ta) * (1 - tb) + (g[r0 + 1, c0] * (1 - ta) + g[r0 + 1, c1] * ta) * tb
d = np.arange(30000, 400001, 1000.0); dl = d / R; res = []
for k, (la, lo) in enumerate(sites):
    p = np.radians(la); l0 = np.radians(lo); h0 = float(s64[k, 63:65, 63:65].mean()) + 2; r0 = R + h0; prof = []
    for az in range(360):
        th = np.radians(az)
        la2 = np.arcsin(np.sin(p) * np.cos(dl) + np.cos(p) * np.sin(dl) * np.cos(th)); lo2 = l0 + np.arctan2(np.sin(th) * np.sin(dl) * np.cos(p), np.cos(dl) - np.sin(p) * np.sin(la2))
        r1 = R + samp(np.degrees(la2), np.degrees(lo2)); ang = np.degrees(np.arctan2(r1 * np.cos(dl) - r0, r1 * np.sin(dl))); prof.append(round(float(ang.max()), 2))
    res.append(prof); print(k, la, 'site h', round(h0), 'far horizon min/median/max', min(prof), sorted(prof)[180], max(prof))
open(out, 'w').write('/* Far horizon for the 17 preset sites: the highest elevation angle (degrees) reached by real LOLA terrain 30 to 400 km away,\n   for each degree of azimuth (0 = north, clockwise). Computed from the 16 px/deg grid, from 2 m above the site. */\nvar FAR_HORIZON = ' + json.dumps(res, separators=(',', ':')) + ';\n')
