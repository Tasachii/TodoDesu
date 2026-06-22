import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { subDays } from 'date-fns'
import { useUI } from '../App.jsx'
import { useTasks, useTaskMutations } from '../hooks/useTasks.js'
import { isOverdue, formatDue } from '../lib/dates.js'
import { RepeatIcon } from '../components/icons.jsx'

const COLUMNS = [
  { id: 'todo', title: 'To do' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'done', title: 'Done' },
]

// Sort key for a card dropped at `index` in `list` (the target column with the
// dragged card already removed). Dropping between two cards takes the
// fractional midpoint so no neighbours need renumbering; ends and empty
// columns fall back to ±1 / 1. Exported for unit tests.
export function computeSortOrder(list, index) {
  const before = list[index - 1]
  const after = list[index]
  return before && after
    ? (before.sort_order + after.sort_order) / 2
    : after
      ? after.sort_order - 1
      : before
        ? before.sort_order + 1
        : 1
}

function Card({ task, overlay = false }) {
  const done = task.status === 'done'
  return (
    <div
      className={`rounded-2xl border border-stone-200/60 bg-card px-4 py-3 shadow-[0_1px_2px_rgba(28,25,23,0.04)] dark:border-night-edge dark:bg-night-card ${
        overlay ? 'rotate-2 shadow-xl' : ''
      }`}
    >
      <p className={`text-[14px] leading-snug ${done ? 'wa-strike text-stone-400 line-through dark:text-stone-500' : ''}`}>
        {task.title}
      </p>
      <div className="mt-1 flex items-center gap-2 empty:hidden">
        {task.due_at && (
          <span className={`flex items-center gap-1 text-xs ${isOverdue(task) ? 'font-medium text-rose-500' : 'text-stone-400 dark:text-stone-500'}`}>
            {formatDue(task.due_at)}
            {task.repeat && <RepeatIcon size={11} aria-label={`repeats ${task.repeat}`} />}
          </span>
        )}
        {task.priority > 0 && (
          <span className="text-xs font-semibold tracking-wider text-accent">{'!'.repeat(task.priority)}</span>
        )}
      </div>
    </div>
  )
}

function SortableCard({ task }) {
  const { openDetail } = useUI()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => openDetail(task.id)}
      className={`relative cursor-grab list-none touch-manipulation active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
    >
      <Card task={task} />
      {/* Enter/Space on the card lifts it for keyboard drag, so give keyboard
          users a dedicated control to open details (visible only when focused). */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          openDetail(task.id)
        }}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={`Open details for "${task.title}"`}
        className="sr-only rounded-lg bg-stone-900 px-2.5 py-1 text-xs font-medium text-stone-50 focus-visible:not-sr-only focus-visible:absolute focus-visible:right-2 focus-visible:top-2 dark:bg-stone-100 dark:text-stone-900"
      >
        Details
      </button>
    </li>
  )
}

function Column({ column, tasks }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  return (
    <div className="flex w-[78vw] shrink-0 snap-center flex-col sm:w-auto sm:flex-1 sm:shrink">
      <h2 className="mb-2.5 flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
        {column.title}
        <span className="font-normal text-stone-300 dark:text-stone-600">{tasks.length}</span>
      </h2>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`min-h-40 flex-1 space-y-2 rounded-2xl p-1.5 transition-colors ${
            isOver ? 'bg-amber-100/50 dark:bg-amber-500/5' : 'bg-stone-100/60 dark:bg-night-edge/40'
          }`}
        >
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} />
          ))}
        </ul>
      </SortableContext>
    </div>
  )
}

export default function BoardView() {
  const { data: tasks = [] } = useTasks()
  const { patch } = useTaskMutations()
  const [activeId, setActiveId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    // space/enter lifts a focused card, arrows move it, space/enter drops
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const byColumn = useMemo(() => {
    const weekAgo = subDays(new Date(), 7).toISOString()
    const map = { todo: [], in_progress: [], done: [] }
    for (const t of tasks) {
      if (t.status === 'done' && (t.completed_at ?? '') < weekAgo) continue
      map[t.status]?.push(t)
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.sort_order - b.sort_order)
    return map
  }, [tasks])

  const activeTask = activeId != null ? tasks.find((t) => t.id === activeId) : null

  const onDragEnd = ({ active, over }) => {
    setActiveId(null)
    if (!over) return
    const task = tasks.find((t) => t.id === active.id)
    if (!task) return

    const overColumn = COLUMNS.find((c) => c.id === over.id)
    const overTask = overColumn ? null : tasks.find((t) => t.id === over.id)
    const targetStatus = overColumn ? overColumn.id : overTask?.status
    if (!targetStatus) return

    const list = byColumn[targetStatus].filter((t) => t.id !== task.id)
    const index = overTask ? list.findIndex((t) => t.id === overTask.id) : list.length
    const sort_order = computeSortOrder(list, index)

    if (targetStatus === task.status && sort_order === task.sort_order) return
    patch.mutate({ id: task.id, status: targetStatus, sort_order })
  }

  return (
    <div>
      <header className="mb-6 mt-4 md:mt-0">
        <h1 className="font-display text-[2rem] font-semibold leading-tight">
          Board
          <span className="ml-2.5 hidden align-middle text-base font-normal tracking-[0.2em] text-stone-300 wa:inline dark:text-stone-600"
            aria-hidden="true">
            ボード
          </span>
        </h1>
        <p className="mt-0.5 text-sm text-stone-400 dark:text-stone-500">
          Drag cards between columns.
        </p>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 sm:mx-0 sm:snap-none sm:px-0">
          {COLUMNS.map((col) => (
            <Column key={col.id} column={col} tasks={byColumn[col.id]} />
          ))}
        </div>
        <DragOverlay>{activeTask ? <Card task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
