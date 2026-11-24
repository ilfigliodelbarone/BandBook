// API del BandBook: estrae il testo di una canzone dal link presente nel Google Sheet.
//
// GET /api/lyrics?url=<link>&artist=<artista>&title=<titolo>
//
// 1. Se il link punta a Genius, scarica la pagina ed estrae il testo.
// 2. Se Genius non risponde o blocca la richiesta, cerca lo stesso brano su LRCLIB
//    (archivio aperto di testi) usando artista e titolo.

import { extractGeniusLyrics, isGeniusUrl } from './lyrics.mjs'

export const config = {
  path: '/api/*',
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9,it;q=0.8',
}

const MAX_HTML_BYTES = 3 * 1024 * 1024

function json(body, status = 200, cache = false) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  if (cache) {
    // Il testo di una canzone non cambia: lo teniamo in cache sulla CDN per una settimana
    headers['Cache-Control'] = 'public, max-age=3600'
    headers['Netlify-CDN-Cache-Control'] = 'public, durable, s-maxage=604800, stale-while-revalidate=86400'
  }
  return new Response(JSON.stringify(body), { status, headers })
}

// Scarica una pagina Genius seguendo i redirect solo verso Genius
async function fetchGeniusPage(url) {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isGeniusUrl(current)) throw new Error('Redirect verso un dominio non consentito')
    const res = await fetch(current, {
      headers: BROWSER_HEADERS,
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString()
      continue
    }
    if (!res.ok) throw new Error(`Genius ha risposto ${res.status}`)
    const html = await res.text()
    return html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html
  }
  throw new Error('Troppi redirect')
}

async function lyricsFromGenius(url) {
  const html = await fetchGeniusPage(url)
  const lyrics = extractGeniusLyrics(html)
  if (!lyrics) throw new Error('Testo non trovato nella pagina')
  return lyrics
}

async function lrclib(path, params) {
  const res = await fetch(`https://lrclib.net/api/${path}?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': 'BandBook/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`LRCLIB ha risposto ${res.status}`)
  return res.json()
}

async function lyricsFromLrclib(artist, title) {
  if (!artist || !title) return null
  const exact = await lrclib('get', { artist_name: artist, track_name: title })
  if (exact?.plainLyrics) return exact.plainLyrics
  if (exact?.instrumental) return null

  const results = await lrclib('search', { artist_name: artist, track_name: title })
  const match = Array.isArray(results) ? results.find((r) => r.plainLyrics && !r.instrumental) : null
  return match ? match.plainLyrics : null
}

// Ricava artista e titolo da un link Genius (es. /Metallica-master-of-puppets-lyrics)
// quando non sono stati passati: usato solo come ultima risorsa per LRCLIB
function guessFromGeniusSlug(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    const words = slug.replace(/-lyrics$/i, '').split('-')
    if (words.length < 2) return null
    return { artist: words[0], title: words.slice(1).join(' ') }
  } catch {
    return null
  }
}

async function handleLyrics(request) {
  const params = new URL(request.url).searchParams
  const url = (params.get('url') || '').trim()
  const artist = (params.get('artist') || '').trim().slice(0, 200)
  const title = (params.get('title') || '').trim().slice(0, 200)

  if (!url && !(artist && title)) {
    return json({ error: 'Serve il link al testo oppure artista e titolo' }, 400)
  }

  const errors = []

  if (url && isGeniusUrl(url)) {
    try {
      const lyrics = await lyricsFromGenius(url)
      return json({ lyrics, source: 'genius', sourceUrl: url }, 200, true)
    } catch (err) {
      errors.push(`Genius: ${err.message}`)
    }
  }

  try {
    let lyrics = await lyricsFromLrclib(artist, title)
    if (!lyrics && url && isGeniusUrl(url)) {
      const guess = guessFromGeniusSlug(url)
      if (guess) lyrics = await lyricsFromLrclib(guess.artist, guess.title)
    }
    if (lyrics) {
      return json({ lyrics, source: 'lrclib', sourceUrl: url || null }, 200, true)
    }
    errors.push('LRCLIB: testo non trovato')
  } catch (err) {
    errors.push(`LRCLIB: ${err.message}`)
  }

  console.warn('Testo non disponibile', { url, artist, title, errors })
  return json({ error: 'Testo non disponibile', details: errors, sourceUrl: url || null }, 404)
}

export default async function handler(request) {
  const { pathname } = new URL(request.url)

  if (pathname === '/api/lyrics' && request.method === 'GET') {
    return handleLyrics(request)
  }

  return json({ error: 'Not found' }, 404)
}
