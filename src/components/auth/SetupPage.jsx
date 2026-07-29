import React, { useState } from 'react'
import { Leaf, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'

export default function SetupPage() {
  const { completeSetup, error, isSubmitting } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    try {
      await completeSetup({ username, password, passwordConfirmation })
    } catch (_) {}
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 text-center">
          <Leaf className="h-10 w-10 text-green-400 mb-3" />
          <h1 className="text-2xl font-bold text-white">Growhub Command Center</h1>
          <p className="text-gray-400 text-sm mt-1">Create the local administrator</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 rounded-lg border border-gray-700 p-6 space-y-4"
        >
          {error && (
            <div className="text-red-400 text-sm bg-red-950/30 border border-red-900 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label
              htmlFor="setup-username"
              className="block text-sm font-medium text-gray-400 mb-1"
            >
              Username
            </label>
            <input
              id="setup-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern={'[A-Za-z0-9._\\-]+'}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label
              htmlFor="setup-password"
              className="block text-sm font-medium text-gray-400 mb-1"
            >
              Password
            </label>
            <input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              maxLength={128}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label
              htmlFor="setup-password-confirmation"
              className="block text-sm font-medium text-gray-400 mb-1"
            >
              Confirm password
            </label>
            <input
              id="setup-password-confirmation"
              type="password"
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              required
              minLength={12}
              maxLength={128}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:outline-none focus:border-green-500"
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
                Creating administrator...
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Create administrator
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
