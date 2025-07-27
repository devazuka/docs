import { createHash } from 'node:crypto'
import { Doc, DocFacts } from './types.ts'
import { analize } from './gemini.ts'
import { addDocument, deleteDocument, proxyRequest } from './meilisearch.ts'
import { optimize, preview } from './process.ts'

const sha256 = async (stream: ReadableStream<Uint8Array>) => {
  const hash = createHash('SHA256')
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

const saveDocMeta = async (doc: Doc) => {
  const json = JSON.stringify(doc, null, 2)
  await Deno.writeTextFile(`${doc.path}.json`, json)
  localStorage[`new:${doc.sha}`] = json
  return doc
}

const actions = { optimize, preview, analize } as const
type ProcessActions = keyof typeof actions
const processDoc = async (action: ProcessActions, sha: string) => {
  const doc = await openDoc(sha)
  if (action in doc) return
  // TODO: notify start
  const interval = setInterval(() => {
    // TODO: notify progress
  }, 500)
  try {
    const result = await actions[action](doc)
    clearInterval(interval)
    Object.assign(doc, result)
    await Promise.all([
      saveDocMeta(doc),
      addDocument(doc),
    ])
    // TODO: notify action success
  } catch (err) {
    // TODO: notify action failed
    throw err
  } finally {
    clearInterval(interval)
  }
}

const startDocProcesses = async (sha: string) => {
  console.log({ sha })
  try {
    await Promise.all([
      processDoc('optimize', sha),
      processDoc('analize', sha),
      processDoc('preview', sha),
    ])
    localStorage.removeItem(`new:${sha}`)
  } catch (err) {
    console.error('Unable to process document', err)
  }
}

const handleUpload = async (req: Request) => {
  const formData = await req.formData()
  const validFiles: File[] = []
  for (const file of formData.getAll('files')) {
    if (!(file instanceof File)) return new Response(null, { status: 400 })
    const supportedType = file.type.startsWith('image/') ||
      file.type.startsWith('text/') ||
      file.type.startsWith('application/')

    if (!supportedType) {
      return new Response(`${file.name}: ${file.type} not supported`, {
        status: 400,
      })
    }
    validFiles.push(file)
  }
  const uploadedAt = Math.floor(Date.now() / 1000)
  const files = await Promise.all(validFiles.map(async (uploadedFile) => {
    const [stream, hashStream] = uploadedFile.stream().tee()
    const tmpPath = await Deno.makeTempFile()
    const file = await Deno.open(tmpPath, { write: true })
    const writePending = stream.pipeTo(file.writable)
    const sha = await sha256(hashStream)
    const dir = `doc/${sha.slice(0, 2)}`
    const filename = sha.slice(2)
    const path = `${dir}/${filename}`
    await Deno.mkdir(dir, { recursive: true })
    try {
      const json = await Deno.readTextFile(`${path}.json`)
      return JSON.parse(json)
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        console.error('unable to read file data', err)
        // keep going if we get an error here to re-process the file
      }
    }
    const doc: DocFacts = {
      sha,
      mime: uploadedFile.type,
      size: uploadedFile.size,
      name: uploadedFile.name,
      uploadedAt,
      get path() {
        return path
      },
    }
    await writePending
    await Promise.all([
      saveDocMeta(doc),
      Deno.rename(tmpPath, `${dir}/${filename}`),
    ])
    addDocument(doc)
    startDocProcesses(sha)
    return doc
  }))
  return new Response(JSON.stringify(files), {
    headers: { 'content-type': 'application/json' },
  })
}

const activeDocs = new Map<string, Doc>()
const openDoc = async (sha: string) => {
  const activeDoc = activeDocs.get(sha)
  if (activeDoc) return activeDoc
  const path = `doc/${sha.slice(0, 2)}/${sha.slice(2)}`
  const doc = JSON.parse(await Deno.readTextFile(`${path}.json`))
  Object.defineProperty(doc, 'path', { get: () => path })
  activeDocs.set(sha, doc)
  return doc as Doc
}

const expire = () => {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toUTCString()
}

const handlers: Record<
  string,
  (r: Request, sha: string | undefined) => Response | Promise<Response>
> = {
  POST_upload: handleUpload,
  POST_search: proxyRequest,
  GET_preview: async (_, sha) => {
    if (!sha) return new Response(null, { status: 400 })
    const doc = await openDoc(sha)
    if (!doc.preview) return new Response(null, { status: 404 })
    console.log(`${doc.path}_preview`)
    const body = await Deno.open(`${doc.path}_preview`)
    const date = new Date()
    date.setFullYear(date.getFullYear() + 1)
    return new Response(body.readable, {
      headers: {
        'content-type': 'image/avif',
        'cache-control': 'public, max-age=31536000, immutable',
        'expire': expire(),
      },
    })
  },
  GET_meta: async (_, sha) => {
    if (!sha) return new Response(null, { status: 400 })
    const body = await Deno.open(`doc/${sha.slice(0, 2)}${sha.slice(2)}.json`)
    return new Response(body.readable, {
      headers: { 'content-type': 'application/json' },
    })
  },
  DELETE_doc: async (_, sha) => {
    if (!sha) return new Response(null, { status: 400 })
    const del = deleteDocument(sha)
    const doc = await openDoc(sha)
    doc.deleted = true
    await saveDocMeta(doc)
    await del
    return new Response(null, { status: 204 })
  },
  GET_doc: async (_, sha) => {
    if (!sha) return new Response(null, { status: 400 })
    const doc = await openDoc(sha)
    const isImg = doc.mime.startsWith('image/')
    const body = await Deno.open(doc.path)
    return new Response(body.readable, {
      headers: {
        'content-type': isImg ? 'image/avif' : doc.mime,
        'cache-control': 'public, max-age=31536000, immutable',
        'expire': expire(),
      },
    })
  },
}

export default {
  async fetch(req: Request) {
    // TODO: handle basic auth
    console.log(req.headers)
    // allow only: 85.240.183.72
    const url = new URL(req.url, 'http://localhost')
    const [, action, sha] = url.pathname.split('/', 3)
    if (sha && !/^[a-f0-9]{64}$/.test(sha)) {
      return new Response(null, { status: 400 })
    }
    const key = `${req.method}_${action}`
    console.log('start', { key })
    const handle = handlers[key]
    if (handle) {
      console.time(key)
      try {
        return await handle(req, sha)
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err
        return new Response(null, { status: 404 })
      } finally {
        console.timeEnd(key)
      }
    }
    if (req.method !== 'GET') return new Response(null, { status: 404 })
    const index = await Deno.open('./index.html', { read: true })
    return new Response(index.readable)
  },
}

// On startup recover pending processes
for (const key of Object.keys(localStorage)) {
  if (!key.startsWith('new:')) continue
  startDocProcesses(key.slice(4))
}

// Test with CURL:
// curl -X POST http://localhost:8000/upload -F "file=@my-test-file.txt"

// TODO: update doc preview
// TODO: add serverside events
