import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTasks } from '../hooks/useTasks.js'
import TaskRow from './TaskRow.jsx'
import { SearchIcon } from './icons.jsx'

export default function SearchOverlay({ open, onClose }) {
  const { data: tasks = [] } = useTasks()
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQ('')
      // wait for the panel to mount before grabbing focus
      const t = setTimeout(() => inputRef.current?.focus(), 60)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const needle = q.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!needle) return []
    return tasks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          (t.notes ?? '').toLowerCase().includes(needle)
      )
      .slice(0, 30)
  }, [tasks, needle])
  const openTasks = matches.filter((t) => t.status !== 'done')
  const doneTasks = matches.filter((t) => t.status === 'done')

  const section = (label, list) =>
    list.length > 0 && (
      <section className="mt-4 first:mt-0">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
          {label} <span className="font-normal text-stone-300 dark:text-stone-600">{list.length}</span>
        </h3>
        <ul className="space-y-2">
          {list.map((t) => (
            <TaskRow key={t.id} task={t} swipeable={false} />
          ))}
        </ul>
      </section>
    )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-start justify-center bg-stone-900/30 px-4 pt-[10vh] backdrop-blur-[2px] dark:bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: -16, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 360 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-3xl bg-card shadow-2xl dark:bg-night-card"
          >
            <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-3.5 dark:border-night-edge">
              <SearchIcon size={18} className="shrink-0 text-stone-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tasks and notes…"
                aria-label="Search tasks"
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
              />
              <kbd className="hidden rounded-md border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 md:inline dark:border-night-edge">
                esc
              </kbd>
            </div>

            {/* Tapping a row body opens its detail sheet — close the search first.
                Clicks on controls (the done circle, undo, …) keep it open. */}
            <div
              className="overflow-y-auto px-5 py-4"
              onClickCapture={(e) => {
                if (e.target instanceof Element && e.target.closest('button')) return
                onClose()
              }}
            >
              {needle === '' ? (
                <p className="py-8 text-center font-display text-sm italic text-stone-300 dark:text-stone-600">
                  Search everything you&apos;ve ever added.
                </p>
              ) : matches.length === 0 ? (
                <p className="py-8 text-center font-display text-sm italic text-stone-300 dark:text-stone-600">
                  Nothing found for “{q.trim()}”.
                </p>
              ) : (
                <>
                  {section('Open', openTasks)}
                  {section('Done', doneTasks)}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
