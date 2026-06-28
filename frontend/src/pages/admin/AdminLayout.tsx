import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { LoginPage } from './LoginPage'

export function AdminLayout() {
  const { t } = useTranslation()
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  if (loading) return <p className="text-atlas-muted">{t('common.loading')}</p>
  if (!user) return <LoginPage />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-atlas-border pb-4">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-2xl text-atlas-gold-bright">{t('admin.title')}</h1>
          <NavLink
            to="/admin/entries"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-atlas-gold' : 'text-atlas-muted hover:text-atlas-ink'}`
            }
          >
            {t('admin.entries')}
          </NavLink>
          <Link to="/admin/entries/new" className="text-sm text-atlas-muted hover:text-atlas-ink">
            {t('admin.newEntry')}
          </Link>
        </div>
        <div className="flex items-center gap-3 text-sm text-atlas-muted">
          <span>{user.name}</span>
          <button
            onClick={() => logout().then(() => navigate('/admin'))}
            className="rounded-md border border-atlas-border px-3 py-1 hover:text-atlas-ink"
          >
            {t('admin.logout')}
          </button>
        </div>
      </div>
      <Outlet />
    </div>
  )
}
