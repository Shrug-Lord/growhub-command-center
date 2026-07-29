import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  changeAdminPassword,
  changeAdminUsername,
  getAuthBootstrap,
  login as createSession,
  logoutSession,
  setupAdmin,
} from '../api/piClient.js'
import { clearCsrfToken, setCsrfToken } from '../api/apiClient.js'
import { useRecoveryTask } from './ServerAvailabilityContext.jsx'

const AuthContext = createContext(null)

function authFromSession(session) {
  return {
    username: session.user.username,
    userId: session.user.id,
    devices: session.user.devices ?? [],
    expiresAt: session.expiresAt,
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [preferredUsername, setPreferredUsername] = useState('admin')
  const [setupJustCompleted, setSetupJustCompleted] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const acceptSession = useCallback((session) => {
    setCsrfToken(session.csrfToken)
    setAuth(authFromSession(session))
    setSetupRequired(false)
    setPreferredUsername(session.user.username)
  }, [])

  const clearSession = useCallback(() => {
    clearCsrfToken()
    setAuth(null)
    setError(null)
  }, [])

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const bootstrap = await getAuthBootstrap()
        if (!active) return
        if (bootstrap.session) acceptSession(bootstrap.session)
        else {
          clearCsrfToken()
          setAuth(null)
          setSetupRequired(bootstrap.setupRequired)
        }
      } catch (requestError) {
        if (!active) return
        clearCsrfToken()
        setAuth(null)
        setError(requestError.message)
      } finally {
        if (active) setIsInitializing(false)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [acceptSession])

  const completeSetup = useCallback(async ({ username, password, passwordConfirmation }) => {
    setIsSubmitting(true)
    setError(null)
    try {
      const setup = await setupAdmin({ username, password, passwordConfirmation })
      setPreferredUsername(setup.username)
      setSetupRequired(false)
      setSetupJustCompleted(true)
      return setup
    } catch (requestError) {
      setError(requestError.message)
      throw requestError
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  const login = useCallback(
    async (username, password) => {
      setIsSubmitting(true)
      setError(null)
      try {
        const session = await createSession({ username, password })
        acceptSession(session)
        setSetupJustCompleted(false)
      } catch (requestError) {
        setError(requestError.message)
        throw requestError
      } finally {
        setIsSubmitting(false)
      }
    },
    [acceptSession],
  )

  const logout = useCallback(async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await logoutSession()
      clearSession()
    } catch (requestError) {
      if (requestError?.code === 'session_required') clearSession()
      else {
        setError(requestError.message)
        throw requestError
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [clearSession])

  const changeUsername = useCallback(
    async ({ username, currentPassword }) => {
      const result = await changeAdminUsername({ username, currentPassword })
      setPreferredUsername(result.admin.username)
      clearSession()
      return result
    },
    [clearSession],
  )

  const changePassword = useCallback(
    async ({ currentPassword, password, passwordConfirmation }) => {
      const result = await changeAdminPassword({ currentPassword, password, passwordConfirmation })
      clearSession()
      return result
    },
    [clearSession],
  )

  const revalidateSession = useCallback(async () => {
    const bootstrap = await getAuthBootstrap()
    if (bootstrap.session) {
      acceptSession(bootstrap.session)
      return
    }
    clearCsrfToken()
    setAuth(null)
    setSetupRequired(bootstrap.setupRequired)
  }, [acceptSession])

  useRecoveryTask('session', revalidateSession, 10)

  return (
    <AuthContext.Provider
      value={{
        auth,
        changePassword,
        changeUsername,
        completeSetup,
        error,
        isAuthenticated: Boolean(auth),
        isLoading: isInitializing || isSubmitting,
        isSubmitting,
        login,
        logout,
        preferredUsername,
        setupJustCompleted,
        setupRequired,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
