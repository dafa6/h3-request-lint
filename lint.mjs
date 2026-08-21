#!/usr/bin/env node
// h3-request-lint — validate a video generation request before you spend credits.
// Zero dependencies. Node 18+.
//
//   import { lint } from './lint.mjs'
//   const findings = lint(request)
//
//   node lint.mjs request.json

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = JSON.parse(readFileSync(join(HERE, 'constraints.json'), 'utf8'))

const ERROR = 'error'
const WARN = 'warn'

function finding(level, rule, message, source) {
  return { level, rule, message, source: DATA.sources[source] ?? source }
}

/**
 * @param {object} req  a generation request
 * @param {string} [modelId]
 * @returns {Array<{level:string, rule:string, message:string, source:string}>}
 */
export function lint(req, modelId = 'minimax-h3') {
  const m = DATA.models[modelId]
  if (!m) return [finding(ERROR, 'unknown-model', `No constraint data for "${modelId}".`, 'api_reference')]

  const out = []

  // ---- duration -----------------------------------------------------------
  const d = req.duration ?? req.duration_seconds
  if (d !== undefined) {
    const { min, max, step, source } = m.duration_seconds
    if (typeof d !== 'number' || Number.isNaN(d)) {
      out.push(finding(ERROR, 'duration-type', `duration must be a number, got ${typeof d}.`, source))
    } else {
      if (d < min) out.push(finding(ERROR, 'duration-min', `duration ${d}s is below the ${min}s minimum.`, source))
      if (d > max) out.push(finding(ERROR, 'duration-max', `duration ${d}s exceeds the ${max}s maximum.`, source))
      if (d % step !== 0) out.push(finding(ERROR, 'duration-step', `duration must be a whole number of seconds; got ${d}.`, source))
    }
  }

  // ---- resolution ---------------------------------------------------------
  if (req.resolution !== undefined) {
    const { allowed, source, common_error } = m.resolutions
    if (!allowed.includes(req.resolution)) {
      out.push(finding(ERROR, 'resolution-unsupported',
        `resolution "${req.resolution}" is not offered. Allowed: ${allowed.join(', ')}. ${common_error}`, source))
    }
  }

  // ---- aspect ratio, including the derived case ---------------------------
  const hasImageAnchor = m.aspect_ratios.derived_when.some(k => req[k])
  if (req.aspect_ratio !== undefined) {
    const { allowed, source, common_error } = m.aspect_ratios
    if (!allowed.includes(req.aspect_ratio)) {
      out.push(finding(ERROR, 'aspect-ratio-unsupported',
        `aspect_ratio "${req.aspect_ratio}" is not one of ${allowed.join(', ')}.`, source))
    }
    if (hasImageAnchor) {
      out.push(finding(WARN, 'aspect-ratio-derived',
        `aspect_ratio is derived from the attached image and will be ignored. ${common_error}`, source))
    }
  }

  // ---- reference inputs: the total cap is not the sum of the per-type caps -
  const refs = req.reference_inputs ?? {}
  const images = (refs.images ?? []).length
  const videos = (refs.videos ?? []).length
  const audio  = (refs.audio  ?? []).length
  if (images || videos || audio) {
    const r = m.reference_inputs
    if (images > r.max_images) out.push(finding(ERROR, 'ref-images', `${images} reference images exceeds the cap of ${r.max_images}.`, r.source))
    if (videos > r.max_videos) out.push(finding(ERROR, 'ref-videos', `${videos} reference clips exceeds the cap of ${r.max_videos}.`, r.source))
    if (audio  > r.max_audio)  out.push(finding(ERROR, 'ref-audio',  `${audio} reference audio files exceeds the cap of ${r.max_audio}.`, r.source))

    const total = images + videos + audio
    if (total > r.max_files_total) {
      out.push(finding(ERROR, 'ref-total',
        `${total} reference files exceeds the total cap of ${r.max_files_total}. ${r.common_error}`, r.source))
    }
  }

  // ---- audio expectations -------------------------------------------------
  if (req.generate_audio === false || req.audio === false || req.mute === true) {
    out.push(finding(ERROR, 'audio-not-optional',
      `Audio is produced in the same forward pass as the picture and cannot be switched off. Strip the track after download if you need silence.`, m.audio.source))
  }

  // ---- source clips -------------------------------------------------------
  const clips = req.source_videos ?? []
  if (clips.length) {
    const s = m.source_video
    if (clips.length > s.max_clips) {
      out.push(finding(ERROR, 'source-clip-count', `${clips.length} source clips exceeds the cap of ${s.max_clips}.`, s.source))
    }
    clips.forEach((c, i) => {
      const len = typeof c === 'number' ? c : c?.duration
      if (typeof len === 'number' && (len < s.clip_seconds_min || len > s.clip_seconds_max)) {
        out.push(finding(ERROR, 'source-clip-length',
          `source clip ${i} is ${len}s; each clip must be ${s.clip_seconds_min}–${s.clip_seconds_max}s.`, s.source))
      }
    })
  }

  // ---- preview-then-commit hazard ----------------------------------------
  if (req.resolution === '2K' && req.frame_index !== undefined) {
    out.push(finding(WARN, 'regeneration-frame-drift',
      `The high-resolution path is a re-generation, not an upscale, so frame ${req.frame_index} is not the same instant it was in the 768P preview. Do not carry frame indices across resolutions.`, 'spec_table'))
  }

  return out
}

export function format(findings) {
  if (!findings.length) return 'ok — no findings'
  return findings.map(f => `${f.level.toUpperCase().padEnd(5)} ${f.rule}\n      ${f.message}\n      source: ${f.source}`).join('\n')
}

// ---- CLI ------------------------------------------------------------------
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('lint.mjs')
if (invokedDirectly) {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: node lint.mjs <request.json> [model-id]')
    process.exit(2)
  }
  const model = process.argv[3] ?? 'minimax-h3'
  const parsed = JSON.parse(readFileSync(path, 'utf8'))

  // A file may hold one request, or the bundled examples file.
  const batch = Array.isArray(parsed.examples)
    ? parsed.examples
    : [{ name: path, request: parsed }]

  let failed = false
  for (const { name, request } of batch) {
    const findings = lint(request, model)
    if (findings.some(f => f.level === ERROR)) failed = true
    if (batch.length > 1) console.log(`\n── ${name} ──`)
    console.log(format(findings))
  }
  process.exit(failed ? 1 : 0)
}
