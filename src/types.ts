export type KeystrokeEvent = {
  seq: number
  raw: string
  key: string
  mode: string
  blocking?: boolean
  timestamp: number
  bufnr?: number
  filetype?: string
  file?: string
}

export type SequenceStat = {
  mode: string
  keys: string[]
  count: number
  meanDeltaMs: number
  sampleFile?: string
}

export type AnalyzerOptions = {
  windowSize?: number
  minSequenceLength?: number
  minOccurrences?: number
}

export type KeymapDefinition = {
  mode: string
  lhs: string
  rhs?: string
  source: string
  line: number
}

export type ModelSuggestion = {
  mode: string
  lhs: string
  sequence: string[]
  recommendedMapping?: string
  rationale: string
}

export type SuggestionResponse = {
  suggestions: ModelSuggestion[]
  raw: string
}
