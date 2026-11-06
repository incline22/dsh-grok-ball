import fs from 'node:fs';

const asarPath = 'D:\\deepseek\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const headerSize = sizeBuf.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 8);
const text = headerBuf.toString('utf8');
const start = text.indexOf('{');
const header = JSON.parse(text.slice(start));
fs.closeSync(fd);

const hits = [];
function walk(node, p) {
  if (!node || typeof node !== 'object') return;
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      const np = p ? p + '/' + name : name;
      if (/dsh-(client-ui|whale|market|client)/.test(name) || /(whale|client-ui-slots?)/.test(name)) {
        hits.push(np + (child.files ? '/' : ''));
      }
      walk(child, np);
    }
  }
}
walk(header, '');
console.log(hits.slice(0, 200).join('\n'));
console.log('TOTAL', hits.length);
