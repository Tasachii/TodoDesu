import { AnimatePresence } from 'framer-motion'
import { isToday, isTomorrow, format } from 'date-fns'
import { isStandalone } from '../api/client.js'
import { useTasks } from '../hooks/useTasks.js'
import { isOverdue } from '../lib/dates.js'
import QuickAdd from '../components/QuickAdd.jsx'
import TaskRow from '../components/TaskRow.jsx'

function Section({ title, tasks, accent = false }) {
  if (!tasks.length) return null
  return (
    <section className="mt-7">
      <h2
        className={`mb-2.5 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${
          accent ? 'text-rose-500' : 'text-stone-400 dark:text-stone-500'
        }`}
      >
        {title}
        <span className="font-normal text-stone-300 dark:text-stone-600">{tasks.length}</span>
      </h2>
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  )
}

export default function TodayView() {
  const { data: tasks = [], isLoading, isError } = useTasks()
  const now = new Date()
  const open = tasks.filter((t) => t.status !== 'done')

  const overdue = open.filter((t) => isOverdue(t, now))
  const today = open.filter((t) => t.due_at && isToday(new Date(t.due_at)) && !isOverdue(t, now))
  const tomorrow = open.filter((t) => t.due_at && isTomorrow(new Date(t.due_at)))
  const inbox = open.filter((t) => !t.due_at)

  const empty = !isLoading && !overdue.length && !today.length && !tomorrow.length && !inbox.length

  return (
    <div>
      <header className="mb-6 mt-4 md:mt-0">
        <h1 className="font-display text-[2rem] font-semibold leading-tight">
          Today
          <span className="ml-2.5 hidden align-middle text-base font-normal tracking-[0.2em] text-stone-300 wa:inline dark:text-stone-600"
            aria-hidden="true">
            今日
          </span>
        </h1>
        <p className="mt-0.5 text-sm text-stone-400 dark:text-stone-500">
          {format(now, 'EEEE, d MMMM')}
        </p>
      </header>

      <QuickAdd />

      {isError && (
        <p className="mt-8 text-center text-sm text-rose-500">
          {isStandalone ? (
            <>Something went wrong loading your tasks. Try closing and reopening the app.</>
          ) : (
            <>
              Can&apos;t reach the server — is it running? Try <code>todo server start</code>.
            </>
          )}
        </p>
      )}

      <Section title="Overdue" tasks={overdue} accent />
      <Section title="Today" tasks={today} />
      <Section title="Tomorrow" tasks={tomorrow} />
      <Section title="Inbox" tasks={inbox} />

      {empty && (
        <div className="mt-20 text-center">
          <p className="font-display text-xl italic text-stone-400 dark:text-stone-500">
            All clear.
          </p>
          <p className="mt-1 text-sm text-stone-300 dark:text-stone-600">
            Enjoy the quiet, or add something above.
          </p>
        </div>
      )}
    </div>
  )
}
