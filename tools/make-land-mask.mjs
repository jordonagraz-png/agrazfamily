// Rebuilds assets/data/land.bin, the land mask the Family Globe draws as dots.
// Source: Natural Earth 1:50m land (public domain) via the world-atlas package.
//
//   npm i --no-save d3-geo@3 topojson-client@3 world-atlas@2 canvas
//   node tools/make-land-mask.mjs [step-in-degrees, default 1]
//
// Format: "LD", step×100 (uint16, little-endian), then one bit per dot (1 = land),
// row by row from the north pole; each row at latitude 90 − step·(i + ½) holds
// round(360/step · cos(lat)) evenly spaced dots starting just east of 180°W.
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { createCanvas } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const STEP = Number(process.argv[2] || 1);
const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);

// Rasterize once at 0.05° per pixel, then sample.
const W = 7200, H = 3600;
const cv = createCanvas(W, H), ctx = cv.getContext('2d');
const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.1);
ctx.beginPath(); geoPath(proj, ctx)(land); ctx.fill();
const px = ctx.getImageData(0, 0, W, H).data;
const isLand = (lng, lat) => {
  const x = Math.min(W - 1, Math.floor((lng + 180) / 360 * W)), y = Math.min(H - 1, Math.floor((90 - lat) / 180 * H));
  return px[(y * W + x) * 4 + 3] > 127;
};

const bits = [];
for (let i = 0, rows = Math.round(180 / STEP); i < rows; i++) {
  const lat = 90 - STEP * (i + 0.5);
  const n = Math.max(1, Math.round((360 / STEP) * Math.cos(lat * Math.PI / 180)));
  for (let j = 0; j < n; j++) bits.push(isLand(-180 + (j + 0.5) * 360 / n, lat));
}
const out = new Uint8Array(4 + Math.ceil(bits.length / 8));
out.set([0x4c, 0x44, Math.round(STEP * 100) & 255, Math.round(STEP * 100) >> 8]);
bits.forEach((b, k) => { if (b) out[4 + (k >> 3)] |= 1 << (k & 7); });
writeFileSync(new URL('../assets/data/land.bin', import.meta.url), out);
console.log(`land.bin: ${bits.filter(Boolean).length} land dots of ${bits.length}, ${out.length} bytes`);
