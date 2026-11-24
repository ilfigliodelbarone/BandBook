// Estrazione del testo da una pagina di Genius (senza dipendenze esterne)

export function isGeniusUrl(value) {
  try {
    const u = new URL(value)
    return (u.protocol === 'https:' || u.protocol === 'http:') && /^(www\.)?genius\.com$/i.test(u.hostname)
  } catch {
    return false
  }
}

// Restituisce l'indice subito dopo il </div> che chiude il <div> aperto in `start`
function endOfDiv(html, start) {
  const tag = /<\/?div\b[^>]*>/gi
  tag.lastIndex = start
  let depth = 0
  let m
  while ((m = tag.exec(html))) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) return tag.lastIndex
    } else if (!m[0].endsWith('/>')) {
      depth++
    }
  }
  return html.length
}

// Rimuove i blocchi <div ... attributo ...>...</div> (es. intestazioni "Contributors")
function removeDivsWith(html, attributePattern) {
  const open = new RegExp(`<div\\b[^>]*${attributePattern}[^>]*>`, 'i')
  let out = html
  let m
  while ((m = open.exec(out))) {
    out = out.slice(0, m.index) + out.slice(endOfDiv(out, m.index))
  }
  return out
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#x27': "'", '#39': "'" }

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    const key = code.toLowerCase()
    if (key in ENTITIES) return ENTITIES[key]
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10))
    return all
  })
}

function htmlToText(fragment) {
  return decodeEntities(
    fragment
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

function tidy(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractGeniusLyrics(html) {
  const containers = []
  const open = /<div\b[^>]*data-lyrics-container="true"[^>]*>/gi
  let m
  while ((m = open.exec(html))) {
    const end = endOfDiv(html, m.index)
    containers.push(html.slice(m.index + m[0].length, end).replace(/<\/div>$/i, ''))
    open.lastIndex = end
  }
  if (containers.length === 0) return null

  const text = containers
    .map((c) => removeDivsWith(c, 'data-exclude-from-selection="true"'))
    .map(htmlToText)
    .join('\n')

  // Le sezioni come [Ritornello] vanno precedute da una riga vuota per leggibilità
  const lyrics = tidy(text.replace(/\n*(\[[^\]\n]+\])/g, '\n\n$1'))
  return lyrics || null
}
