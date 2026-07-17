import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useUI } from '../App.jsx'
import { useTheme } from '../hooks/useTheme.js'
import SettingsSheet from './SettingsSheet.jsx'
import ReminderScheduler from './ReminderScheduler.jsx'
import {
  TodayIcon,
  BoardIcon,
  CalendarIcon,
  FocusIcon,
  SunIcon,
  MoonIcon,
  AutoThemeIcon,
  GearIcon,
  SearchIcon,
} from './icons.jsx'

function SearchButton() {
  const { openSearch } = useUI()
  return (
    <button
      onClick={openSearch}
      title="Search (/)"
      aria-label="Search"
      className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-night-edge dark:hover:text-stone-100"
    >
      <SearchIcon size={18} />
    </button>
  )
}

const TABS = [
  { to: '/', label: 'Today', jp: '今日', icon: TodayIcon },
  { to: '/board', label: 'Board', jp: 'ボード', icon: BoardIcon },
  { to: '/calendar', label: 'Calendar', jp: '暦', icon: CalendarIcon },
  { to: '/focus', label: 'Focus', jp: '集中', icon: FocusIcon },
]

function ThemeButton() {
  const [pref, setPref] = useTheme()
  const next = { auto: 'light', light: 'dark', dark: 'wa', wa: 'auto' }
  const Icon = pref === 'light' ? SunIcon : pref === 'dark' ? MoonIcon : AutoThemeIcon
  return (
    <button
      onClick={() => setPref(next[pref] ?? 'auto')}
      title={`Theme: ${pref === 'wa' ? 'wa (和)' : pref}`}
      className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-night-edge dark:hover:text-stone-100"
    >
      {pref === 'wa' ? <span className="text-[14px] font-medium text-accent">和</span> : <Icon size={18} />}
    </button>
  )
}

const Wordmark = ({ className = '' }) => (
  <span className={`font-display italic font-semibold tracking-tight ${className}`}>
    TodoDesu<span className="text-accent-bright not-italic">。</span>
    <span className="ml-1 hidden whitespace-nowrap align-middle text-[10px] font-normal not-italic tracking-[0.25em] text-stone-400 wa:inline-block"
            aria-hidden="true">
      トドデス
    </span>
  </span>
)

function SettingsButton({ onOpen }) {
  return (
    <button
      onClick={onOpen}
      title="Settings"
      aria-label="Settings"
      className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-night-edge dark:hover:text-stone-100"
    >
      <GearIcon size={18} />
    </button>
  )
}

export default function AppShell({ children }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="min-h-dvh">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-stone-200/70 px-4 py-6 md:flex dark:border-night-edge">
        <Wordmark className="px-3 text-2xl" />
        <nav className="mt-8 flex flex-col gap-1">
          {TABS.map(({ to, label, jp, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition-colors ${
                  isActive
                    ? 'bg-stone-900 font-medium text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-night-edge dark:hover:text-stone-100'
                }`
              }
            >
              <Icon size={18} />
              {label}
              <span className="ml-auto hidden text-[10px] tracking-[0.2em] opacity-50 wa:inline"
            aria-hidden="true">
                {jp}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex gap-1 px-2">
          <SearchButton />
          <ThemeButton />
          <SettingsButton onOpen={() => setSettingsOpen(true)} />
        </div>
      </aside>

      {/* mobile header */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-paper/80 px-5 pb-2 backdrop-blur-md md:hidden dark:bg-night/80"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 14px)' }}
      >
        <Wordmark className="text-xl" />
        <div className="flex gap-1">
          <SearchButton />
          <ThemeButton />
          <SettingsButton onOpen={() => setSettingsOpen(true)} />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-32 pt-2 md:pl-64 md:pr-8 md:pt-10 lg:mx-auto lg:max-w-3xl">
        {children}
      </main>

      {/* mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200/70 bg-paper/90 backdrop-blur-md md:hidden dark:border-night-edge dark:bg-night/90"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => (
            // mobile tabs stay English-only — no space for the jp accent

            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                  isActive ? 'text-accent' : 'text-stone-400 dark:text-stone-500'
                }`
              }
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ReminderScheduler />
    </div>
  )
}
