import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const enginePath = path.join(root, 'vendor', 'grok-ball.js')
const srcPath = path.join(root, 'src', 'client-src.js')
const outPath = path.join(root, 'lib', 'client.js')

const engine = fs.readFileSync(enginePath, 'utf8')
const src = fs.readFileSync(srcPath, 'utf8')

if (!src.includes('/*__GROK_BALL_ENGINE__*/')) {
  throw new Error('client-src.js is missing the /*__GROK_BALL_ENGINE__*/ placeholder')
}
if (engine.includes('</script>')) {
  throw new Error('engine source contains </script>, it cannot be embedded verbatim')
}

const out = src.replace('/*__GROK_BALL_ENGINE__*/', () => engine)
fs.writeFileSync(outPath, out, 'utf8')
console.log('built', outPath, out.length, 'chars')
