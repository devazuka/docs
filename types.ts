export type FileAttributes = {
  mime: string
  size: number
  name: string
}

export type DocFacts = FileAttributes & {
  sha: string
  path: string
  uploadedAt: number
}

export type DocAnalysis = {
  analize: true
  title: string
  slug: string
  type: string
  tags: string[]
  dates: string[]
  summary: string
  purpose: string
  entities: string[]
}

type BaseDoc = DocFacts & { preview?: boolean; optimize?: boolean; deleted?: boolean }

export type Doc = BaseDoc | (BaseDoc & DocAnalysis)

export type FullDoc = DocFacts & DocAnalysis & {
  preview: boolean
  optimize: boolean
}
