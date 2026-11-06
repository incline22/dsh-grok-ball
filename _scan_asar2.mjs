import fs from 'node:fs';

const asarPath = 'D:\\deepseek\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const headerSize = sizeBuf.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 8);
const text = headerBuf.toString('utf8');
const header = JSON.parse(text.slice(text.indexOf('{')));
fs.closeSync(fd);

const all = [];
function walk(node, p) {
  if (!node || !node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const np = p ? p + '/' + name : name;
    all.push(np + (child.files ? '/' : ''));
    walk(child, np);
  }
}
walk(header, '');
const patterns = ['whale', 'ui-slots', 'plugins/'];
for (const pat of patterns) {
  console.log('### ' + pat);
  console.log(all.filter((p) => p.toLowerCase().includes(pat)).slice(0, 60).join('\n'));
}
