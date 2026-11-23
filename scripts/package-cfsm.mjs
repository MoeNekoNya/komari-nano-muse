import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve('dist')
const indexFile = path.join(root, 'index.html')
const assetsDir = path.join(root, 'assets')
if (!fs.existsSync(indexFile)) throw new Error('构建输出缺少 dist/index.html')
fs.mkdirSync(assetsDir, { recursive: true })
const entries = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.name !== 'index.html' && entry.name !== 'assets')
let html = fs.readFileSync(indexFile, 'utf8')
for (const entry of entries) {
  const from = path.join(root, entry.name)
  const to = path.join(assetsDir, entry.name)
  if (fs.existsSync(to)) throw new Error('资源文件重名，停止打包：' + entry.name)
  fs.renameSync(from, to)
  html = html.split('/' + entry.name).join('/assets/' + entry.name)
}
fs.writeFileSync(indexFile, html)
const remaining = fs.readdirSync(root).sort()
if (remaining.length !== 2 || remaining[0] !== 'assets' || remaining[1] !== 'index.html') {
  throw new Error('CFSM 输出必须只有 index.html 与 assets/，实际为：' + remaining.join(', '))
}
if (!fs.statSync(assetsDir).isDirectory() || fs.readdirSync(assetsDir).length === 0) {
  throw new Error('dist/assets/ 缺少 NanoMuse 美术资源')
}
console.log('CFSM theme package ready')
