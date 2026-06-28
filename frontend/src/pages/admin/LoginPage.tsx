import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(false)
    setBusy(true)
    try {
      await login(email, password)
      navigate('/admin/entries')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-center font-display text-3xl text-atlas-gold-bright">
        {t('admin.title')}
      </h1>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-lg border border-atlas-border bg-atlas-panel/60 p-6"
      >
        <div>
          <label className="mb-1 block text-sm text-atlas-muted">{t('admin.email')}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-md border border-atlas-border bg-atlas-bg px-3 py-2 outline-none focus:border-atlas-gold/60"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-atlas-muted">{t('admin.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-md border border-atlas-border bg-atlas-bg px-3 py-2 outline-none focus:border-atlas-gold/60"
          />
        </div>
        {error && <p className="text-sm text-rose-400">{t('admin.loginError')}</p>}
        <button
          disabled={busy}
          className="w-full rounded-md bg-atlas-gold px-4 py-2 font-semibold text-stone-950 transition hover:bg-atlas-gold-bright disabled:opacity-60"
        >
          {t('admin.login')}
        </button>
      </form>
    </div>
  )
}
