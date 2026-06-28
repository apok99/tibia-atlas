import { useTranslation } from 'react-i18next'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const current = i18n.language?.slice(0, 2)

  const langs: { code: 'es' | 'en'; label: string }[] = [
    { code: 'es', label: 'ES' },
    { code: 'en', label: 'EN' },
  ]

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5">
      {langs.map((l) => (
        <button
          key={l.code}
          onClick={() => i18n.changeLanguage(l.code)}
          className={`rounded px-2.5 py-1 text-xs font-bold tracking-wider transition ${
            current === l.code ? 'bg-accent/20 text-accent' : 'text-fg-mute hover:text-fg'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
