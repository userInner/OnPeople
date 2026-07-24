const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(process.argv[2] || path.join(__dirname, "..", "assets", "onpeople-app-icon-256.png"));
const target = path.resolve(process.argv[3] || path.join(__dirname, "..", "assets", "OnPeople.ico"));
const png = fs.readFileSync(source);
const signature = png.subarray(0, 8).toString("hex");
if (signature !== "89504e470d0a1a0a") throw new Error(`Expected a PNG source: ${source}`);

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6);
header.writeUInt8(0, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);
fs.writeFileSync(target, Buffer.concat([header, png]));
console.log(`Generated Windows icon: ${target}`);
