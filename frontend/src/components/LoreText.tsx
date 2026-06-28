import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useGlossary } from '../hooks/useGlossary'

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Renders lore text, turning the first mention of any other published entry
 * (creature, character, deity…) into a link to its page — like wiki cross-links.
 * Only the first occurrence of each entity is linked, to avoid noise.
 */
export function LoreText({ text, currentSlug }: { text: string; currentSlug?: string }) {
  const { data: glossary } = useGlossary()

  if (!text) return null

  const names = (glossary ?? []).filter((g) => g.slug !== currentSlug && g.name.length >= 3)
  if (names.length === 0) return <>{text}</>

  const lookup = new Map(names.map((g) => [g.name.toLowerCase(), g]))
  // Longest names first so "King Tibianus" wins over "Tibianus".
  const pattern = names
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .map((g) => escapeRegExp(g.name))
    .join('|')

  // Allow a trailing plural ("Minotaurs" → Minotaur, "Vampires" → Vampire).
  const re = new RegExp(`\\b((?:${pattern})(?:es|s)?)\\b`, 'giu')
  const parts = text.split(re)
  const used = new Set<string>()

  const resolve = (token: string) => {
    const t = token.toLowerCase()
    return lookup.get(t) ?? lookup.get(t.replace(/(es|s)$/, ''))
  }

  return (
    <>
      {parts.map((part, idx) => {
        // Captured matches land on odd indices.
        if (idx % 2 === 1) {
          const hit = resolve(part)
          if (hit && !used.has(hit.slug)) {
            used.add(hit.slug)
            return (
              <Link
                key={idx}
                to={`/entry/${hit.slug}`}
                className="font-medium text-accent-2 decoration-accent/40 underline-offset-2 hover:underline"
              >
                {part}
              </Link>
            )
          }
        }
        return <Fragment key={idx}>{part}</Fragment>
      })}
    </>
  )
}
