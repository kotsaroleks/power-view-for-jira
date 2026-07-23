import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

const rootDirectory = resolve(import.meta.dirname, "..");
const extensionDirectory = resolve(rootDirectory, "dist/extension");
const packageJson = JSON.parse(
  await readFile(resolve(rootDirectory, "package.json"), "utf8"),
);
const archiveName = `power-view-for-jira-${packageJson.version}.zip`;
const archivePath = resolve(rootDirectory, "dist", archiveName);
const checksumPath = `${archivePath}.sha256`;

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function localHeader(name, data, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(name, data, crc, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

const files = await listFiles(extensionDirectory);
if (files.length === 0) {
  throw new Error("The production extension directory is empty. Run the build first.");
}

const localParts = [];
const centralParts = [];
let localOffset = 0;
for (const file of files) {
  const archiveRelativePath = relative(extensionDirectory, file).split(sep).join("/");
  const name = Buffer.from(archiveRelativePath);
  const data = await readFile(file);
  const crc = crc32(data);
  const header = localHeader(name, data, crc);
  localParts.push(header, name, data);
  centralParts.push(centralHeader(name, data, crc, localOffset), name);
  localOffset += header.length + name.length + data.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(localOffset, 16);
end.writeUInt16LE(0, 20);

const archive = Buffer.concat([...localParts, centralDirectory, end]);
const checksum = createHash("sha256").update(archive).digest("hex");
await mkdir(resolve(rootDirectory, "dist"), { recursive: true });
await writeFile(archivePath, archive);
await writeFile(checksumPath, `${checksum}  ${basename(archivePath)}\n`);

console.info(
  `Packaged ${files.length} files as dist/${archiveName} (${archive.length} bytes).`,
);
console.info(`SHA-256 ${checksum}`);
