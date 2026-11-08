// Generates the PWA icons from a simple SVG (run once: node scripts/make-icons.mjs)
import sharp from "sharp";

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#2563eb"/>
  <g fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 360V152l212 208V152"/>
  </g>
  <g fill="#fff"><circle cx="150" cy="152" r="24"/><circle cx="362" cy="360" r="24"/></g>
</svg>`;

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg(size))).png().toFile(`public/icons/icon-${size}.png`);
}
console.log("icons written");
