import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useAudio } from '../hooks/useAudio'
import RulebookModal from './RulebookModal'

export default function RulebookButton({ compact = false }) {
  const { playClick } = useAudio()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          playClick()
          setOpen(true)
        }}
        className="inline-flex items-center gap-1.5 border border-cyan-500/40 px-2 py-2 text-[10px] uppercase tracking-wider text-cyan-300 hover:border-cyan-400 hover:text-cyan-100"
        title="Regolamento di gioco"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {compact ? (
          <span className="sr-only">Regolamento</span>
        ) : (
          <span>Regolamento</span>
        )}
      </button>
      <RulebookModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
