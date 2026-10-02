import sharp from 'sharp';
const out = async (src, size, file, opts={}) => {
  let img = sharp(src, { density: 400 }).resize(size, size);
  await img.png().toFile(file);
};
await out('icons/logo.svg', 512, 'icons/icon-512.png');
await out('icons/logo.svg', 192, 'icons/icon-192.png');
await out('icons/logo.svg', 180, 'icons/apple-touch-icon.png');
await out('icons/logo.svg', 64, 'icons/favicon.png');
await out('icons/badge.svg', 96, 'icons/badge-96.png');
// maskable: logo already full-bleed with safe-zone content inside 80%
await out('icons/logo.svg', 512, 'icons/maskable-512.png');
// preview with rounded corners like a launcher
const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="115" fill="#fff"/></svg>');
await sharp('icons/icon-512.png').composite([{ input: mask, blend: 'dest-in' }]).png().toFile('icons/preview-rounded.png');
console.log('ok');
