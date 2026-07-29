import React from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import LoginPage from './LoginPage.jsx'
import SetupPage from './SetupPage.jsx'

export default function AuthGate({ children }) {
  const { isAuthenticated, isLoading, setupRequired } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (setupRequired) return <SetupPage />
  if (!isAuthenticated) return <LoginPage />
  return children
}
