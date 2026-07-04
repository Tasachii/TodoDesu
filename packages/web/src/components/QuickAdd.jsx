import { useEffect, useRef, useState } from 'react'
import { useTaskMutations } from '../hooks/useTasks.js'
import { fromLocalInput, formatDue } from '../lib/dates.js'
import { PlusIcon, ClockIcon } from './icons.jsx'

export default function QuickAdd() {
  const { create } = useTaskMutations()
  const inputRef = useRef(null)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [showDue, setShowDue] = useState(false)
  const [detected, setDetected] = useState(null) // { due_at, matched, title }
  const [keepAsText, setKeepAsText] = useState(false)

  // the global `n` shortcut focuses the bar
  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    window.addEventListener('tododesu:quickadd', focus)
    return () => window.removeEventListener('tododesu:quickadd', focus)
  }, [])

  // Detect natural-language dates while typing ("pay rent tomorrow 6pm").
  // The parser is its own lazy chunk, fetched on the first keystroke.
  useEffect(() => {
    // Clearing an emptied field is handled in the change handler; this effect
    // only runs the debounced async detection, so it never calls setState
    // synchronously in its body (which would trigger a cascading render).
    if (!title.trim()) return
    let alive = true
    const t = setTimeout(async () => {
      const { detectDue } = await import('../lib/quickdate.js')
      if (alive) setDetected(detectDue(title))
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [title])

  // an explicit date from the picker always wins over the detected one
  const useDetected = Boolean(detected) && !keepAsText && !due

  const submit = async (e) => {
    e.preventDefault()
    // Fast Enter can beat the 200ms debounce — detect synchronously so a
    // typed date is never silently dropped (the module is cached by now).
    let d = detected
    if (!d && !due && !keepAsText && title.trim()) {
      const { detectDue } = await import('../lib/quickdate.js')
      d = detectDue(title)
    }
    const usingDetected = Boolean(d) && !keepAsText && !due
    const finalTitle = (usingDetected ? d.title : title).trim()
    if (!finalTitle) return
    create.mutate({
      title: finalTitle,
      due_at: due ? fromLocalInput(due) : usingDetected ? d.due_at : null,
    })
    setTitle('')
    setDue('')
    setShowDue(false)
    setDetected(null)
    setKeepAsText(false)
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-stone-200/60 bg-card shadow-[0_1px_3px_rgba(28,25,23,0.05)] dark:border-night-edge dark:bg-night-card"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-accent">
          <PlusIcon size={18} />
        </span>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => {
            const v = e.target.value
            setTitle(v)
            if (!v.trim()) setDetected(null) // clear the date chip the instant the field empties
          }}
          placeholder="Add a task — try “pay rent tomorrow 6pm”"
          enterKeyHint="done"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
        />
        <button
          type="button"
          onClick={() => setShowDue((s) => !s)}
          aria-label="Set due time"
          className={`transition-colors ${showDue || due ? 'text-accent' : 'text-stone-300 hover:text-stone-500 dark:text-stone-600'}`}
        >
          <ClockIcon size={18} />
        </button>
      </div>

      {useDetected && (
        <div className="flex items-center gap-2 border-t border-stone-100 px-4 py-2 text-xs dark:border-night-edge">
          <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 font-medium text-accent">
            <ClockIcon size={13} />
            {formatDue(detected.due_at)}
          </span>
          <span className="truncate text-stone-400 dark:text-stone-500">
            from “{detected.matched}”
          </span>
          <button
            type="button"
            onClick={() => setKeepAsText(true)}
            className="ml-auto shrink-0 text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline dark:hover:text-stone-300"
          >
            keep as text
          </button>
        </div>
      )}

      {showDue && (
        <div className="border-t border-stone-100 px-4 py-2.5 dark:border-night-edge">
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="w-full bg-transparent text-sm text-stone-600 outline-none dark:text-stone-300 dark:[color-scheme:dark]"
          />
        </div>
      )}
    </form>
  )
}
