import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Seo } from '../lib/seo'

/**
 * Contact details for the responsible fansite administrator, as required by
 * the CipSoft fansite programme (Tibia character and email; must be
 * reachable in English). These are plain constants — they are not translated.
 */
const CONTACT = {
  character: 'Apokalipsus',
  email: 'apokty99@gmail.com',
} as const

/** External link that opens in a new tab with safe rel attributes. */
function ExtLink(props: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {props.children}
    </a>
  )
}

export function AboutPage() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Seo title={t('about.title')} description={t('about.intro')} path="/about" />

      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">{t('about.kicker')}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-fg sm:text-4xl">{t('about.title')}</h1>
        <p className="mt-3 text-fg-dim">{t('about.intro')}</p>
      </header>

      {/* Copyright & trademarks — references to CipSoft and Tibia are links. */}
      <section className="panel space-y-3 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{t('about.copyright.title')}</h2>
        <p className="text-sm leading-relaxed text-fg-dim">
          <Trans
            i18nKey="about.copyright.body"
            components={[
              <ExtLink href="https://www.cipsoft.com" />,
              <ExtLink href="https://www.tibia.com" />,
            ]}
          />
        </p>
        <p className="text-sm leading-relaxed text-fg-dim">{t('about.copyright.official')}</p>
      </section>

      {/* Our content — fansite-made vs. official, and the "unconfirmed" marking. */}
      <section className="panel space-y-3 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{t('about.content.title')}</h2>
        <p className="text-sm leading-relaxed text-fg-dim">{t('about.content.body')}</p>
      </section>

      {/* Monetisation transparency. */}
      <section className="panel space-y-3 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{t('about.monetization.title')}</h2>
        <p className="text-sm leading-relaxed text-fg-dim">{t('about.monetization.body')}</p>
      </section>

      {/* Cookies & local storage — functional only, no tracking. */}
      <section className="panel space-y-3 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{t('about.cookies.title')}</h2>
        <p className="text-sm leading-relaxed text-fg-dim">{t('about.cookies.body')}</p>
      </section>

      {/* Contact — the responsible administrator. */}
      <section className="panel space-y-4 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{t('about.contact.title')}</h2>
        <p className="text-sm leading-relaxed text-fg-dim">{t('about.contact.intro')}</p>
        <dl className="grid gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('about.contact.characterLabel')}
          </dt>
          <dd className="text-sm text-fg">{CONTACT.character}</dd>

          <dt className="text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('about.contact.emailLabel')}
          </dt>
          <dd className="text-sm text-fg">
            <a
              href={`mailto:${CONTACT.email}`}
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              {CONTACT.email}
            </a>
          </dd>
        </dl>
      </section>
    </div>
  )
}
