const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const root = path.resolve(__dirname, "..");
const source = path.resolve(process.argv[2] || path.join(root, "assets", "onpeople-app-icon.png"));
const target = path.resolve(process.argv[3] || path.join(root, "assets", "OnPeople.ico"));
const platformRoot = path.join(root, "assets", "platform-icons", "windows");
const sizes = [16, 24, 32, 48, 64, 128, 256];

function encodeIco(images) {
  const directorySize = 6 + (images.length * 16);
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + (index * 16);
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

async function renderIcon(image, size) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  const edge = size / 32;
  const content = size / 16;

  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, (size / 2) - edge, 0, Math.PI * 2);
  context.clip();
  context.drawImage(
    image,
    image.width / 8,
    image.height / 8,
    image.width * 0.75,
    image.height * 0.75,
    content,
    content,
    size - (content * 2),
    size - (content * 2),
  );
  context.restore();

  return canvas.toBuffer("image/png");
}

async function main() {
  const image = await loadImage(source);
  const images = [];
  for (const size of sizes) images.push({ size, png: await renderIcon(image, size) });

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(platformRoot, { recursive: true });
  fs.writeFileSync(target, encodeIco(images));
  fs.writeFileSync(path.join(platformRoot, "OnPeople.ico"), encodeIco(images));
  fs.writeFileSync(path.join(platformRoot, "OnPeople-256.png"), images.at(-1).png);
  console.log(`Generated transparent Windows icon: ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
