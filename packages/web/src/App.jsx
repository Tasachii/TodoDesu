import {
  useState,
  useCallback,
  useEffect,
  useRef,
  createContext,
  useContext,
  lazy,
  Suspense,
} from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import TaskDetail from './components/TaskDetail.jsx'
import UndoToast from './components/UndoToast.jsx'
import SearchOverlay from './components/SearchOverlay.jsx'
import TodayView from './views/TodayView.jsx'

// Code-split the secondary views so the initial bundle stays lean
// (BoardView alone pulls in all of dnd-kit).
const BoardView = lazy(() => import('./views/BoardView.jsx'))
const CalendarView = lazy(() => import('./views/CalendarView.jsx'))
const FocusView = lazy(() => import('./views/FocusView.jsx'))

const UIContext = createContext(null)
export const useUI = () => useContext(UIContext)

// n = new task, 1–4 = switch view, / = search. Never fires while typing.
function useShortcuts({ openSearch }) {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      if (
        el instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
      )
        return
      // a board card lifted for keyboard drag owns the keyboard until dropped
      if (el instanceof HTMLElement && el.getAttribute('aria-pressed') === 'true') return
      // e.code covers layouts where the physical / key types another character
      if (e.key === '/' || e.code === 'Slash') {
        e.preventDefault()
        openSearch()
      } else if (e.key === 'n') {
        e.preventDefault()
        navigate('/')
        // QuickAdd may be mounting — give it a beat before asking for focus
        setTimeout(() => window.dispatchEvent(new Event('tododesu:quickadd')), 80)
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        navigate(['/', '/board', '/calendar', '/focus'][Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, openSearch])
}

export default function App() {
  const [detailId, setDetailId] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef()

  const openSearch = useCallback(() => setSearchOpen(true), [])
  useShortcuts({ openSearch })

  const showUndo = useCallback((label, onUndo) => {
    clearTimeout(toastTimer.current)
    setToast({ label, onUndo })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  // Unrecoverable data-layer errors (e.g. a full localStorage quota in the
  // standalone build) broadcast this event so any hook can surface a plain
  // message through the same toast, without reaching into React context.
  useEffect(() => {
    const onMessage = (e) => {
      clearTimeout(toastTimer.current)
      setToast({ label: e.detail })
      toastTimer.current = setTimeout(() => setToast(null), 5000)
    }
    window.addEventListener('tododesu:toast', onMessage)
    return () => window.removeEventListener('tododesu:toast', onMessage)
  }, [])

  return (
    <UIContext.Provider value={{ openDetail: setDetailId, showUndo, openSearch }}>
      <AppShell>
        <Suspense
          fallback={
            <p className="mt-24 text-center font-display text-sm italic text-stone-300 dark:text-stone-600">
              Loading…
            </p>
          }
        >
          <Routes>
            <Route path="/" element={<TodayView />} />
            <Route path="/board" element={<BoardView />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/focus" element={<FocusView />} />
          </Routes>
        </Suspense>
      </AppShell>
      <TaskDetail taskId={detailId} onClose={() => setDetailId(null)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <UndoToast toast={toast} onDismiss={dismissToast} />
    </UIContext.Provider>
  )
}
