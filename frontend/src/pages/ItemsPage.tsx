import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '../hooks/useCollection'
import { ItemAlbum } from '../components/items/ItemAlbum'
import { ItemConfigurator } from '../components/items/ItemConfigurator'
import { Seo, collectionJsonLd } from '../lib/seo'

type Tab = 'album' | 'config'

export function ItemsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'config' ? 'config' : 'album'

  const collection = useCollection()

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'album') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }

  return (
    <div>
      <Seo
        title={t('items.title')}
        description={t('items.intro')}
        path="/items"
        jsonLd={collectionJsonLd({ name: t('items.title'), description: t('items.intro'), path: '/items' })}
      />
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">
          {t('items.kicker')}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-fg">{t('items.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-mute">{t('items.intro')}</p>
      </header>

      {/* Sub-tabs + (album only) reset. */}
      <div className="mb-6 flex items-center gap-2 border-b border-line">
        {(['album', 'config'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative px-4 py-2.5 text-sm font-bold uppercase tracking-wider transition ${
              tab === key ? 'text-accent' : 'text-fg-mute hover:text-fg'
            }`}
          >
            {t(key === 'album' ? 'items.tabAlbum' : 'items.tabConfig')}
            {tab === key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}

        {tab === 'album' && collection.count > 0 && (
          <button
            onClick={() => {
              if (window.confirm(t('items.resetConfirm'))) collection.reset()
            }}
            className="ml-auto text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
          >
            {t('items.reset')}
          </button>
        )}
      </div>

      {tab === 'album' ? (
        <ItemAlbum has={collection.has} toggle={collection.toggle} countIn={collection.countIn} />
      ) : (
        <ItemConfigurator />
      )}
    </div>
  )
}
