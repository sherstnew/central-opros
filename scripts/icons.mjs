import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([size, t, data, crc]);
}
function distance(x, y, ax, ay, bx, by) {
  const d = (bx - ax) ** 2 + (by - ay) ** 2,
    t = Math.max(
      0,
      Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / d),
    );
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
function render(size) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 512,
        py = ((y + 0.5) / size) * 512;
      let rgb = [40, 93, 229];
      if (
        (px >= 144 && px <= 368 && py >= 169 && py <= 315) ||
        (px >= 184 &&
          px <= 256 &&
          py >= 315 &&
          py <= 367 - ((px - 184) * 52) / 72)
      )
        rgb = [255, 255, 255];
      if (
        Math.min(
          distance(px, py, 210, 238, 242, 270),
          distance(px, py, 242, 270, 305, 204),
        ) <= 12
      )
        rgb = [40, 93, 229];
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      data.set([...rgb, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
mkdirSync("public", { recursive: true });
for (const [size, file] of [
  [192, "icon-192.png"],
  [512, "icon-512.png"],
  [180, "apple-touch-icon.png"],
])
  writeFileSync(`public/${file}`, render(size));
