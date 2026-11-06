import fs from 'node:fs';
import path from 'node:path';

const asarPath = 'D:\\deepseek\\resources\\app.asar';
const outRoot = 'E:\\Grok Ball\\_research';
const fd = fs.openSync(asarPath, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const headerSize = sizeBuf.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 8);
const text = headerBuf.toString('utf8');
const header = JSON.parse(text.slice(text.indexOf('{')));
const baseOffset = 8 + headerSize;

const wanted = [
  /dsh-client-ui-session\/lib\/types\/.*\.d\.ts$/,
  /dsh-client-ui-layout\/lib\/types\/.*\.d\.ts$/,
  /dsh-client-ui-renderer\/package\.json$/,
  /dsh-client-ui-renderer\/lib\/types\/.*\.d\.ts$/,
  /dsh-client-ui-layout\/lib\/client\.js$/,
];
let n = 0;
function walk(node, p) {
  if (!node || !node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const np = p ? p + '/' + name : name;
    if (child.files) walk(child, np);
    else if (wanted.some((re) => re.test(np))) {
      const dest = path.join(outRoot, np);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const buf = Buffer.alloc(child.size);
      fs.readSync(fd, buf, 0, child.size, baseOffset + Number(child.offset));
      fs.writeFileSync(dest, buf);
      n++;
    }
  }
}
walk(header, '');
fs.closeSync(fd);
console.log('extracted', n);
