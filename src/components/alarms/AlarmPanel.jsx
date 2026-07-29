import React, { useCallback, useEffect, useState } from 'react'
import { getAlarms, markAlarmsRead } from '../../api/piClient.js'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { Bell, CheckCheck } from 'lucide-react'
import { useRecoveryTask } from '../../contexts/ServerAvailabilityContext.jsx'

export default function AlarmPanel() {
  const { auth } = useAuth()
  const [alarms, setAlarms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAlarms({ userId: auth?.userId })
      setAlarms(Array.isArray(data) ? data : (data?.alarms ?? []))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [auth?.userId])

  useRecoveryTask('alerts-page', load, 100)

  async function handleMarkRead() {
    try {
      await markAlarmsRead({ userId: auth?.userId })
      setAlarms((prev) => prev.map((a) => ({ ...a, read: true })))
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  const unread = alarms.filter((a) => !a.read).length

  const severityColor = (s) => (s === 'critical' ? 'text-red-400' : 'text-yellow-400')

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-gray-400" />
          <span className="text-white font-medium text-sm">Alarms</span>
          {unread > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={handleMarkRead}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white text-xs transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
          <button
            onClick={load}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white text-xs transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
      {loading && (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
        </div>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && !error && alarms.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-6">
          No alarms. Thresholds are monitored automatically.
        </p>
      )}
      {!loading && alarms.length > 0 && (
        <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
          {alarms.map((alarm, idx) => (
            <div
              key={alarm._id ?? idx}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                alarm.read
                  ? 'border-gray-800 bg-gray-800/40'
                  : 'border-yellow-800/50 bg-yellow-900/10'
              }`}
            >
              <div
                className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${alarm.read ? 'bg-gray-600' : 'bg-yellow-400'}`}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${alarm.read ? 'text-gray-400' : 'text-white'}`}>
                  {alarm.message}
                </p>
                <div className="flex items-center gap-3 mt-0.5">
                  {alarm.deviceId && (
                    <span className="text-xs text-gray-600">{alarm.deviceId}</span>
                  )}
                  {alarm.createdAt && (
                    <span className="text-xs text-gray-600">
                      {new Date(alarm.createdAt).toLocaleString()}
                    </span>
                  )}
                  {!alarm.read && (
                    <span className={`text-xs font-medium ${severityColor(alarm.severity)}`}>
                      {alarm.severity}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
