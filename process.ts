import sharp from 'npm:sharp'
import { Poppler } from 'npm:node-poppler'
import { DocFacts } from './types.ts'

const poppler = new Poppler()
const pdfOpts = { firstPageToConvert: 1, lastPageToConvert: 1, pngFile: true }

const generateSVGPreview = (text: string) =>
  new TextEncoder().encode(`
    <svg width="640" height="640" viewBox="0 0 640 640">
      <rect width="100%" height="100%" fill="white" />
      <text x="20" y="40" font-family="monospace" font-size="16" fill="black">
        <tspan x="20" dy="1.2em">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</tspan>
      </text>
    </svg>
  `)

export const preview = async (doc: DocFacts) => {
  let buff: Uint8Array
  if (doc.mime === 'application/pdf') {
    await poppler.pdfToCairo(doc.path, doc.path, pdfOpts)
    buff = await Deno.readFile(`${doc.path}-1.png`)
    await Deno.remove(`${doc.path}-1.png`)
  } else if (doc.mime.startsWith('text/')) {
    const textContent = await Deno.readTextFile(doc.path)
    buff = generateSVGPreview(textContent)
  } else if (doc.mime === 'text/html') {
    // TODO: Implement HTML preview generation
    console.log('HTML preview generation is not yet implemented.')
    return { preview: false }
  } else {
    // For other types, we can use the existing logic or do nothing
    return { preview: false }
  }

  await sharp(buff)
    .resize({ width: 240, height: 240 })
    .avif()
    .toFile(`${doc.path}_preview`)
  return { preview: true }
}

export const optimize = async (doc: DocFacts) => {
  if (!doc.mime.startsWith('image/')) return { optimize: false }
  // TODO:
  // - auto rotate
  // - fix contrast
  // - content-aware crop
  // - optimize pdf (?)

  await Deno.copyFile(doc.path, `${doc.path}_source`)
  await sharp(`${doc.path}_source`)
    .resize({ height: 1920 })
    .avif()
    .toFile(doc.path)

  return { optimize: true }
}
