import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, clearToken, getToken, setToken } from '../lib/api'

interface AuthUser {
  id: number
  name: string
  email: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore the session from a stored token on first load.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .get<AuthUser>('/admin/me')
      .then((res) => setUser(res.data))
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const { data } = await api.post<{ token: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    })
    setToken(data.token)
    setUser(data.user)
  }

  const logout = async () => {
    try {
      await api.post('/admin/logout')
    } finally {
      clearToken()
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
