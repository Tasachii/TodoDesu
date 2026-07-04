import { AnimatePresence, motion } from 'framer-motion'

export default function UndoToast({ toast, onDismiss }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 16, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 16, x: '-50%' }}
          transition={{ duration: 0.2 }}
          className={`fixed bottom-24 left-1/2 z-50 flex items-center gap-4 rounded-full bg-stone-900 py-2.5 pl-5 text-sm text-stone-100 shadow-xl md:bottom-8 dark:bg-stone-100 dark:text-stone-900 ${toast.onUndo ? 'pr-2.5' : 'pr-5'}`}
        >
          {toast.label}
          {toast.onUndo && (
            <button
              onClick={() => {
                toast.onUndo()
                onDismiss()
              }}
              className="rounded-full bg-white/15 px-3.5 py-1 font-semibold text-accent-bright transition-colors hover:bg-white/25 dark:bg-stone-900/10 dark:text-accent"
            >
              Undo
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
