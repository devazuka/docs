import { encodeBase64 } from 'jsr:@std/encoding/base64'
import sharp from 'npm:sharp'
import { DocAnalysis, DocFacts } from './types.ts'

const TOKEN = Deno.env.get('GEMINI_TOKEN')

const describePrompt = `
You are an intelligent document and image analysis engine. Your task is to analyze the provided file and extract structured metadata to be used for a vector search system.
The document could be taken from a phone (like an invoice, receipt, contract, note), a screenshot, a PDF, an id card, etc... Analyze it carefully and return a JSON object with the following schema.
**Respond ONLY with a valid JSON object. Do not include any other text, explanations, or markdown formatting like \`\`\`json.**
**JSON Schema:**
{
  "summary": "A concise, one-to-two sentence summary of the file content and overall context. This should be a general-purpose description.",
  "type": "The specific type of document or image. Examples: 'Invoice', 'Receipt', 'Contract', 'Letter', 'Presentation Slide', 'Photograph', 'Diagram', 'Screenshot', 'Handwritten Note', 'Map', 'Other', 'Unknown'.",
  "purpose": "The primary purpose or intent of the document or image. Examples: 'Billing for services rendered', 'Proof of purchase for expense tracking', 'Formalizing a legal agreement', 'Personal correspondence', 'Presenting data visually', 'Capturing a personal memory'.",
  "tags": [
    "An array of 5-10 relevant keywords, concepts, and key terms found in the document. These are critical for search and should include objects, themes, and text snippets."
  ],
  "dates": [
    "An array of any dates found in the document, formatted as YYYY-MM-DD. If multiple dates are present (e.g., issue date, due date), extract all of them. If no dates are found, return an empty array []."
  ],
  "entities": [
    "An array of key named entities like people, companies, organizations, products, or locations mentioned. If none are prominent, return an empty array []."
  ],
  "title": "A short title, max 60 chars, prefer shorter",
}`

const model = `gemini-2.5-pro`
const geminiAPIUrl =
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${TOKEN}`

// TODO: allow to run the queries in paralel instead of one by one
// We return json here so, it's going to be any
// deno-lint-ignore no-explicit-any
let prev = Promise.resolve(undefined as any)
const gemini = async (body: string, attempt = 0) => {
  await prev
  console.log('asking gemini...', { attempt, body })
  const pending = fetch(geminiAPIUrl, { method: 'POST', body })
  prev = prev.then(() =>
    pending.then(async (res) => {
      if (res.status !== 429 && res.status < 500) return res.json()
      if (attempt > 10) throw Error(res.statusText)
      await new Promise((res) => setTimeout(res, (attempt ** 2) * 1000))
      return gemini(body, attempt + 1)
    })
  )
  return prev
}

export const analize = async (doc: DocFacts) => {
  const { sha, name, mime } = doc
  const fileNamePrompt =
    `The original filename is "${name}" with mime type "${mime}". This filename may hint the document's content and type.`

  let mime_type = mime
  let buff = await Deno.readFile(
    `doc/${sha.slice(0, 2)}/${sha.slice(2)}`,
  )
  if (mime.startsWith('image/')) {
    mime_type = 'image/webp'
    buff = await sharp(buff)
      .resize({ height: 960, withoutEnlargement: true })
      .webp()
      .toBuffer()
  }

  const parts = [
    { text: describePrompt },
    { text: fileNamePrompt },
    { inline_data: { mime_type, data: encodeBase64(buff) } },
  ]

  console.time(`${sha}:${name} gemini data`)
  const output = await gemini(JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 65536,
      stopSequences: [],
      response_mime_type: 'application/json',
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }))

  if (output.error) {
    for (const detail of (output.error.details || [])) {
      console.error(detail)
    }
    throw Error(output.error.message)
  }
  const analysis = JSON.parse(
    output.candidates[0].content.parts[0].text,
  ) as DocAnalysis
  analysis.analize = true

  console.timeEnd(`${sha}:${name} gemini data`)

  return analysis
}
