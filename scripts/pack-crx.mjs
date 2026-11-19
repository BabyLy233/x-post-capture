import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = resolve(root, '.output/chrome-mv3')
const keyPath = resolve(root, '.output/chrome-mv3.pem')
const crxPath = resolve(root, '.output/chrome-mv3.crx')

if (!existsSync(extensionDir)) {
  console.error('未找到构建产物，请先运行 pnpm build。')
  process.exit(1)
}

const candidates = [
  process.env.CHROME_BIN,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
].filter(Boolean)

const chrome = candidates.find((candidate) => {
  if (candidate.includes('/')) return existsSync(candidate)
  return spawnSync('which', [candidate], { stdio: 'ignore' }).status === 0
})

if (!chrome) {
  console.error('未找到 Chrome，可通过 CHROME_BIN 指定浏览器路径。')
  process.exit(1)
}

if (existsSync(crxPath)) rmSync(crxPath)

const args = [`--pack-extension=${extensionDir}`]
if (existsSync(keyPath)) args.push(`--pack-extension-key=${keyPath}`)

try {
  execFileSync(chrome, args, { stdio: 'inherit' })
} catch {
  console.error('Chrome 打包失败。')
  process.exit(1)
}

if (!existsSync(crxPath)) {
  console.error('未生成 crx 文件。')
  process.exit(1)
}

if (existsSync(keyPath)) {
  const publicKey = createPublicKey(createPrivateKey(readFileSync(keyPath, 'utf8'))).export({
    type: 'spki',
    format: 'der',
  })
  const hash = createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
  const id = [...hash].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('')
  console.log(`\nCRX: ${crxPath}`)
  console.log(`扩展 ID: ${id}`)
  console.log(`私钥: ${keyPath}（请勿提交或分享）`)
}
