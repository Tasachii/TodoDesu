import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { api, isStandalone } from '../api/client.js'
import { CloseIcon, DownloadIcon, UploadIcon } from './icons.jsx'
import {
  loadEnabled,
  saveEnabled,
  loadNotified,
  saveNotified,
  reminderPlan,
} from '../lib/reminders.js'
import { REMINDERS_CHANGED } from './ReminderScheduler.jsx'

function stamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function SettingsSheet({ open, onClose }) {
  const qc = useQueryClient()
  const fileRef = useRef(null)
  const [message, setMessage] = useState(null) // { tone: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false)

  const remindersSupported = typeof window !== 'undefined' && 'Notification' in window
  const [remindersOn, setRemindersOn] = useState(() => loadEnabled())
  const [permission, setPermission] = useState(() =>
    remindersSupported ? Notification.permission : 'unsupported'
  )
  const [reminderMsg, setReminderMsg] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const toggleReminders = async () => {
    setReminderMsg(null)
    if (remindersOn) {
      saveEnabled(false)
      setRemindersOn(false)
      window.dispatchEvent(new Event(REMINDERS_CHANGED))
      return
    }
    // Turning on — request permission on this click, which is a user gesture.
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm !== 'granted') {
      setReminderMsg({
        tone: 'error',
        text:
          perm === 'denied'
            ? 'Notifications are blocked. Turn them on for this site in your browser settings.'
            : 'Reminders need notification permission.',
      })
      return
    }
    // Suppress reminders for tasks already past due so enabling doesn't fire a
    // burst of catch-up notifications for old work.
    const notified = loadNotified()
    for (const t of reminderPlan(qc.getQueryData(['tasks']) ?? [], { notified }).due) {
      notified.add(t.id)
    }
    saveNotified(notified)
    saveEnabled(true)
    setRemindersOn(true)
    window.dispatchEvent(new Event(REMINDERS_CHANGED))
    setReminderMsg({
      tone: 'ok',
      text: "On. Reminders fire at each task's due time while the app is open.",
    })
  }

  const exportBackup = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const payload = await api.exportData()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `todoo-backup-${stamp()}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ tone: 'ok', text: `Exported ${payload.tasks.length} tasks.` })
    } catch (err) {
      setMessage({ tone: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const importBackup = async (file) => {
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const payload = JSON.parse(await file.text())
      const count = Array.isArray(payload?.tasks) ? payload.tasks.length : '?'
      const sure = window.confirm(
        `Replace everything with this backup (${count} tasks)? Your current data will be overwritten.`
      )
      if (!sure) return
      const { imported } = await api.importData(payload)
      qc.invalidateQueries() // every view refetches the imported data
      setMessage({ tone: 'ok', text: `Imported ${imported.tasks} tasks.` })
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err.code === 'VALIDATION' || err instanceof SyntaxError
          ? "That doesn't look like a Todoo backup file."
          : err.message,
      })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-30 flex items-end justify-center bg-stone-900/30 backdrop-blur-[2px] md:items-center dark:bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 48, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-card shadow-2xl md:max-w-md md:rounded-3xl dark:bg-night-card"
          >
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 className="font-display text-lg italic text-stone-400 dark:text-stone-500">
                Settings
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 dark:hover:bg-night-edge"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              className="space-y-5 px-6 py-5"
              style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}
            >
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 dark:text-stone-500">
                  Reminders
                </h3>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                    {remindersSupported
                      ? 'Get a notification when a task is due. Fires on this device while the app is open.'
                      : 'This browser can’t show notifications.'}
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={remindersOn}
                    aria-label="Enable due-date reminders"
                    onClick={toggleReminders}
                    disabled={!remindersSupported || (permission === 'denied' && !remindersOn)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      remindersOn ? 'bg-accent' : 'bg-stone-300 dark:bg-night-edge'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        remindersOn ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                {reminderMsg && (
                  <p
                    className={`mt-2 text-xs ${
                      reminderMsg.tone === 'ok'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-500'
                    }`}
                  >
                    {reminderMsg.text}
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 dark:text-stone-500">
                  Backup
                </h3>
                <p className="mb-3 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                  {isStandalone
                    ? 'Your tasks live only in this browser. Export a file now and then, and keep it somewhere safe.'
                    : 'Everything lives in one database file on this machine. A backup file also moves your data between devices.'}
                </p>
                <div className="flex gap-2.5">
                  <button
                    onClick={exportBackup}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 py-2.5 text-sm font-medium text-stone-50 transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                  >
                    <DownloadIcon size={16} /> Export backup
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-100 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-night-edge dark:text-stone-300"
                  >
                    <UploadIcon size={16} /> Import
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => importBackup(e.target.files?.[0])}
                  />
                </div>
                {message && (
                  <p
                    className={`mt-3 text-center text-xs ${
                      message.tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                    }`}
                  >
                    {message.text}
                  </p>
                )}
              </section>

              <p className="text-center text-[11px] text-stone-300 dark:text-stone-600">
                TodoDesu {isStandalone ? '· standalone' : ''} · your data never leaves your devices
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
