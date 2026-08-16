import { GAME_VERSION } from '../lib/constants'

export default function VersionWatermark() {
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[80] font-mono text-xs text-slate-500 max-md:bottom-20">
      {GAME_VERSION}
    </div>
  )
}
