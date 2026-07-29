import React, { useEffect, useState } from 'react'
import { Leaf, LogIn } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'

export default function LoginPage() {
  const { error, isSubmitting, login, preferredUsername, setupJustCompleted } = useAuth()
  const [username, setUsername] = useState(preferredUsername || 'admin')
  const [password, setPassword] = useState('')

  useEffect(() => {
    setUsername(preferredUsername || 'admin')
  }, [preferredUsername])

  async function handleSubmit(event) {
    event.preventDefault()
    try {
      await login(username, password)
    } catch (_) {}
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 text-center">
          <Leaf className="h-10 w-10 text-green-400 mb-3" />
          <h1 className="text-2xl font-bold text-white">Growhub Command Center</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to continue</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 rounded-lg border border-gray-700 p-6 space-y-4"
        >
          {setupJustCompleted && (
            <div className="text-green-300 text-sm bg-green-950/40 border border-green-900 rounded-md px-3 py-2">
              Administrator created. Sign in to continue.
            </div>
          )}
          {error && (
            <div className="text-red-400 text-sm bg-red-950/30 border border-red-900 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label
              htmlFor="login-username"
              className="block text-sm font-medium text-gray-400 mb-1"
            >
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              maxLength={32}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-gray-400 mb-1"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={128}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-green-700 hover:bg-green-600 disabled:bg-green-900 disabled:cursor-not-allowed text-white font-medium py-2 rounded-md transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                Sign in
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
