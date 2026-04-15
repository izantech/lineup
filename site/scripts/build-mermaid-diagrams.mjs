import { mkdirSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const siteRoot = path.resolve(__dirname, '..')
const inputDir = path.join(siteRoot, 'diagrams')
const outputDir = path.join(siteRoot, 'public', 'diagrams')
const defaultConcurrency = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))
const requestedConcurrency = Number.parseInt(process.env.LINEUP_DIAGRAM_CONCURRENCY ?? '', 10)
const concurrency =
  Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : defaultConcurrency

mkdirSync(outputDir, { recursive: true })

const files = readdirSync(inputDir).filter((name) => name.endsWith('.mmd')).sort()

if (files.length === 0) {
  console.log('No Mermaid diagram sources found.')
  process.exit(0)
}

function mermaidCliPath() {
  return path.join(siteRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc')
}

function renderDiagram(file) {
  const inputPath = path.join(inputDir, file)
  const outputPath = path.join(outputDir, file.replace(/\.mmd$/u, '.svg'))
  return new Promise((resolve, reject) => {
    const child = spawn(
      mermaidCliPath(),
      ['-i', inputPath, '-o', outputPath, '-b', 'transparent'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let stderr = ''

    child.stdout.on('data', () => {})
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Failed to render ${file}${stderr ? `\n${stderr.trim()}` : ''}`))
    })
  })
}

async function run() {
  console.log(`Generating ${files.length} Mermaid SVG diagrams with concurrency ${Math.min(concurrency, files.length)}`)

  let nextIndex = 0

  async function worker() {
    while (true) {
      const file = files[nextIndex]
      nextIndex += 1

      if (!file) {
        return
      }

      await renderDiagram(file)
      console.log(`Rendered ${file}`)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
  await Promise.all(workers)
}

try {
  await run()
  console.log(`Generated ${files.length} Mermaid SVG diagrams in ${outputDir}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
